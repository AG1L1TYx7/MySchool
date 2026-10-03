import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { toCsv } from '../../common/utils/csv';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { assertOrganizationAccess } from '../access/scope';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NotificationsService } from '../notifications/notifications.service';
import {
  averageDailyAttendance,
  deadlinePassed,
  isChronicallyAbsent,
  localDate,
  meetsOn,
} from '../school/school-rules';

export interface ClassTakenStatus {
  classId: string;
  name: string;
  period: string | null;
  teachers: string[];
  taken: boolean;
  marked: number;
  enrolled: number;
}

/**
 * Period attendance for the office (docs/13 section 5): which classes have not taken attendance today,
 * the daily deadline alert, and the exports state agencies ask for (average daily attendance, chronic absenteeism).
 */
@Injectable()
export class AttendanceReportsService {
  private readonly logger = new Logger(AttendanceReportsService.name);
  private readonly alerted = new Map<string, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Which classes meet on this date and whether attendance was recorded for them. */
  async takenStatus(
    organizationId: string,
    date: string,
    actor: AuthenticatedUser | null,
  ): Promise<{
    date: string;
    deadline: string | null;
    taken: ClassTakenStatus[];
    missing: ClassTakenStatus[];
  }> {
    if (actor) assertOrganizationAccess(actor, organizationId);
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { attendanceDeadlineTime: true },
    });
    if (!org)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Organisation not found.',
      });
    const day = new Date(`${date}T00:00:00Z`);
    const classes = await this.prisma.class.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        OR: [{ startDate: null }, { startDate: { lte: day } }],
        AND: [{ OR: [{ endDate: null }, { endDate: { gte: day } }] }],
      },
      select: {
        id: true,
        name: true,
        period: { select: { name: true, days: true } },
        teachers: {
          select: { teacher: { select: { firstName: true, lastName: true } } },
        },
        _count: { select: { enrollments: { where: { status: 'ENROLLED' } } } },
      },
      orderBy: { name: 'asc' },
    });
    const meeting = classes.filter(
      (c) => !c.period || meetsOn(c.period.days, day),
    );
    const counts = await this.prisma.attendance.groupBy({
      by: ['classId'],
      where: { date: day, classId: { in: meeting.map((c) => c.id) } },
      _count: { _all: true },
    });
    const marked = new Map(counts.map((c) => [c.classId, c._count._all]));
    const rows: ClassTakenStatus[] = meeting.map((c) => ({
      classId: c.id,
      name: c.name,
      period: c.period?.name ?? null,
      teachers: c.teachers.map(
        (t) => `${t.teacher.firstName} ${t.teacher.lastName}`,
      ),
      taken: (marked.get(c.id) ?? 0) > 0,
      marked: marked.get(c.id) ?? 0,
      enrolled: c._count.enrollments,
    }));
    return {
      date,
      deadline: org.attendanceDeadlineTime,
      taken: rows.filter((r) => r.taken),
      missing: rows.filter((r) => !r.taken && r.enrolled > 0),
    };
  }

  /** Every 15 minutes: once the school's deadline has passed, tell administrators and the teachers of untaken classes. */
  @Cron('*/15 * * * *')
  async deadlineAlerts(): Promise<void> {
    const orgs = await this.prisma.organization.findMany({
      where: {
        deletedAt: null,
        isActive: true,
        attendanceDeadlineTime: { not: null },
      },
      select: {
        id: true,
        name: true,
        timezone: true,
        attendanceDeadlineTime: true,
      },
    });
    const now = new Date();
    for (const org of orgs) {
      const today = localDate(now, org.timezone);
      if (
        this.alerted.get(org.id) === today ||
        !deadlinePassed(org.attendanceDeadlineTime, now, org.timezone)
      )
        continue;
      if (now.getUTCDay() === 0 || now.getUTCDay() === 6) continue;
      this.alerted.set(org.id, today);
      try {
        const status = await this.takenStatus(org.id, today, null);
        if (status.missing.length === 0) continue;
        const admins = await this.prisma.user.findMany({
          where: {
            organizationId: org.id,
            role: 'PRINCIPAL',
            status: 'ACTIVE',
            deletedAt: null,
          },
          select: { id: true },
        });
        const teachers = await this.prisma.classTeacher.findMany({
          where: { classId: { in: status.missing.map((m) => m.classId) } },
          select: { teacherId: true },
        });
        await this.notifications.notify(
          [...admins.map((a) => a.id), ...teachers.map((t) => t.teacherId)],
          {
            category: 'ATTENDANCE',
            title: `Attendance not taken for ${status.missing.length} class${status.missing.length === 1 ? '' : 'es'}`,
            body:
              status.missing
                .slice(0, 6)
                .map(
                  (m) => `${m.name}${m.period ? ` (period ${m.period})` : ''}`,
                )
                .join(', ') + (status.missing.length > 6 ? ', …' : ''),
            link: '/attendance/today',
            entityType: 'Organization',
            entityId: org.id,
          },
        );
      } catch (err) {
        this.logger.warn(
          `Attendance deadline check failed for ${org.name}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  /**
   * Per-student day counts between two dates. A day counts as present when any period that day was
   * recorded with a code that counts as present (or the legacy present or tardy statuses).
   */
  async dailyCounts(organizationId: string, from: string, to: string) {
    const rows = await this.prisma.attendance.findMany({
      where: {
        class: { organizationId },
        date: {
          gte: new Date(`${from}T00:00:00Z`),
          lte: new Date(`${to}T00:00:00Z`),
        },
      },
      select: {
        studentId: true,
        date: true,
        status: true,
        code: { select: { countsAsPresent: true } },
      },
    });
    const byStudent = new Map<string, Map<string, boolean>>();
    for (const r of rows) {
      const present = r.code
        ? r.code.countsAsPresent
        : r.status === 'PRESENT' ||
          r.status === 'TARDY' ||
          r.status === 'LATE' ||
          r.status === 'LEFT_EARLY';
      const key = r.date.toISOString().slice(0, 10);
      const days = byStudent.get(r.studentId) ?? new Map<string, boolean>();
      days.set(key, (days.get(key) ?? false) || present);
      byStudent.set(r.studentId, days);
    }
    const students = await this.prisma.student.findMany({
      where: { id: { in: [...byStudent.keys()] } },
      select: {
        id: true,
        studentNumber: true,
        firstName: true,
        lastName: true,
        gradeLevel: true,
      },
    });
    return students
      .map((s) => {
        const days = byStudent.get(s.id) ?? new Map<string, boolean>();
        const enrolled = days.size;
        const present = [...days.values()].filter(Boolean).length;
        return {
          ...s,
          daysEnrolled: enrolled,
          daysPresent: present,
          daysAbsent: enrolled - present,
          rate: enrolled ? Math.round((present / enrolled) * 10000) / 100 : 0,
          chronic: isChronicallyAbsent(enrolled, enrolled - present),
        };
      })
      .sort(
        (a, b) =>
          a.lastName.localeCompare(b.lastName) ||
          a.firstName.localeCompare(b.firstName),
      );
  }

  async exportCsv(
    organizationId: string,
    from: string,
    to: string,
    type: 'ada' | 'chronic',
    actor: AuthenticatedUser,
  ): Promise<string> {
    assertOrganizationAccess(actor, organizationId);
    const rows = await this.dailyCounts(organizationId, from, to);
    const selected = type === 'chronic' ? rows.filter((r) => r.chronic) : rows;
    const header = [
      'studentNumber',
      'lastName',
      'firstName',
      'gradeLevel',
      'daysEnrolled',
      'daysPresent',
      'daysAbsent',
      'attendanceRate',
      'chronicallyAbsent',
    ];
    const data = selected.map((r) => [
      r.studentNumber,
      r.lastName,
      r.firstName,
      r.gradeLevel ?? '',
      String(r.daysEnrolled),
      String(r.daysPresent),
      String(r.daysAbsent),
      String(r.rate),
      r.chronic ? 'yes' : 'no',
    ]);
    if (type === 'ada')
      data.push([
        '',
        'SCHOOL',
        'average daily attendance',
        '',
        '',
        '',
        '',
        String(
          averageDailyAttendance(
            rows.map((r) => ({
              present: r.daysPresent,
              enrolled: r.daysEnrolled,
            })),
          ),
        ),
        '',
      ]);
    return toCsv([header, ...data]);
  }
}
