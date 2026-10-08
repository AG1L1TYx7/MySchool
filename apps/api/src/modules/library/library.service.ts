import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PagedResponse } from '../../common/dto/paged-response.dto';
import { newId } from '../../common/utils/ids';
import type { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AiClient } from '../ai/ai.client';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { FilesService } from '../files/files.service';
import { H5pService } from '../h5p/h5p.service';
import { TenantsService } from '../tenants/tenants.service';
import type {
  AddCollectionItemDto,
  CreateCollectionDto,
  CreateLibraryItemDto,
  FlagItemDto,
  ListLibraryQuery,
  RateItemDto,
  ResolveFlagDto,
  ReviewItemDto,
  SearchLibraryQuery,
  UpdateCollectionDto,
  UpdateLibraryItemDto,
} from './dto/library.dto';
import {
  allowedVisibilities,
  averageRating,
  canEdit,
  canReview,
  canSee,
  docIdFor,
  embeddingText,
  isNewVersion,
  isSafeUrl,
  itemIdFromDocId,
  libraryNamespace,
  mergeSearch,
  parseList,
  PUBLIC_NAMESPACE,
  requiresReview,
  snapshotOf,
  statusAfterVisibilityChange,
  type Viewer,
  type VisibleItem,
} from './library-rules';

type ItemRow = Prisma.LibraryItemGetPayload<{
  include: {
    createdBy: { select: { firstName: true; lastName: true } };
    organization: { select: { name: true; tenantId: true } };
    h5pContent: { select: { contentType: true; library: true; status: true } };
    file: { select: { originalName: true; mimeType: true; sizeBytes: true } };
    lessonPlan: { select: { topic: true } };
  };
}>;
const ITEM_INCLUDE = {
  createdBy: { select: { firstName: true, lastName: true } },
  organization: { select: { name: true, tenantId: true } },
  h5pContent: { select: { contentType: true, library: true, status: true } },
  file: { select: { originalName: true, mimeType: true, sizeBytes: true } },
  lessonPlan: { select: { topic: true } },
} as const;

/**
 * The library: one catalogue of interactive content, documents, links and lesson plans shared within a
 * school, across a district or with everyone; versions, ratings, flags, collections, moderation and
 * semantic search through the AI service (keyword search when it is away).
 */
