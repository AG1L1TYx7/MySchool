import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { Announcement, Prisma } from '../../generated/prisma/client';
import { PagedResponse } from '../../common/dto/paged-response.dto';
import { domainEvent } from '../../common/events/domain-event';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import {
  assertOrganizationAccess,
  isDistrictRole,
  organizationScope,
  resolveOrganizationId,
} from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canManage } from '../classes/classes.service';
import {
  canEdit,
  compareForFeed,
  isVisibleTo,
  type Viewer,
} from './announcement-rules';
import {
  CreateAnnouncementDto,
  ListAnnouncementsQuery,
  UpdateAnnouncementDto,
} from './dto/announcements.dto';

export interface PublicAnnouncement {
  id: string;
  organizationId: string;
  classId: string | null;
  className: string | null;
  author: { id: string; firstName: string; lastName: string } | null;
  title: string;
  content: string;
  type: string;
  priority: string;
  status: string;
  pinned: boolean;
  publishedAt: Date | null;
  expiresAt: Date | null;
  canEdit: boolean;
  createdAt: Date;
  updatedAt: Date;
}

type Row = Announcement & {
  class: { name: string } | null;
  author: { id: string; firstName: string; lastName: string } | null;
};

@Injectable()
export class AnnouncementsService {
  private readonly include = {
    class: { select: { name: true } },
    author: { select: { id: true, firstName: true, lastName: true } },
  } satisfies Prisma.AnnouncementInclude;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  async list(
    q: ListAnnouncementsQuery,
    actor: AuthenticatedUser,
  ): Promise<PagedResponse<PublicAnnouncement>> {
    const viewer = await this.viewer(actor);
    const where: Prisma.AnnouncementWhereInput = {
      deletedAt: null,
      ...organizationScope(actor, q.organizationId),
    };
    if (q.classId) where.classId = q.classId;
    if (q.type) where.type = q.type.toUpperCase() as Announcement['type'];
    if (q.priority)
      where.priority = q.priority.toUpperCase() as Announcement['priority'];
    if (q.status)
      where.status = q.status.toUpperCase() as Announcement['status'];
    if (!viewer.isStaff) {
      where.status = 'PUBLISHED';
      where.OR = [{ classId: null }, { classId: { in: viewer.classIds } }];
      where.AND = [
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      ];
    } else if (!viewer.isAdmin) {
      where.OR = [{ status: 'PUBLISHED' }, { authorId: actor.id }];
    }
    const rows = await this.prisma.announcement.findMany({
      where,
      include: this.include,
      orderBy: [
        { pinned: 'desc' },
        { publishedAt: 'desc' },
        { createdAt: 'desc' },
      ],
      take: 500,
    });
    const sorted = rows
      .filter((r) => isVisibleTo(r, viewer))
      .sort(compareForFeed);
    const start = (q.page - 1) * q.pageSize;
    return PagedResponse.of(
      sorted.slice(start, start + q.pageSize).map((r) => toPublic(r, viewer)),
      q,
      sorted.length,
    );
  }

