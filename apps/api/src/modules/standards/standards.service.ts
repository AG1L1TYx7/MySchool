import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Prisma,
  Standard,
  StandardSet,
} from '../../generated/prisma/client';
import { PagedResponse } from '../../common/dto/paged-response.dto';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import {
  assertOrganizationAccess,
  isDistrictRole,
  resolveOrganizationId,
} from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { parseCase } from '../gradebook/gradebook-rules';
import {
  CreateSetDto,
  CreateStandardDto,
  ImportCaseDto,
  ListStandardsQuery,
} from './dto/standards.dto';

export interface PublicSet {
  id: string;
  organizationId: string | null;
  code: string;
  name: string;
  subject: string | null;
  jurisdiction: string | null;
  sourceUri: string | null;
  version: string | null;
  standardCount: number;
  shared: boolean;
}
export interface PublicStandard {
  id: string;
  setId: string;
  setCode?: string;
  parentId: string | null;
  code: string;
  description: string;
  gradeLevels: string[];
  sortOrder: number;
}

/**
 * Academic standards (docs/13 section 4): sets shared by every school (Common Core, NGSS) or owned by one
 * district, imported from 1EdTech CASE packages or entered by hand, and tagged on lessons and assignments.
 */
@Injectable()
export class StandardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Sets visible to the actor: shared ones plus their organisation's (district roles: the chosen organisation's). */
  async sets(
    organizationId: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<PublicSet[]> {
    const where = this.visibleSets(organizationId, actor);
    const rows = await this.prisma.standardSet.findMany({
      where,
      include: { _count: { select: { standards: true } } },
      orderBy: [{ organizationId: 'asc' }, { name: 'asc' }],
    });
    return rows.map((r) => toSet(r, r._count.standards));
  }

  async createSet(
    dto: CreateSetDto,
    actor: AuthenticatedUser,
  ): Promise<PublicSet> {
    const organizationId = this.targetOrganization(dto.organizationId, actor);
    const code = dto.code.trim().toUpperCase();
    const dup = await this.prisma.standardSet.findFirst({
      where: { organizationId, code },
    });
    if (dup)
      throw new ConflictException({
        code: 'standards.set_exists',
        detail: `A set with code ${code} already exists.`,
      });
    const row = await this.prisma.standardSet.create({
      data: {
        id: newId(),
        organizationId,
        code,
        name: dto.name.trim(),
        subject: dto.subject,
        jurisdiction: dto.jurisdiction,
        sourceUri: dto.sourceUri,
        version: dto.version,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: organizationId ?? actor.organizationId,
      action: 'standards.set.create',
      entityType: 'StandardSet',
      entityId: row.id,
      details: { code },
    });
    return toSet(row, 0);
  }

  /** Imports a CASE package (JSON) as a new set, or adds missing items to the set with the same code. */
  async importCase(
    json: unknown,
    dto: ImportCaseDto,
    actor: AuthenticatedUser,
  ): Promise<PublicSet & { imported: number; skipped: number }> {
    const organizationId = this.targetOrganization(dto.organizationId, actor);
    let doc;
    try {
      doc = parseCase(json, dto.code);
    } catch (err) {
      throw new BadRequestException({
        code: 'standards.invalid_case',
        detail: err instanceof Error ? err.message : 'Invalid CASE package.',
      });
    }
    if (doc.standards.length === 0)
      throw new BadRequestException({
        code: 'standards.invalid_case',
        detail: 'The package has no standards with statements.',
      });
    const code = (dto.code?.trim().toUpperCase() ?? doc.code).slice(0, 40);
    let set = await this.prisma.standardSet.findFirst({
      where: { organizationId, code },
    });
    if (!set)
      set = await this.prisma.standardSet.create({
        data: {
          id: newId(),
          organizationId,
          code,
          name: doc.name,
          subject: doc.subject,
          jurisdiction: doc.jurisdiction,
          sourceUri: doc.sourceUri,
          version: doc.version,
        },
      });
    const existing = await this.prisma.standard.findMany({
      where: { setId: set.id },
      select: { code: true, id: true },
    });
    const known = new Map(existing.map((e) => [e.code, e.id]));
    const idByIdentifier = new Map<string, string>();
    let imported = 0;
    let skipped = 0;
    // Parents first so children can point at them.
    const ordered = [...doc.standards].sort(
      (a, b) =>
        (a.parentIdentifier ? 1 : 0) - (b.parentIdentifier ? 1 : 0) ||
        a.sortOrder - b.sortOrder,
    );
    for (const s of ordered) {
      if (known.has(s.code)) {
        idByIdentifier.set(s.identifier, known.get(s.code) as string);
        skipped += 1;
        continue;
      }
      const id = newId();
      await this.prisma.standard.create({
        data: {
          id,
          setId: set.id,
          code: s.code,
          description: s.description,
          gradeLevels: s.gradeLevels,
          sortOrder: s.sortOrder,
          parentId: s.parentIdentifier
            ? (idByIdentifier.get(s.parentIdentifier) ?? null)
            : null,
        },
      });
      idByIdentifier.set(s.identifier, id);
      known.set(s.code, id);
      imported += 1;
    }
    // Second pass for children imported before their parent in a flat list.
    for (const s of doc.standards) {
      if (!s.parentIdentifier) continue;
      const id = idByIdentifier.get(s.identifier);
      const parentId = idByIdentifier.get(s.parentIdentifier);
      if (id && parentId)
        await this.prisma.standard.updateMany({
          where: { id, parentId: null },
          data: { parentId },
        });
    }
    await this.audit.record({
      userId: actor.id,
      organizationId: organizationId ?? actor.organizationId,
      action: 'standards.import',
      entityType: 'StandardSet',
      entityId: set.id,
      details: { code, imported, skipped },
    });
    const count = await this.prisma.standard.count({
      where: { setId: set.id },
    });
    return { ...toSet(set, count), imported, skipped };
  }

  async createStandard(
    setId: string,
    dto: CreateStandardDto,
    actor: AuthenticatedUser,
  ): Promise<PublicStandard> {
    const set = await this.editableSet(setId, actor);
    const code = dto.code.trim();
    const dup = await this.prisma.standard.findUnique({
      where: { setId_code: { setId, code } },
    });
    if (dup)
      throw new ConflictException({
        code: 'standards.exists',
        detail: `${code} is already in this set.`,
      });
    let parentId: string | null = null;
    if (dto.parentCode) {
      const parent = await this.prisma.standard.findUnique({
        where: { setId_code: { setId, code: dto.parentCode.trim() } },
      });
      if (!parent)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'Unknown parent code in this set.',
        });
      parentId = parent.id;
    }
    const count = await this.prisma.standard.count({ where: { setId } });
    const row = await this.prisma.standard.create({
      data: {
        id: newId(),
        setId: set.id,
        code,
        description: dto.description.trim(),
        gradeLevels: dto.gradeLevels?.trim() || null,
        parentId,
        sortOrder: dto.sortOrder ?? count,
      },
    });
    return toStandard(row);
  }

  async removeSet(setId: string, actor: AuthenticatedUser): Promise<void> {
    const set = await this.editableSet(setId, actor);
    const used = await this.prisma.assignmentStandard.count({
      where: { standard: { setId } },
    });
    if (used)
      throw new ConflictException({
        code: 'school.in_use',
        detail: `${used} assignment tag${used === 1 ? '' : 's'} use this set.`,
      });
    await this.prisma.standardSet.delete({ where: { id: set.id } });
    await this.audit.record({
      userId: actor.id,
      organizationId: set.organizationId ?? actor.organizationId,
      action: 'standards.set.delete',
      entityType: 'StandardSet',
      entityId: set.id,
    });
  }

  async list(
    q: ListStandardsQuery,
    actor: AuthenticatedUser,
  ): Promise<PagedResponse<PublicStandard>> {
    const where: Prisma.StandardWhereInput = {
      set: q.setId
        ? { id: q.setId, ...this.visibleSets(q.organizationId, actor) }
        : this.visibleSets(q.organizationId, actor),
      ...(q.gradeLevel
        ? {
            OR: [
              { gradeLevels: null },
              { gradeLevels: { contains: q.gradeLevel.toUpperCase() } },
            ],
          }
        : {}),
      ...(q.search
        ? {
            AND: [
              {
                OR: [
                  { code: { contains: q.search } },
                  { description: { contains: q.search } },
                ],
              },
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.standard.findMany({
        where,
        orderBy: [{ setId: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
        skip: q.skip,
        take: q.pageSize,
        include: { set: { select: { code: true } } },
      }),
      this.prisma.standard.count({ where }),
    ]);
    return PagedResponse.of(
      rows.map((r) => ({ ...toStandard(r), setCode: r.set.code })),
      q,
      total,
    );
  }

  /** Validates tag ids for an organisation and returns them deduplicated (used by assignments and lessons). */
  async assertVisible(
    standardIds: string[],
    organizationId: string,
  ): Promise<string[]> {
    const ids = [...new Set(standardIds)];
    if (ids.length === 0) return [];
    const count = await this.prisma.standard.count({
      where: {
        id: { in: ids },
        set: { OR: [{ organizationId: null }, { organizationId }] },
      },
    });
    if (count !== ids.length)
      throw new BadRequestException({
        code: 'request.invalid',
        detail:
          'One or more standards are unknown or belong to another district.',
      });
    return ids;
  }

  async byIds(ids: string[]): Promise<PublicStandard[]> {
    if (ids.length === 0) return [];
    const rows = await this.prisma.standard.findMany({
      where: { id: { in: ids } },
      include: { set: { select: { code: true } } },
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => ({ ...toStandard(r), setCode: r.set.code }));
  }

  // ---------------------------------------------------------------------------

  private visibleSets(
    organizationId: string | undefined,
    actor: AuthenticatedUser,
  ): Prisma.StandardSetWhereInput {
    const orgId = isDistrictRole(actor) ? organizationId : actor.organizationId;
    if (orgId && !isDistrictRole(actor)) assertOrganizationAccess(actor, orgId);
    return orgId
      ? { OR: [{ organizationId: null }, { organizationId: orgId }] }
      : isDistrictRole(actor)
        ? {}
        : { organizationId: null };
  }

  /** Shared sets (no organisation) are a super admin's to create; everyone else works inside their school. */
  private targetOrganization(
    requested: string | undefined,
    actor: AuthenticatedUser,
  ): string | null {
    if (actor.role === 'SUPER_ADMIN' && !requested) return null;
    return resolveOrganizationId(actor, requested);
  }

  private async editableSet(
    setId: string,
    actor: AuthenticatedUser,
  ): Promise<StandardSet> {
    const set = await this.prisma.standardSet.findUnique({
      where: { id: setId },
    });
    if (!set)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Standard set not found.',
      });
    if (set.organizationId === null) {
      if (actor.role !== 'SUPER_ADMIN')
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail:
            'Shared standard sets are maintained by the platform administrator.',
        });
      return set;
    }
    assertOrganizationAccess(actor, set.organizationId);
    if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.TEACHER)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Staff only.',
      });
    return set;
  }
}

function toSet(s: StandardSet, standardCount: number): PublicSet {
  return {
    id: s.id,
    organizationId: s.organizationId,
    code: s.code,
    name: s.name,
    subject: s.subject,
    jurisdiction: s.jurisdiction,
    sourceUri: s.sourceUri,
    version: s.version,
    standardCount,
    shared: s.organizationId === null,
  };
}
export function toStandard(s: Standard): PublicStandard {
  return {
    id: s.id,
    setId: s.setId,
    parentId: s.parentId,
    code: s.code,
    description: s.description,
    gradeLevels: s.gradeLevels ? s.gradeLevels.split(',').filter(Boolean) : [],
    sortOrder: s.sortOrder,
  };
}