@Injectable()
export class LibraryService {
  private readonly log = new Logger(LibraryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly ai: AiClient,
    private readonly h5p: H5pService,
    private readonly files: FilesService,
    private readonly tenants: TenantsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Browse and search
  // ---------------------------------------------------------------------------

  async list(q: ListLibraryQuery, actor: AuthenticatedUser) {
    const where: Prisma.LibraryItemWhereInput = {
      deletedAt: null,
      ...(q.mine
        ? { createdById: actor.id, ...(q.status ? { status: q.status } : {}) }
        : this.visibleWhere(actor)),
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.subject ? { subject: { contains: q.subject } } : {}),
      ...(q.gradeLevel ? { gradeLevel: q.gradeLevel } : {}),
      ...(q.featured ? { featured: true } : {}),
      ...(q.collectionId
        ? { collectionItems: { some: { collectionId: q.collectionId } } }
        : {}),
      ...(q.q
        ? {
            OR: [
              { title: { contains: q.q } },
              { description: { contains: q.q } },
              { keywords: { contains: q.q } },
              { subject: { contains: q.q } },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.libraryItem.findMany({
        where,
        include: ITEM_INCLUDE,
        orderBy: [
          { featured: 'desc' },
          { publishedAt: 'desc' },
          { createdAt: 'desc' },
        ],
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.libraryItem.count({ where }),
    ]);
    return PagedResponse.of(
      rows.map((r) => this.toPublic(r, actor)),
      q,
      total,
    );
  }

  /** Meaning-based search through the AI service, merged with keyword matches; keyword only when the AI is away. */
  async search(q: SearchLibraryQuery, actor: AuthenticatedUser) {
    const limit = q.limit ?? 20;
    const keywordRows = await this.prisma.libraryItem.findMany({
      where: {
        deletedAt: null,
        ...this.visibleWhere(actor),
        ...(q.kind ? { kind: q.kind } : {}),
        OR: [
          { title: { contains: q.q } },
          { description: { contains: q.q } },
          { keywords: { contains: q.q } },
        ],
      },
      include: ITEM_INCLUDE,
      orderBy: [{ featured: 'desc' }, { publishedAt: 'desc' }],
      take: limit,
    });
    let semantic: Array<{ itemId: string; score: number }> = [];
    let semanticUsed = false;
    try {
      const namespaces = [libraryNamespace(actor.tenantId), PUBLIC_NAMESPACE];
      const hits = (
        await Promise.all(
          namespaces.map((ns) => this.ai.ragSearch(q.q, ns, limit)),
        )
      ).flat();
      const best = new Map<string, number>();
      for (const h of hits) {
        const id = itemIdFromDocId(h.docId);
        if (id && (best.get(id) ?? -1) < h.score) best.set(id, h.score);
      }
      semantic = [...best.entries()].map(([itemId, score]) => ({
        itemId,
        score,
      }));
      semanticUsed = true;
    } catch (err) {
      this.log.debug(`semantic search unavailable: ${(err as Error).message}`);
    }
    const ids = semantic
      .map((s) => s.itemId)
      .filter((id) => !keywordRows.some((r) => r.id === id));
    const semanticRows = ids.length
      ? await this.prisma.libraryItem.findMany({
          where: {
            id: { in: ids },
            deletedAt: null,
            ...(q.kind ? { kind: q.kind } : {}),
          },
          include: ITEM_INCLUDE,
        })
      : [];
    const byId = new Map<string, ItemRow>();
    for (const r of [...keywordRows, ...semanticRows])
      if (this.visible(r, actor)) byId.set(r.id, r);
    const merged = mergeSearch(
      semantic,
      keywordRows.filter((r) => byId.has(r.id)),
      byId,
    ).slice(0, limit);
    return {
      query: q.q,
      semantic: semanticUsed,
      data: merged.map((m) => ({ ...this.toPublic(m, actor), score: m.score })),
    };
  }

  async get(id: string, actor: AuthenticatedUser) {
    const row = await this.visibleRow(id, actor);
    if (row.createdById !== actor.id)
      await this.prisma.libraryItem
        .update({ where: { id }, data: { viewCount: { increment: 1 } } })
        .catch(() => undefined);
    const [versions, myRating, collections] = await Promise.all([
      this.prisma.libraryItemVersion.findMany({
        where: { itemId: id },
        orderBy: { version: 'desc' },
        select: {
          version: true,
          title: true,
          note: true,
          createdAt: true,
          createdById: true,
        },
      }),
      this.prisma.libraryRating.findUnique({
        where: { itemId_userId: { itemId: id, userId: actor.id } },
        select: { stars: true, comment: true },
      }),
      this.prisma.libraryCollectionItem.findMany({
        where: { itemId: id, collection: { deletedAt: null } },
        select: {
          collection: {
            select: {
              id: true,
              title: true,
              visibility: true,
              organizationId: true,
              createdById: true,
              deletedAt: true,
            },
          },
        },
      }),
    ]);
    const viewer = this.viewer(actor);
    return {
      ...this.toPublic(row, actor),
      versions,
      myRating,
      collections: collections
        .map((c) => c.collection)
        .filter((c) =>
          canSee(
            { ...c, tenantId: row.organization.tenantId, status: 'published' },
            viewer,
          ),
        )
        .map((c) => ({ id: c.id, title: c.title })),
    };
  }

  // ---------------------------------------------------------------------------
  // Create, change, publish
  // ---------------------------------------------------------------------------

  async create(dto: CreateLibraryItemDto, actor: AuthenticatedUser) {
    if (!actor.organizationId)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Your account is not attached to a school.',
      });
    const viewer = this.viewer(actor);
    const visibility = dto.visibility ?? 'private';
    if (!allowedVisibilities(viewer).includes(visibility))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'You may not share items that widely.',
      });
    const source = await this.checkSource(dto.kind, dto, actor);
    const item = await this.prisma.libraryItem.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        createdById: actor.id,
        kind: dto.kind,
        title: dto.title,
        description: dto.description ?? null,
        subject: dto.subject ?? null,
        gradeLevel: dto.gradeLevel ?? null,
        topics: JSON.stringify(dto.topics ?? []),
        standards: JSON.stringify(dto.standards ?? []),
        keywords: dto.keywords ?? null,
        visibility,
        h5pContentId: source.h5pContentId,
        fileId: source.fileId,
        url: source.url,
        lessonPlanId: source.lessonPlanId,
      },
      include: ITEM_INCLUDE,
    });
    await this.prisma.libraryItemVersion.create({
      data: {
        id: newId(),
        itemId: item.id,
        version: 1,
        title: item.title,
        description: item.description,
        snapshot: snapshotOf(item, await this.h5pParameters(item.h5pContentId)),
        note: 'Created',
        createdById: actor.id,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'library.item.create',
      entityType: 'LibraryItem',
      entityId: item.id,
      details: { kind: dto.kind, visibility },
    });
    return this.toPublic(item, actor);
  }

  async update(
    id: string,
    dto: UpdateLibraryItemDto,
    actor: AuthenticatedUser,
  ) {
    const row = await this.editableRow(id, actor);
    const viewer = this.viewer(actor);
    if (dto.visibility && !allowedVisibilities(viewer).includes(dto.visibility))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'You may not share items that widely.',
      });
    if (dto.featured !== undefined && !canReview(this.visibleOf(row), viewer))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only administrators feature items.',
      });
    const source = await this.checkSource(
      row.kind,
      {
        h5pContentId: dto.h5pContentId ?? row.h5pContentId ?? undefined,
        fileId: dto.fileId ?? row.fileId ?? undefined,
        url: dto.url ?? row.url ?? undefined,
        lessonPlanId: dto.lessonPlanId ?? row.lessonPlanId ?? undefined,
      },
      actor,
    );
    const before = {
      title: row.title,
      description: row.description,
      topics: parseList(row.topics),
      standards: parseList(row.standards),
      h5pContentId: row.h5pContentId,
      fileId: row.fileId,
      url: row.url,
      lessonPlanId: row.lessonPlanId,
    };
    const after = {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined
        ? { description: dto.description }
        : {}),
      ...(dto.topics !== undefined ? { topics: dto.topics } : {}),
      ...(dto.standards !== undefined ? { standards: dto.standards } : {}),
      h5pContentId: source.h5pContentId,
      fileId: source.fileId,
      url: source.url,
      lessonPlanId: source.lessonPlanId,
      ...(dto.parameters !== undefined ? { parameters: dto.parameters } : {}),
    };
    const newVersion = isNewVersion(before, after);
    if (dto.parameters !== undefined && row.h5pContentId)
      await this.h5p.update(
        row.h5pContentId,
        { parameters: dto.parameters },
        actor,
      );
    const status = dto.visibility
      ? statusAfterVisibilityChange(row, dto.visibility, viewer)
      : row.status;
    const updated = await this.prisma.libraryItem.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.subject !== undefined ? { subject: dto.subject } : {}),
        ...(dto.gradeLevel !== undefined ? { gradeLevel: dto.gradeLevel } : {}),
        ...(dto.topics !== undefined
          ? { topics: JSON.stringify(dto.topics) }
          : {}),
        ...(dto.standards !== undefined
          ? { standards: JSON.stringify(dto.standards) }
          : {}),
        ...(dto.keywords !== undefined ? { keywords: dto.keywords } : {}),
        ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
        ...(dto.featured !== undefined ? { featured: dto.featured } : {}),
        h5pContentId: source.h5pContentId,
        fileId: source.fileId,
        url: source.url,
        lessonPlanId: source.lessonPlanId,
        status,
        ...(newVersion ? { version: { increment: 1 } } : {}),
      },
      include: ITEM_INCLUDE,
    });
    if (newVersion) {
      await this.prisma.libraryItemVersion.create({
        data: {
          id: newId(),
          itemId: id,
          version: updated.version,
          title: updated.title,
          description: updated.description,
          snapshot: snapshotOf(
            updated,
            await this.h5pParameters(updated.h5pContentId),
          ),
          note: dto.versionNote ?? null,
          createdById: actor.id,
        },
      });
    }
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: 'library.item.update',
      entityType: 'LibraryItem',
      entityId: id,
      details: { fields: Object.keys(dto), version: updated.version, status },
    });
    await this.reindex(updated);
    return this.toPublic(updated, actor);
  }

  async publish(id: string, actor: AuthenticatedUser) {
    const row = await this.editableRow(id, actor);
    const viewer = this.viewer(actor);
    const status = requiresReview(row.visibility, viewer)
      ? 'pending_review'
      : 'published';
    const updated = await this.prisma.libraryItem.update({
      where: { id },
      data: {
        status,
        ...(status === 'published'
          ? {
              publishedAt: row.publishedAt ?? new Date(),
              reviewedById: actor.id,
              reviewedAt: new Date(),
              reviewNote: null,
            }
          : {}),
      },
      include: ITEM_INCLUDE,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action:
        status === 'published' ? 'library.item.publish' : 'library.item.submit',
      entityType: 'LibraryItem',
      entityId: id,
      details: { visibility: row.visibility },
    });
    await this.reindex(updated);
    return this.toPublic(updated, actor);
  }

  async unpublish(id: string, actor: AuthenticatedUser, archive = false) {
    const row = await this.editableRow(id, actor);
    const updated = await this.prisma.libraryItem.update({
      where: { id },
      data: { status: archive ? 'archived' : 'draft' },
      include: ITEM_INCLUDE,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: archive ? 'library.item.archive' : 'library.item.unpublish',
      entityType: 'LibraryItem',
      entityId: id,
    });
    await this.reindex(updated);
    return this.toPublic(updated, actor);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const row = await this.editableRow(id, actor);
    await this.prisma.libraryItem.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'archived' },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: 'library.item.delete',
      entityType: 'LibraryItem',
      entityId: id,
    });
    await this.deindex(id);
  }

  async review(id: string, dto: ReviewItemDto, actor: AuthenticatedUser) {
    const row = await this.rowOrThrow(id);
    if (!canReview(this.visibleOf(row), this.viewer(actor)))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'You do not review items of this reach.',
      });
    if (row.status !== 'pending_review')
      throw new BadRequestException({
        code: 'library.not_pending',
        detail: 'This item is not waiting for review.',
      });
    const updated = await this.prisma.libraryItem.update({
      where: { id },
      data: {
        status: dto.decision === 'approve' ? 'published' : 'rejected',
        reviewedById: actor.id,
        reviewedAt: new Date(),
        reviewNote: dto.note ?? null,
        ...(dto.decision === 'approve'
          ? { publishedAt: row.publishedAt ?? new Date() }
          : {}),
      },
      include: ITEM_INCLUDE,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: `library.item.${dto.decision}`,
      entityType: 'LibraryItem',
      entityId: id,
      details: { note: dto.note ?? null },
    });
    await this.reindex(updated);
    return this.toPublic(updated, actor);
  }

  // ---------------------------------------------------------------------------
  // Versions, ratings, flags, copies
  // ---------------------------------------------------------------------------

  async versions(id: string, actor: AuthenticatedUser) {
    await this.visibleRow(id, actor);
    const rows = await this.prisma.libraryItemVersion.findMany({
      where: { itemId: id },
      orderBy: { version: 'desc' },
    });
    return rows.map((v) => ({
      version: v.version,
      title: v.title,
      description: v.description,
      note: v.note,
      createdById: v.createdById,
      createdAt: v.createdAt,
      snapshot: JSON.parse(v.snapshot) as Record<string, unknown>,
    }));
  }

  /** Puts an earlier version's metadata (and parameters) back as a new version. */
  async restore(id: string, version: number, actor: AuthenticatedUser) {
    const row = await this.editableRow(id, actor);
    const v = await this.prisma.libraryItemVersion.findUnique({
      where: { itemId_version: { itemId: id, version } },
    });
    if (!v)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Version not found.',
      });
    const snap = JSON.parse(v.snapshot) as {
      title: string;
      description: string | null;
      topics: string[];
      standards: string[];
      keywords: string | null;
      parameters: unknown;
    };
    if (snap.parameters && row.h5pContentId)
      await this.h5p.update(
        row.h5pContentId,
        { parameters: snap.parameters as Record<string, unknown> },
        actor,
      );
    const updated = await this.prisma.libraryItem.update({
      where: { id },
      data: {
        title: snap.title,
        description: snap.description,
        topics: JSON.stringify(snap.topics ?? []),
        standards: JSON.stringify(snap.standards ?? []),
        keywords: snap.keywords,
        version: { increment: 1 },
      },
      include: ITEM_INCLUDE,
    });
    await this.prisma.libraryItemVersion.create({
      data: {
        id: newId(),
        itemId: id,
        version: updated.version,
        title: updated.title,
        description: updated.description,
        snapshot: v.snapshot,
        note: `Restored version ${version}`,
        createdById: actor.id,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: 'library.item.restore',
      entityType: 'LibraryItem',
      entityId: id,
      details: { from: version, to: updated.version },
    });
    await this.reindex(updated);
    return this.toPublic(updated, actor);
  }

  async rate(id: string, dto: RateItemDto, actor: AuthenticatedUser) {
    const row = await this.visibleRow(id, actor);
    if (row.createdById === actor.id)
      throw new BadRequestException({
        code: 'library.own_item',
        detail: 'You cannot rate your own item.',
      });
    await this.prisma.libraryRating.upsert({
      where: { itemId_userId: { itemId: id, userId: actor.id } },
      create: {
        id: newId(),
        itemId: id,
        userId: actor.id,
        stars: dto.stars,
        comment: dto.comment ?? null,
      },
      update: { stars: dto.stars, comment: dto.comment ?? null },
    });
    const agg = await this.prisma.libraryRating.aggregate({
      where: { itemId: id },
      _sum: { stars: true },
      _count: { _all: true },
    });
    const updated = await this.prisma.libraryItem.update({
      where: { id },
      data: { ratingSum: agg._sum.stars ?? 0, ratingCount: agg._count._all },
      include: ITEM_INCLUDE,
    });
    return this.toPublic(updated, actor);
  }

  async flag(id: string, dto: FlagItemDto, actor: AuthenticatedUser) {
    const row = await this.visibleRow(id, actor);
    const open = await this.prisma.libraryFlag.findFirst({
      where: { itemId: id, userId: actor.id, status: 'open' },
    });
    if (open) return { id: open.id, status: open.status };
    const flag = await this.prisma.libraryFlag.create({
      data: {
        id: newId(),
        itemId: id,
        userId: actor.id,
        reason: dto.details ? `${dto.reason}: ${dto.details}` : dto.reason,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: 'library.item.flag',
      entityType: 'LibraryItem',
      entityId: id,
      details: { reason: dto.reason },
    });
    return { id: flag.id, status: flag.status };
  }

  async resolveFlag(
    flagId: string,
    dto: ResolveFlagDto,
    actor: AuthenticatedUser,
  ) {
    const flag = await this.prisma.libraryFlag.findUnique({
      where: { id: flagId },
      include: { item: { include: ITEM_INCLUDE } },
    });
    if (!flag)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Flag not found.',
      });
    const viewer = this.viewer(actor);
    if (
      !canReview(this.visibleOf(flag.item), viewer) &&
      !canEdit(this.visibleOf(flag.item), viewer)
    )
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'You do not moderate this item.',
      });
    await this.prisma.libraryFlag.update({
      where: { id: flagId },
      data: {
        status: 'resolved',
        resolvedById: actor.id,
        resolvedAt: new Date(),
        resolution: `${dto.action}${dto.note ? `: ${dto.note}` : ''}`,
      },
    });
    if (dto.action === 'unpublish') {
      const updated = await this.prisma.libraryItem.update({
        where: { id: flag.itemId },
        data: {
          status: 'rejected',
          reviewedById: actor.id,
          reviewedAt: new Date(),
          reviewNote: dto.note ?? 'Taken down after a report',
        },
        include: ITEM_INCLUDE,
      });
      await this.reindex(updated);
    }
    await this.audit.record({
      userId: actor.id,
      organizationId: flag.item.organizationId,
      action: 'library.flag.resolve',
      entityType: 'LibraryItem',
      entityId: flag.itemId,
      details: { action: dto.action },
    });
    return { id: flagId, status: 'resolved' };
  }

  /** Remix: a private draft copy in the person's own school; interactive content is duplicated, documents and links point at the same source. */
  async copy(id: string, actor: AuthenticatedUser) {
    const row = await this.visibleRow(id, actor);
    if (!actor.organizationId)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Your account is not attached to a school.',
      });
    const viewer = this.viewer(actor);
    if (allowedVisibilities(viewer).length === 1)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only staff copy library items.',
      });
    let h5pContentId = row.h5pContentId;
    if (row.kind === 'h5p' && row.h5pContentId) {
      const src = await this.prisma.h5PContent.findFirst({
        where: { id: row.h5pContentId, deletedAt: null },
      });
      if (!src)
        throw new NotFoundException({
          code: 'resource.not_found',
          detail: 'The interactive content behind this item is gone.',
        });
      const created = await this.h5p.create(
        {
          title: `${src.title} (copy)`,
          library: src.library,
          parameters: JSON.parse(src.parameters) as Record<string, unknown>,
          subject: src.subject ?? undefined,
          gradeLevel: src.gradeLevel ?? undefined,
          topic: src.topic ?? undefined,
        },
        actor,
        { source: 'MANUAL', difficulty: src.difficulty },
      );
      h5pContentId = created.id;
    }
    const item = await this.prisma.libraryItem.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        createdById: actor.id,
        kind: row.kind,
        title: `${row.title} (copy)`,
        description: row.description,
        subject: row.subject,
        gradeLevel: row.gradeLevel,
        topics: row.topics,
        standards: row.standards,
        keywords: row.keywords,
        visibility: 'private',
        status: 'draft',
        h5pContentId,
        fileId: row.fileId,
        url: row.url,
        lessonPlanId: row.lessonPlanId,
        sourceItemId: row.id,
      },
      include: ITEM_INCLUDE,
    });
    await this.prisma.libraryItemVersion.create({
      data: {
        id: newId(),
        itemId: item.id,
        version: 1,
        title: item.title,
        description: item.description,
        snapshot: snapshotOf(item, await this.h5pParameters(item.h5pContentId)),
        note: `Copied from ${row.title}`,
        createdById: actor.id,
      },
    });
    await this.prisma.libraryItem.update({
      where: { id },
      data: { copyCount: { increment: 1 } },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'library.item.copy',
      entityType: 'LibraryItem',
      entityId: item.id,
      details: { sourceItemId: id },
    });
    return this.toPublic(item, actor);
  }

  /** The document behind an item, for anyone who may see the item. */
  async download(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{ absolutePath: string; fileName: string; mimeType: string }> {
    const row = await this.visibleRow(id, actor);
    if (!row.fileId)
      throw new BadRequestException({
        code: 'library.no_file',
        detail: 'This item has no document to download.',
      });
    const file = await this.files.pathFor(row.fileId);
    await this.prisma.libraryItem
      .update({ where: { id }, data: { downloadCount: { increment: 1 } } })
      .catch(() => undefined);
    return file;
  }

  // ---------------------------------------------------------------------------
  // Collections
  // ---------------------------------------------------------------------------

  async listCollections(actor: AuthenticatedUser) {
    const viewer = this.viewer(actor);
    const rows = await this.prisma.libraryCollection.findMany({
      where: {
        deletedAt: null,
        OR: [
          { createdById: actor.id },
          { visibility: 'public' },
          ...(actor.tenantId
            ? [
                {
                  visibility: 'district',
                  organization: { tenantId: actor.tenantId },
                },
              ]
            : []),
          ...(actor.organizationId
            ? [{ visibility: 'school', organizationId: actor.organizationId }]
            : []),
        ],
      },
      include: {
        organization: { select: { name: true, tenantId: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        _count: { select: { items: true, followers: true } },
        followers: { where: { userId: actor.id }, select: { id: true } },
      },
      orderBy: [{ featured: 'desc' }, { updatedAt: 'desc' }],
    });
    return rows
      .filter((c) =>
        canSee(
          { ...c, tenantId: c.organization.tenantId, status: 'published' },
          viewer,
        ),
      )
      .map((c) => this.toPublicCollection(c, actor));
  }

  async getCollection(id: string, actor: AuthenticatedUser) {
    const c = await this.prisma.libraryCollection.findFirst({
      where: { id, deletedAt: null },
      include: {
        organization: { select: { name: true, tenantId: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        _count: { select: { items: true, followers: true } },
        followers: { where: { userId: actor.id }, select: { id: true } },
        items: {
          orderBy: { sortOrder: 'asc' },
          include: { item: { include: ITEM_INCLUDE } },
        },
      },
    });
    if (
      !c ||
      !canSee(
        { ...c, tenantId: c.organization.tenantId, status: 'published' },
        this.viewer(actor),
      )
    )
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Collection not found.',
      });
    return {
      ...this.toPublicCollection(c, actor),
      items: c.items
        .filter((i) => this.visible(i.item, actor))
        .map((i) => this.toPublic(i.item, actor)),
    };
  }

  async createCollection(dto: CreateCollectionDto, actor: AuthenticatedUser) {
    if (!actor.organizationId)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Your account is not attached to a school.',
      });
    const visibility = dto.visibility ?? 'private';
    if (!allowedVisibilities(this.viewer(actor)).includes(visibility))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'You may not share collections that widely.',
      });
    const c = await this.prisma.libraryCollection.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        createdById: actor.id,
        title: dto.title,
        description: dto.description ?? null,
        visibility,
      },
      include: {
        organization: { select: { name: true, tenantId: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        _count: { select: { items: true, followers: true } },
        followers: { where: { userId: actor.id }, select: { id: true } },
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'library.collection.create',
      entityType: 'LibraryCollection',
      entityId: c.id,
    });
    return this.toPublicCollection(c, actor);
  }

  async updateCollection(
    id: string,
    dto: UpdateCollectionDto,
    actor: AuthenticatedUser,
  ) {
    const c = await this.editableCollection(id, actor);
    if (
      dto.visibility &&
      !allowedVisibilities(this.viewer(actor)).includes(dto.visibility)
    )
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'You may not share collections that widely.',
      });
    if (
      dto.featured !== undefined &&
      !canReview(
        { ...c, tenantId: c.organization.tenantId, status: 'published' },
        this.viewer(actor),
      )
    )
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only administrators feature collections.',
      });
    const updated = await this.prisma.libraryCollection.update({
      where: { id },
      data: { ...dto },
      include: {
        organization: { select: { name: true, tenantId: true } },
        createdBy: { select: { firstName: true, lastName: true } },
        _count: { select: { items: true, followers: true } },
        followers: { where: { userId: actor.id }, select: { id: true } },
      },
    });
    return this.toPublicCollection(updated, actor);
  }

  async removeCollection(id: string, actor: AuthenticatedUser): Promise<void> {
    await this.editableCollection(id, actor);
    await this.prisma.libraryCollection.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async addToCollection(
    id: string,
    dto: AddCollectionItemDto,
    actor: AuthenticatedUser,
  ) {
    await this.editableCollection(id, actor);
    await this.visibleRow(dto.itemId, actor);
    const last = await this.prisma.libraryCollectionItem.aggregate({
      where: { collectionId: id },
      _max: { sortOrder: true },
    });
    await this.prisma.libraryCollectionItem.upsert({
      where: { collectionId_itemId: { collectionId: id, itemId: dto.itemId } },
      create: {
        id: newId(),
        collectionId: id,
        itemId: dto.itemId,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
      },
      update: {},
    });
    return this.getCollection(id, actor);
  }

  async removeFromCollection(
    id: string,
    itemId: string,
    actor: AuthenticatedUser,
  ) {
    await this.editableCollection(id, actor);
    await this.prisma.libraryCollectionItem.deleteMany({
      where: { collectionId: id, itemId },
    });
    return this.getCollection(id, actor);
  }

  async follow(id: string, actor: AuthenticatedUser, on: boolean) {
    await this.getCollection(id, actor);
    if (on)
      await this.prisma.libraryCollectionFollower.upsert({
        where: { collectionId_userId: { collectionId: id, userId: actor.id } },
        create: { id: newId(), collectionId: id, userId: actor.id },
        update: {},
      });
    else
      await this.prisma.libraryCollectionFollower.deleteMany({
        where: { collectionId: id, userId: actor.id },
      });
    return this.getCollection(id, actor);
  }

  // ---------------------------------------------------------------------------
  // Moderation
  // ---------------------------------------------------------------------------

  /** Items waiting for this person's review and open reports on items they moderate. */
  async moderationQueue(actor: AuthenticatedUser) {
    const viewer = this.viewer(actor);
    const scope = this.moderatorScope(actor);
    const [pending, flags] = await Promise.all([
      this.prisma.libraryItem.findMany({
        where: { deletedAt: null, status: 'pending_review', ...scope },
        include: ITEM_INCLUDE,
        orderBy: { updatedAt: 'asc' },
      }),
      this.prisma.libraryFlag.findMany({
        where: { status: 'open', item: { deletedAt: null, ...scope } },
        include: {
          item: { include: ITEM_INCLUDE },
          user: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return {
      pending: pending
        .filter((r) => canReview(this.visibleOf(r), viewer))
        .map((r) => this.toPublic(r, actor)),
      flags: flags
        .filter(
          (f) =>
            canReview(this.visibleOf(f.item), viewer) ||
            canEdit(this.visibleOf(f.item), viewer),
        )
        .map((f) => ({
          id: f.id,
          reason: f.reason,
          reportedBy: `${f.user.firstName} ${f.user.lastName}`.trim(),
          createdAt: f.createdAt,
          item: this.toPublic(f.item, actor),
        })),
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private viewer(actor: AuthenticatedUser): Viewer {
    return {
      id: actor.id,
      role: actor.role,
      organizationId: actor.organizationId,
      tenantId: actor.tenantId,
      tenantOrganizationIds: actor.tenantOrganizationIds,
    };
  }

  private visibleOf(row: {
    createdById: string | null;
    organizationId: string;
    visibility: string;
    status: string;
    deletedAt: Date | null;
    organization: { tenantId: string };
  }): VisibleItem {
    return {
      createdById: row.createdById,
      organizationId: row.organizationId,
      tenantId: row.organization.tenantId,
      visibility: row.visibility,
      status: row.status,
      deletedAt: row.deletedAt,
    };
  }

  private visible(row: ItemRow, actor: AuthenticatedUser): boolean {
    return canSee(this.visibleOf(row), this.viewer(actor));
  }

  /** The database side of canSee: what a list query may return before the rule confirms each row. */
  private visibleWhere(actor: AuthenticatedUser): Prisma.LibraryItemWhereInput {
    const or: Prisma.LibraryItemWhereInput[] = [
      { createdById: actor.id },
      { status: 'published', visibility: 'public' },
    ];
    if (actor.tenantId)
      or.push({
        status: 'published',
        visibility: 'district',
        organization: { tenantId: actor.tenantId },
      });
    if (actor.organizationId)
      or.push({
        status: 'published',
        visibility: 'school',
        organizationId: actor.organizationId,
      });
    if (actor.role === 'SUPER_ADMIN') return {};
    if (actor.role === 'SUPERINTENDENT')
      or.push({ organizationId: { in: actor.tenantOrganizationIds ?? [] } });
    if (actor.role === 'PRINCIPAL' && actor.organizationId)
      or.push({ organizationId: actor.organizationId });
    return { OR: or };
  }

  private moderatorScope(
    actor: AuthenticatedUser,
  ): Prisma.LibraryItemWhereInput {
    if (actor.role === 'SUPER_ADMIN') return {};
    if (actor.role === 'SUPERINTENDENT')
      return { organization: { tenantId: actor.tenantId ?? '__none__' } };
    return { organizationId: actor.organizationId ?? '__none__' };
  }

  private async rowOrThrow(id: string): Promise<ItemRow> {
    const row = await this.prisma.libraryItem.findFirst({
      where: { id, deletedAt: null },
      include: ITEM_INCLUDE,
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Library item not found.',
      });
    return row;
  }

  private async visibleRow(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<ItemRow> {
    const row = await this.rowOrThrow(id);
    if (!this.visible(row, actor))
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Library item not found.',
      });
    return row;
  }

  private async editableRow(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<ItemRow> {
    const row = await this.rowOrThrow(id);
    if (!canEdit(this.visibleOf(row), this.viewer(actor)))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'You cannot change this item.',
      });
    return row;
  }

  private async editableCollection(id: string, actor: AuthenticatedUser) {
    const c = await this.prisma.libraryCollection.findFirst({
      where: { id, deletedAt: null },
      include: { organization: { select: { tenantId: true } } },
    });
    if (!c)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Collection not found.',
      });
    if (
      !canEdit(
        { ...c, tenantId: c.organization.tenantId, status: 'published' },
        this.viewer(actor),
      )
    )
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'You cannot change this collection.',
      });
    return c;
  }

  /** The source a kind points at must exist and be reachable by the person. */
  private async checkSource(
    kind: string,
    dto: {
      h5pContentId?: string;
      fileId?: string;
      url?: string;
      lessonPlanId?: string;
    },
    actor: AuthenticatedUser,
  ) {
    const out = {
      h5pContentId: null as string | null,
      fileId: null as string | null,
      url: null as string | null,
      lessonPlanId: null as string | null,
    };
    const org = actor.organizationId ?? '__none__';
    if (kind === 'h5p') {
      if (!dto.h5pContentId)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'h5pContentId is required for interactive content.',
        });
      const c = await this.prisma.h5PContent.findFirst({
        where: {
          id: dto.h5pContentId,
          deletedAt: null,
          OR: [{ organizationId: org }, { createdById: actor.id }],
        },
      });
      if (!c)
        throw new NotFoundException({
          code: 'resource.not_found',
          detail: 'Interactive content not found in your school.',
        });
      out.h5pContentId = c.id;
    } else if (kind === 'document') {
      if (!dto.fileId)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'fileId is required for a document.',
        });
      const f = await this.prisma.fileUpload.findFirst({
        where: {
          id: dto.fileId,
          deletedAt: null,
          OR: [{ uploaderId: actor.id }, { organizationId: org }],
        },
      });
      if (!f)
        throw new NotFoundException({
          code: 'resource.not_found',
          detail: 'File not found.',
        });
      out.fileId = f.id;
    } else if (kind === 'link') {
      if (!dto.url || !isSafeUrl(dto.url))
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'A web address starting with https:// is required.',
        });
      out.url = dto.url;
    } else if (kind === 'lesson_plan') {
      if (!dto.lessonPlanId)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'lessonPlanId is required for a lesson plan.',
        });
      const p = await this.prisma.lessonPlan.findFirst({
        where: {
          id: dto.lessonPlanId,
          OR: [{ organizationId: org }, { authorId: actor.id }],
        },
      });
      if (!p)
        throw new NotFoundException({
          code: 'resource.not_found',
          detail: 'Lesson plan not found.',
        });
      out.lessonPlanId = p.id;
    }
    return out;
  }

  private async h5pParameters(h5pContentId: string | null): Promise<unknown> {
    if (!h5pContentId) return null;
    const c = await this.prisma.h5PContent.findUnique({
      where: { id: h5pContentId },
      select: { parameters: true },
    });
    return c ? (JSON.parse(c.parameters) as unknown) : null;
  }

  /** Published items are embedded in the district's namespace and, when public, in the shared one; anything else is removed. */
  private async reindex(row: ItemRow): Promise<void> {
    try {
      if (row.status !== 'published' || row.deletedAt) {
        await this.deindex(row.id);
        return;
      }
      const text = embeddingText(row);
      const docs = [
        {
          docId: docIdFor(row.id, 'tenant'),
          organizationId: libraryNamespace(row.organization.tenantId),
          title: row.title,
          text,
        },
      ];
      if (row.visibility === 'public')
        docs.push({
          docId: docIdFor(row.id, 'public'),
          organizationId: PUBLIC_NAMESPACE,
          title: row.title,
          text,
        });
      else await this.ai.ragDelete(docIdFor(row.id, 'public'));
      await this.ai.ragIndex(docs);
    } catch (err) {
      this.log.warn(
        `library index skipped for ${row.id}: ${(err as Error).message}`,
      );
    }
  }

  private async deindex(id: string): Promise<void> {
    try {
      await this.ai.ragDelete(docIdFor(id, 'tenant'));
      await this.ai.ragDelete(docIdFor(id, 'public'));
    } catch (err) {
      this.log.warn(
        `library deindex skipped for ${id}: ${(err as Error).message}`,
      );
    }
  }

  private toPublic(r: ItemRow, actor: AuthenticatedUser) {
    const viewer = this.viewer(actor);
    const v = this.visibleOf(r);
    return {
      id: r.id,
      organizationId: r.organizationId,
      organizationName: r.organization.name,
      kind: r.kind,
      title: r.title,
      description: r.description,
      subject: r.subject,
      gradeLevel: r.gradeLevel,
      topics: parseList(r.topics),
      standards: parseList(r.standards),
      keywords: r.keywords,
      visibility: r.visibility,
      status: r.status,
      version: r.version,
      featured: r.featured,
      h5pContentId: r.h5pContentId,
      h5p: r.h5pContent
        ? {
            contentType: r.h5pContent.contentType,
            library: r.h5pContent.library,
            status: r.h5pContent.status.toLowerCase(),
          }
        : null,
      fileId: r.fileId,
      file: r.file
        ? {
            name: r.file.originalName,
            mimeType: r.file.mimeType,
            sizeBytes: r.file.sizeBytes,
          }
        : null,
      url: r.url,
      lessonPlanId: r.lessonPlanId,
      lessonPlan: r.lessonPlan ? { topic: r.lessonPlan.topic } : null,
      createdBy: r.createdBy
        ? `${r.createdBy.firstName} ${r.createdBy.lastName}`.trim()
        : null,
      createdById: r.createdById,
      sourceItemId: r.sourceItemId,
      counts: {
        views: r.viewCount,
        downloads: r.downloadCount,
        copies: r.copyCount,
      },
      rating: {
        average: averageRating(r.ratingSum, r.ratingCount),
        count: r.ratingCount,
      },
      reviewNote: r.reviewNote,
      publishedAt: r.publishedAt,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      canEdit: canEdit(v, viewer),
      canReview: canReview(v, viewer),
    };
  }

  private toPublicCollection(
    c: {
      id: string;
      organizationId: string;
      createdById: string | null;
      title: string;
      description: string | null;
      visibility: string;
      featured: boolean;
      createdAt: Date;
      updatedAt: Date;
      deletedAt: Date | null;
      organization: { name: string; tenantId: string };
      createdBy: { firstName: string; lastName: string } | null;
      _count: { items: number; followers: number };
      followers: Array<{ id: string }>;
    },
    actor: AuthenticatedUser,
  ) {
    const viewer = this.viewer(actor);
    return {
      id: c.id,
      organizationId: c.organizationId,
      organizationName: c.organization.name,
      title: c.title,
      description: c.description,
      visibility: c.visibility,
      featured: c.featured,
      createdBy: c.createdBy
        ? `${c.createdBy.firstName} ${c.createdBy.lastName}`.trim()
        : null,
      createdById: c.createdById,
      itemCount: c._count.items,
      followerCount: c._count.followers,
      following: c.followers.length > 0,
      canEdit: canEdit(
        { ...c, tenantId: c.organization.tenantId, status: 'published' },
        viewer,
      ),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }
}