  async get(id: string, actor: AuthenticatedUser): Promise<PublicAnnouncement> {
    const viewer = await this.viewer(actor);
    const row = await this.find(id, actor);
    if (!isVisibleTo(row, viewer))
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Announcement not found.',
      });
    return toPublic(row, viewer);
  }

  async create(
    dto: CreateAnnouncementDto,
    actor: AuthenticatedUser,
  ): Promise<PublicAnnouncement> {
    const organizationId = resolveOrganizationId(actor, dto.organizationId);
    if (dto.classId) await this.assertClass(dto.classId, organizationId, actor);
    else if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.PRINCIPAL)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'School-wide announcements are posted by administrators; choose a class.',
      });
    const publish = dto.publish === true;
    const row = await this.prisma.announcement.create({
      data: {
        id: newId(),
        organizationId,
        classId: dto.classId ?? null,
        authorId: actor.id,
        title: dto.title.trim(),
        content: dto.content.trim(),
        type: (dto.type ?? 'general').toUpperCase() as Announcement['type'],
        priority: (
          dto.priority ?? 'normal'
        ).toUpperCase() as Announcement['priority'],
        pinned: dto.pinned ?? false,
        expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : null,
        status: publish ? 'PUBLISHED' : 'DRAFT',
        publishedAt: publish ? new Date() : null,
      },
      include: this.include,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'announcements.create',
      entityType: 'Announcement',
      entityId: row.id,
      details: { classId: row.classId, publish },
    });
    if (publish) this.emitPublished(row, actor);
    return toPublic(row, await this.viewer(actor));
  }

  async update(
    id: string,
    dto: UpdateAnnouncementDto,
    actor: AuthenticatedUser,
  ): Promise<PublicAnnouncement> {
    const viewer = await this.viewer(actor);
    const row = await this.find(id, actor);
    if (!canEdit(row, viewer))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only the author or an administrator can edit this announcement.',
      });
    if (dto.classId !== undefined && dto.classId !== null)
      await this.assertClass(dto.classId, row.organizationId, actor);
    const data: Prisma.AnnouncementUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.content !== undefined) data.content = dto.content.trim();
    if (dto.type !== undefined)
      data.type = dto.type.toUpperCase() as Announcement['type'];
    if (dto.priority !== undefined)
      data.priority = dto.priority.toUpperCase() as Announcement['priority'];
    if (dto.pinned !== undefined) data.pinned = dto.pinned;
    if (dto.expiresAt !== undefined)
      data.expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : null;
    if (dto.classId !== undefined)
      data.class = dto.classId
        ? { connect: { id: dto.classId } }
        : { disconnect: true };
    const updated = await this.prisma.announcement.update({
      where: { id },
      data,
      include: this.include,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: 'announcements.update',
      entityType: 'Announcement',
      entityId: id,
      details: { fields: Object.keys(data) },
    });
    return toPublic(updated, viewer);
  }

  async publish(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<PublicAnnouncement> {
    const viewer = await this.viewer(actor);
    const row = await this.find(id, actor);
    if (!canEdit(row, viewer))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only the author or an administrator can publish this announcement.',
      });
    if (row.status === 'PUBLISHED')
      throw new BadRequestException({
        code: 'announcement.already_published',
        detail: 'Already published.',
      });
    const updated = await this.prisma.announcement.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
      include: this.include,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: 'announcements.publish',
      entityType: 'Announcement',
      entityId: id,
    });
    this.emitPublished(updated, actor);
    return toPublic(updated, viewer);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const viewer = await this.viewer(actor);
    const row = await this.find(id, actor);
    if (!canEdit(row, viewer))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only the author or an administrator can delete this announcement.',
      });
    await this.prisma.announcement.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'ARCHIVED' },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: 'announcements.delete',
      entityType: 'Announcement',
      entityId: id,
    });
  }

  // ---------------------------------------------------------------------------

  private emitPublished(row: Row, actor: AuthenticatedUser): void {
    this.events.emit(
      'announcement.published',
      domainEvent({
        eventType: 'announcement.published',
        entityType: 'Announcement',
        entityId: row.id,
        organizationId: row.organizationId,
        actorId: actor.id,
        data: {
          announcementId: row.id,
          title: row.title,
          classId: row.classId,
          priority: row.priority,
          type: row.type,
        },
      }),
    );
  }

  private async assertClass(
    classId: string,
    organizationId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        teachers: { select: { teacherId: true } },
      },
    });
    if (!klass || klass.organizationId !== organizationId)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    if (!canManage(klass, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only a teacher of that class or an administrator can post to it.',
      });
  }

  private async find(id: string, actor: AuthenticatedUser): Promise<Row> {
    const row = await this.prisma.announcement.findFirst({
      where: { id, deletedAt: null },
      include: this.include,
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Announcement not found.',
      });
    if (!isDistrictRole(actor))
      assertOrganizationAccess(actor, row.organizationId);
    return row;
  }

  /** The viewer's standing: staff level and the classes they teach, attend or have a child in. */
  async viewer(actor: AuthenticatedUser): Promise<Viewer> {
    const isStaff = ROLE_LEVEL[actor.role] >= ROLE_LEVEL.TEACHER;
    const isAdmin = ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL;
    if (isAdmin) return { id: actor.id, isStaff, isAdmin, classIds: [] };
    let classIds: string[] = [];
    if (isStaff) {
      classIds = (
        await this.prisma.classTeacher.findMany({
          where: { teacherId: actor.id },
          select: { classId: true },
        })
      ).map((c) => c.classId);
    } else if (actor.role === 'STUDENT') {
      classIds = (
        await this.prisma.classEnrollment.findMany({
          where: {
            student: { userId: actor.id },
            status: { in: ['ENROLLED', 'COMPLETED'] },
          },
          select: { classId: true },
        })
      ).map((c) => c.classId);
    } else if (actor.role === 'PARENT') {
      classIds = (
        await this.prisma.classEnrollment.findMany({
          where: {
            student: { guardians: { some: { guardianUserId: actor.id } } },
            status: { in: ['ENROLLED', 'COMPLETED'] },
          },
          select: { classId: true },
        })
      ).map((c) => c.classId);
    }
    return { id: actor.id, isStaff, isAdmin, classIds: [...new Set(classIds)] };
  }
}

function toPublic(r: Row, viewer: Viewer): PublicAnnouncement {
  return {
    id: r.id,
    organizationId: r.organizationId,
    classId: r.classId,
    className: r.class?.name ?? null,
    author: r.author,
    title: r.title,
    content: r.content,
    type: r.type.toLowerCase(),
    priority: r.priority.toLowerCase(),
    status: r.status.toLowerCase(),
    pinned: r.pinned,
    publishedAt: r.publishedAt,
    expiresAt: r.expiresAt,
    canEdit: canEdit(r, viewer),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}
