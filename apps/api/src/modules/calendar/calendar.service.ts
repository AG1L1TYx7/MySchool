import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CalendarEvent, Prisma } from '../../generated/prisma/client';
import { newId } from '../../common/utils/ids';
import { randomToken } from '../../common/utils/tokens';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import {
  assertOrganizationAccess,
  isDistrictRole,
  resolveOrganizationId,
} from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canManage } from '../classes/classes.service';
import { CreateEventDto, FeedQuery, UpdateEventDto } from './dto/calendar.dto';

export interface FeedItem {
  id: string;
  kind: 'event' | 'assignment' | 'term';
  type: string;
  title: string;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  classId: string | null;
  className: string | null;
  link: string | null;
  canEdit: boolean;
}

/**
 * The school calendar (docs/13 section 3): days off and school events for everyone in the organisation,
 * class events for members of the class, assignment due dates and term boundaries folded into the same feed,
 * and a private iCal subscription per user.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async feed(q: FeedQuery, actor: AuthenticatedUser): Promise<FeedItem[]> {
    const from = new Date(`${q.from}T00:00:00Z`);
    const to = new Date(`${q.to}T23:59:59Z`);
    if (to.getTime() - from.getTime() > 400 * 86_400_000 || to < from)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Ask for at most 400 days, from before to.',
      });
    const classIds = await this.myClassIds(actor);
    const organizationId = actor.organizationId;
    const staff = ROLE_LEVEL[actor.role] >= ROLE_LEVEL.TEACHER;
    const admin = ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL;

    const events = await this.prisma.calendarEvent.findMany({
      where: {
        startsAt: { lte: to },
        OR: [
          { endsAt: { gte: from } },
          { endsAt: null, startsAt: { gte: from } },
        ],
        ...(q.classId ? { classId: q.classId } : {}),
        AND: [
          {
            OR: [
              { classId: null, ...(organizationId ? { organizationId } : {}) },
              { classId: { in: classIds } },
            ],
          },
        ],
      },
      include: { class: { select: { name: true } } },
      orderBy: { startsAt: 'asc' },
      take: 2000,
    });
    const assignments = await this.prisma.assignment.findMany({
      where: {
        deletedAt: null,
        status: { in: ['PUBLISHED', 'CLOSED'] },
        dueAt: { gte: from, lte: to },
        classId: q.classId ? q.classId : { in: classIds },
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        classId: true,
        class: { select: { name: true } },
      },
      orderBy: { dueAt: 'asc' },
      take: 2000,
    });
    const terms =
      organizationId && !q.classId
        ? await this.prisma.term.findMany({
            where: {
              academicYear: { organizationId },
              OR: [
                { startDate: { gte: from, lte: to } },
                { endDate: { gte: from, lte: to } },
              ],
            },
            select: { id: true, name: true, startDate: true, endDate: true },
          })
        : [];

    const items: FeedItem[] = [
      ...events.map((e) => ({
        id: e.id,
        kind: 'event' as const,
        type: e.type.toLowerCase(),
        title: e.title,
        startsAt: e.startsAt.toISOString(),
        endsAt: e.endsAt?.toISOString() ?? null,
        allDay: e.allDay,
        classId: e.classId,
        className: e.class?.name ?? null,
        link: e.classId ? `/classes/${e.classId}` : null,
        canEdit: admin || (staff && e.createdById === actor.id),
      })),
      ...assignments.map((a) => ({
        id: a.id,
        kind: 'assignment' as const,
        type: 'assignment_due',
        title: a.title,
        startsAt: (a.dueAt as Date).toISOString(),
        endsAt: null,
        allDay: false,
        classId: a.classId,
        className: a.class.name,
        link: `/assignments/${a.id}`,
        canEdit: false,
      })),
      ...terms.flatMap((t) => {
        const out: FeedItem[] = [];
        if (t.startDate >= from && t.startDate <= to)
          out.push({
            id: `${t.id}:start`,
            kind: 'term',
            type: 'term_start',
            title: `${t.name} begins`,
            startsAt: t.startDate.toISOString(),
            endsAt: null,
            allDay: true,
            classId: null,
            className: null,
            link: null,
            canEdit: false,
          });
        if (t.endDate >= from && t.endDate <= to)
          out.push({
            id: `${t.id}:end`,
            kind: 'term',
            type: 'term_end',
            title: `${t.name} ends`,
            startsAt: t.endDate.toISOString(),
            endsAt: null,
            allDay: true,
            classId: null,
            className: null,
            link: null,
            canEdit: false,
          });
        return out;
      }),
    ];
    return items.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  }

  async create(dto: CreateEventDto, actor: AuthenticatedUser) {
    const organizationId = resolveOrganizationId(actor, dto.organizationId);
    if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.TEACHER)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only staff add calendar events.',
      });
    if (dto.classId) {
      const klass = await this.prisma.class.findFirst({
        where: { id: dto.classId, deletedAt: null },
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
            'Only a teacher of the class or an administrator adds its events.',
        });
    } else if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.PRINCIPAL) {
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'School-wide events are added by administrators; choose a class.',
      });
    }
    const startsAt = new Date(dto.startsAt);
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (endsAt && endsAt < startsAt)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'The event must end after it starts.',
      });
    const row = await this.prisma.calendarEvent.create({
      data: {
        id: newId(),
        organizationId,
        classId: dto.classId ?? null,
        type: (
          dto.type ?? 'school_event'
        ).toUpperCase() as CalendarEvent['type'],
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        startsAt,
        endsAt,
        allDay: dto.allDay ?? true,
        createdById: actor.id,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'calendar.event.create',
      entityType: 'CalendarEvent',
      entityId: row.id,
      details: { type: row.type, classId: row.classId },
    });
    return this.toPublic(row, actor);
  }

  async update(id: string, dto: UpdateEventDto, actor: AuthenticatedUser) {
    await this.findEditable(id, actor);
    const data: Prisma.CalendarEventUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.type !== undefined)
      data.type = dto.type.toUpperCase() as CalendarEvent['type'];
    if (dto.description !== undefined)
      data.description = dto.description.trim() || null;
    if (dto.startsAt !== undefined) data.startsAt = new Date(dto.startsAt);
    if (dto.endsAt !== undefined)
      data.endsAt = dto.endsAt ? new Date(dto.endsAt) : null;
    if (dto.allDay !== undefined) data.allDay = dto.allDay;
    const updated = await this.prisma.calendarEvent.update({
      where: { id },
      data,
    });
    return this.toPublic(updated, actor);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const row = await this.findEditable(id, actor);
    await this.prisma.calendarEvent.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: 'calendar.event.delete',
      entityType: 'CalendarEvent',
      entityId: id,
    });
  }

  /** A private subscription URL; rotating it invalidates the old one. */
  async icalToken(actor: AuthenticatedUser, rotate: boolean): Promise<string> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { icalToken: true },
    });
    if (user.icalToken && !rotate) return user.icalToken;
    const token = randomToken(24);
    await this.prisma.user.update({
      where: { id: actor.id },
      data: { icalToken: token },
    });
    return token;
  }

  /** iCalendar text for the next 180 days (and the past 30) for the user behind the token. */
  async ical(token: string): Promise<string> {
    const user = await this.prisma.user.findFirst({
      where: { icalToken: token, status: 'ACTIVE', deletedAt: null },
      include: { organization: { select: { tenantId: true } } },
    });
    if (!user)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Calendar not found.',
      });
    const actor: AuthenticatedUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      sessionId: 'ical',
      mfaSetupRequired: false,
      tenantId: user.organization?.tenantId ?? null,
    };
    const from = new Date(Date.now() - 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const to = new Date(Date.now() + 180 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const items = await this.feed({ from, to }, actor);
    const esc = (s: string) =>
      s
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\n/g, '\\n');
    const stamp = (d: string) =>
      new Date(d)
        .toISOString()
        .replace(/[-:]/g, '')
        .replace(/\.\d{3}Z$/, 'Z');
    const dateOnly = (d: string) =>
      new Date(d).toISOString().slice(0, 10).replace(/-/g, '');
    const lines = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//SmartSchool//Calendar//EN',
      'CALSCALE:GREGORIAN',
      'X-WR-CALNAME:SmartSchool',
    ];
    for (const i of items) {
      lines.push(
        'BEGIN:VEVENT',
        `UID:${i.id}@smartschool`,
        `DTSTAMP:${stamp(new Date().toISOString())}`,
      );
      if (i.allDay) {
        lines.push(`DTSTART;VALUE=DATE:${dateOnly(i.startsAt)}`);
        if (i.endsAt)
          lines.push(
            `DTEND;VALUE=DATE:${dateOnly(new Date(new Date(i.endsAt).getTime() + 86_400_000).toISOString())}`,
          );
      } else {
        lines.push(`DTSTART:${stamp(i.startsAt)}`);
        if (i.endsAt) lines.push(`DTEND:${stamp(i.endsAt)}`);
      }
      lines.push(
        `SUMMARY:${esc(i.className ? `${i.title} (${i.className})` : i.title)}`,
        `CATEGORIES:${i.type.toUpperCase()}`,
        'END:VEVENT',
      );
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  // ---------------------------------------------------------------------------

  private async myClassIds(actor: AuthenticatedUser): Promise<string[]> {
    if (isDistrictRole(actor) || actor.role === 'PRINCIPAL') {
      const rows = await this.prisma.class.findMany({
        where: {
          deletedAt: null,
          ...(actor.organizationId
            ? { organizationId: actor.organizationId }
            : {}),
        },
        select: { id: true },
        take: 5000,
      });
      return rows.map((r) => r.id);
    }
    if (
      ROLE_LEVEL[actor.role] >= ROLE_LEVEL.TEACHER ||
      actor.role === 'ASSISTANT'
    )
      return (
        await this.prisma.classTeacher.findMany({
          where: { teacherId: actor.id },
          select: { classId: true },
        })
      ).map((c) => c.classId);
    if (actor.role === 'STUDENT')
      return (
        await this.prisma.classEnrollment.findMany({
          where: {
            student: { userId: actor.id },
            status: { in: ['ENROLLED', 'COMPLETED'] },
          },
          select: { classId: true },
        })
      ).map((c) => c.classId);
    return (
      await this.prisma.classEnrollment.findMany({
        where: {
          student: { guardians: { some: { guardianUserId: actor.id } } },
          status: { in: ['ENROLLED', 'COMPLETED'] },
        },
        select: { classId: true },
      })
    ).map((c) => c.classId);
  }

  private async findEditable(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<CalendarEvent> {
    const row = await this.prisma.calendarEvent.findUnique({ where: { id } });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Event not found.',
      });
    if (!isDistrictRole(actor))
      assertOrganizationAccess(actor, row.organizationId);
    const admin = ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL;
    if (!admin && row.createdById !== actor.id)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only the creator or an administrator can change this event.',
      });
    return row;
  }

  private toPublic(e: CalendarEvent, actor: AuthenticatedUser) {
    return {
      id: e.id,
      organizationId: e.organizationId,
      classId: e.classId,
      type: e.type.toLowerCase(),
      title: e.title,
      description: e.description,
      startsAt: e.startsAt,
      endsAt: e.endsAt,
      allDay: e.allDay,
      canEdit:
        ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL ||
        e.createdById === actor.id,
      createdAt: e.createdAt,
    };
  }
}
