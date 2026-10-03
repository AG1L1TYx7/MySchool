import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  Attendance,
  AttendanceStatus,
  Prisma,
} from '../../generated/prisma/client';
import { PagedResponse } from '../../common/dto/paged-response.dto';
import { domainEvent } from '../../common/events/domain-event';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import { assertOrganizationAccess, organizationScope } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canManage } from '../classes/classes.service';
import { statusForCategory } from '../school/school-rules';
import { parseDate } from '../students/students.mapper';
import {
  dateOnly,
  emptyCounts,
  summarize,
  type AttendanceCounts,
  type AttendanceStatusApi,
} from './attendance-rules';
import {
  BulkAttendanceDto,
  ListAttendanceQuery,
  MarkAttendanceDto,
  UpdateAttendanceDto,
} from './dto/attendance.dto';

export interface PublicAttendance {
  id: string;
  classId: string;
  studentId: string;
  student?: {
    id: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
  };
  date: string;
  status: AttendanceStatusApi;
  code: {
    id: string;
    code: string;
    label: string;
    category: string;
    countsAsPresent: boolean;
  } | null;
  period: { id: string; name: string } | null;
  notes: string | null;
  markedById: string | null;
  updatedAt: Date;
}

@Injectable()
export class AttendanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  async list(
    q: ListAttendanceQuery,
    actor: AuthenticatedUser,
  ): Promise<PagedResponse<PublicAttendance>> {
    const where: Prisma.AttendanceWhereInput = {
      ...this.visibility(actor),
      ...(q.classId ? { classId: q.classId } : {}),
      ...(q.studentId ? { studentId: q.studentId } : {}),
      ...(q.date ? { date: this.day(q.date) } : {}),
      ...(q.from || q.to
        ? {
            date: {
              ...(q.from ? { gte: this.day(q.from) } : {}),
              ...(q.to ? { lte: this.day(q.to) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.attendance.findMany({
        where,
        orderBy: [{ date: 'desc' }, { student: { lastName: 'asc' } }],
        skip: q.skip,
        take: q.pageSize,
        include: this.include,
      }),
      this.prisma.attendance.count({ where }),
    ]);
    return PagedResponse.of(rows.map(toPublic), q, total);
  }

  async mark(
    dto: MarkAttendanceDto,
    actor: AuthenticatedUser,
  ): Promise<PublicAttendance> {
    const klass = await this.manageableClass(dto.classId, actor);
    await this.assertEnrolled(klass.id, [dto.studentId]);
    const code = await this.resolveCode(
      klass.organizationId,
      dto.codeId,
      dto.status,
    );
    await this.assertPeriod(klass.organizationId, dto.periodId);
    const row = await this.upsert(
      klass.id,
      dto.studentId,
      this.day(dto.date),
      code.status,
      dto.notes,
      actor,
      code.id,
      dto.periodId ?? null,
    );
    await this.audit.record({
      userId: actor.id,
      organizationId: klass.organizationId,
      action: 'attendance.mark',
      entityType: 'Attendance',
      entityId: row.id,
      details: {
        classId: klass.id,
        studentId: dto.studentId,
        date: dto.date,
        status: code.status,
        code: code.code,
      },
    });
    this.emit(klass, dto.studentId, dto.date, code.status, actor);
    return toPublic(row);
  }

  async bulk(
    dto: BulkAttendanceDto,
    actor: AuthenticatedUser,
  ): Promise<{ saved: number; records: PublicAttendance[] }> {
    const klass = await this.manageableClass(dto.classId, actor);
    const ids = [...new Set(dto.records.map((r) => r.studentId))];
    if (ids.length !== dto.records.length)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Each student may appear once per request.',
      });
    await this.assertEnrolled(klass.id, ids);
    await this.assertPeriod(klass.organizationId, dto.periodId);
    const day = this.day(dto.date);
    const records: PublicAttendance[] = [];
    for (const r of dto.records) {
      const code = await this.resolveCode(
        klass.organizationId,
        r.codeId,
        r.status,
      );
      const row = await this.upsert(
        klass.id,
        r.studentId,
        day,
        code.status,
        r.notes,
        actor,
        code.id,
        dto.periodId ?? null,
      );
      records.push(toPublic(row));
      this.emit(klass, r.studentId, dto.date, code.status, actor);
    }
    await this.audit.record({
      userId: actor.id,
      organizationId: klass.organizationId,
      action: 'attendance.bulk',
      entityType: 'Class',
      entityId: klass.id,
      details: { date: dto.date, count: records.length },
    });
    return { saved: records.length, records };
  }

  async update(
    id: string,
    dto: UpdateAttendanceDto,
    actor: AuthenticatedUser,
  ): Promise<PublicAttendance> {
    const existing = await this.prisma.attendance.findUnique({
      where: { id },
      include: {
        class: { include: { teachers: { select: { teacherId: true } } } },
      },
    });
    if (!existing)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Attendance record not found.',
      });
    if (!canManage(existing.class, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only an assigned teacher or an administrator can edit attendance for this class.',
      });
    const resolved = dto.codeId
      ? await this.resolveCode(
          existing.class.organizationId,
          dto.codeId,
          undefined,
        )
      : null;
    const row = await this.prisma.attendance.update({
      where: { id },
      data: {
        status: resolved
          ? toDb(resolved.status)
          : dto.status
            ? toDb(dto.status)
            : undefined,
        codeId: resolved ? resolved.id : undefined,
        notes: dto.notes,
        markedById: actor.id,
      },
      include: this.include,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: existing.class.organizationId,
      action: 'attendance.update',
      entityType: 'Attendance',
      entityId: id,
      details: { ...dto },
    });
    return toPublic(row);
  }

  async classSummary(
    classId: string,
    from: string | undefined,
    to: string | undefined,
    actor: AuthenticatedUser,
  ) {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      include: { teachers: { select: { teacherId: true } } },
    });
    if (!klass)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    assertOrganizationAccess(actor, klass.organizationId);
    if (
      ROLE_LEVEL[actor.role] < ROLE_LEVEL.TEACHER &&
      actor.role !== 'ASSISTANT'
    )
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Staff only.',
      });
    const [enrolled, records] = await Promise.all([
      this.prisma.classEnrollment.findMany({
        where: { classId, status: { in: ['ENROLLED', 'COMPLETED'] } },
        include: {
          student: {
            select: {
              id: true,
              studentNumber: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { student: { lastName: 'asc' } },
      }),
      this.prisma.attendance.findMany({
        where: { classId, ...this.range(from, to) },
        select: { studentId: true, status: true, date: true },
      }),
    ]);
    const perStudent = summarize(
      records.map((r) => ({
        studentId: r.studentId,
        status: fromDb(r.status),
      })),
    );
    const days = [...new Set(records.map((r) => dateOnly(r.date)))].sort();
    const rows = enrolled.map((e) => ({
      student: e.student,
      counts: perStudent.get(e.studentId) ?? emptyCounts(),
    }));
    const rated = rows.filter((r) => r.counts.attendanceRate !== null);
    const classRate = rated.length
      ? Math.round(
          (rated.reduce((s, r) => s + (r.counts.attendanceRate ?? 0), 0) /
            rated.length) *
            100,
        ) / 100
      : null;
    return {
      classId,
      className: klass.name,
      from: from ?? null,
      to: to ?? null,
      daysRecorded: days.length,
      classAttendanceRate: classRate,
      rows,
    };
  }

  async studentSummary(
    studentId: string,
    from: string | undefined,
    to: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<{
    studentId: string;
    counts: AttendanceCounts;
    byClass: Array<{
      classId: string;
      className: string;
      counts: AttendanceCounts;
    }>;
  }> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      include: { guardians: { select: { guardianUserId: true } } },
    });
    if (!student)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Student not found.',
      });
    const own =
      student.userId === actor.id ||
      student.guardians.some((g) => g.guardianUserId === actor.id);
    if (!own) {
      if (
        ROLE_LEVEL[actor.role] < ROLE_LEVEL.TEACHER &&
        actor.role !== 'ASSISTANT'
      )
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'You can only view your own attendance.',
        });
      assertOrganizationAccess(actor, student.organizationId);
    }
    const records = await this.prisma.attendance.findMany({
      where: { studentId, ...this.range(from, to) },
      include: { class: { select: { id: true, name: true } } },
    });
    let overall = emptyCounts();
    const byClass = new Map<
      string,
      { classId: string; className: string; counts: AttendanceCounts }
    >();
    for (const r of records) {
      const status = fromDb(r.status);
      overall = summarize([{ studentId, status }]).get(studentId)
        ? addTo(overall, status)
        : overall;
      const entry = byClass.get(r.classId) ?? {
        classId: r.classId,
        className: r.class.name,
        counts: emptyCounts(),
      };
      entry.counts = addTo(entry.counts, status);
      byClass.set(r.classId, entry);
    }
    return { studentId, counts: overall, byClass: [...byClass.values()] };
  }

  // ---------------------------------------------------------------------------

  private readonly include = {
    student: {
      select: {
        id: true,
        studentNumber: true,
        firstName: true,
        lastName: true,
      },
    },
    code: {
      select: {
        id: true,
        code: true,
        label: true,
        category: true,
        countsAsPresent: true,
      },
    },
    period: { select: { id: true, name: true } },
  } satisfies Prisma.AttendanceInclude;

  private visibility(actor: AuthenticatedUser): Prisma.AttendanceWhereInput {
    if (actor.role === 'STUDENT') return { student: { userId: actor.id } };
    if (actor.role === 'PARENT')
      return { student: { guardians: { some: { guardianUserId: actor.id } } } };
    return { class: organizationScope(actor) };
  }

  /** A code of the organisation (active), or the legacy status when no code is given. */
  private async resolveCode(
    organizationId: string,
    codeId: string | undefined,
    status: AttendanceStatusApi | undefined,
  ): Promise<{
    id: string | null;
    code: string | null;
    status: AttendanceStatusApi;
  }> {
    if (codeId) {
      const code = await this.prisma.attendanceCode.findFirst({
        where: { id: codeId, organizationId, isActive: true },
      });
      if (!code)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'Unknown attendance code for this school.',
        });
      return {
        id: code.id,
        code: code.code,
        status: fromDb(statusForCategory(code.category, code.countsAsPresent)),
      };
    }
    if (!status)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Give a codeId or a status.',
      });
    return { id: null, code: null, status };
  }

  private async assertPeriod(
    organizationId: string,
    periodId: string | undefined,
  ): Promise<void> {
    if (!periodId) return;
    const period = await this.prisma.period.findFirst({
      where: { id: periodId, bellSchedule: { organizationId } },
    });
    if (!period)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Unknown period for this school.',
      });
  }

  private async manageableClass(classId: string, actor: AuthenticatedUser) {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      include: { teachers: { select: { teacherId: true } } },
    });
    if (!klass)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    // Assistants mark attendance for any class in their school; teachers only for their own.
    const assistantHere =
      actor.role === 'ASSISTANT' &&
      actor.organizationId === klass.organizationId;
    if (!canManage(klass, actor) && !assistantHere)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only an assigned teacher, an assistant or an administrator can mark attendance for this class.',
      });
    return klass;
  }

  private async assertEnrolled(
    classId: string,
    studentIds: string[],
  ): Promise<void> {
    const count = await this.prisma.classEnrollment.count({
      where: {
        classId,
        studentId: { in: studentIds },
        status: { in: ['ENROLLED', 'COMPLETED'] },
      },
    });
    if (count !== studentIds.length)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'One or more students are not enrolled in this class.',
      });
  }

  private upsert(
    classId: string,
    studentId: string,
    date: Date,
    status: AttendanceStatusApi,
    notes: string | undefined,
    actor: AuthenticatedUser,
    codeId: string | null = null,
    periodId: string | null = null,
  ) {
    return this.prisma.attendance.upsert({
      where: { classId_studentId_date: { classId, studentId, date } },
      create: {
        id: newId(),
        classId,
        studentId,
        date,
        status: toDb(status),
        codeId,
        periodId,
        notes,
        markedById: actor.id,
      },
      update: {
        status: toDb(status),
        codeId,
        periodId,
        notes,
        markedById: actor.id,
      },
      include: this.include,
    });
  }

  private day(value: string): Date {
    const d = parseDate(value);
    if (!d)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Dates must be YYYY-MM-DD.',
      });
    return d;
  }

  private range(
    from: string | undefined,
    to: string | undefined,
  ): Prisma.AttendanceWhereInput {
    if (!from && !to) return {};
    return {
      date: {
        ...(from ? { gte: this.day(from) } : {}),
        ...(to ? { lte: this.day(to) } : {}),
      },
    };
  }

  private emit(
    klass: { id: string; organizationId: string },
    studentId: string,
    date: string,
    status: AttendanceStatusApi,
    actor: AuthenticatedUser,
  ): void {
    this.events.emit(
      'attendance.marked',
      domainEvent({
        eventType: 'attendance.marked',
        entityType: 'Attendance',
        entityId: `${klass.id}:${studentId}:${date}`,
        organizationId: klass.organizationId,
        actorId: actor.id,
        data: { classId: klass.id, studentId, date, status },
      }),
    );
  }
}

function addTo(
  counts: AttendanceCounts,
  status: AttendanceStatusApi,
): AttendanceCounts {
  return summarize([{ studentId: 'x', status }]).get('x')
    ? mergeCounts(counts, status)
    : counts;
}

function mergeCounts(
  counts: AttendanceCounts,
  status: AttendanceStatusApi,
): AttendanceCounts {
  const single =
    summarize([{ studentId: 'x', status }]).get('x') ?? emptyCounts();
  const next: AttendanceCounts = {
    present: counts.present + single.present,
    absent: counts.absent + single.absent,
    late: counts.late + single.late,
    excused: counts.excused + single.excused,
    tardy: counts.tardy + single.tardy,
    leftEarly: counts.leftEarly + single.leftEarly,
    total: counts.total + 1,
    attendanceRate: null,
  };
  const attended = next.present + next.late + next.tardy + next.leftEarly;
  next.attendanceRate = Math.round((attended / next.total) * 10000) / 100;
  return next;
}

function toDb(s: AttendanceStatusApi): AttendanceStatus {
  return s.toUpperCase() as AttendanceStatus;
}
function fromDb(s: AttendanceStatus): AttendanceStatusApi {
  return s.toLowerCase() as AttendanceStatusApi;
}
function toPublic(
  a: Attendance & {
    student?: {
      id: string;
      studentNumber: string;
      firstName: string;
      lastName: string;
    };
    code?: {
      id: string;
      code: string;
      label: string;
      category: string;
      countsAsPresent: boolean;
    } | null;
    period?: { id: string; name: string } | null;
  },
): PublicAttendance {
  return {
    id: a.id,
    classId: a.classId,
    studentId: a.studentId,
    student: a.student,
    date: dateOnly(a.date),
    status: fromDb(a.status),
    code: a.code
      ? { ...a.code, category: a.code.category.toLowerCase() }
      : null,
    period: a.period ?? null,
    notes: a.notes,
    markedById: a.markedById,
    updatedAt: a.updatedAt,
  };
}
