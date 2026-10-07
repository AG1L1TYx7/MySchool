import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import PDFDocument from 'pdfkit';
import { newId } from '../../common/utils/ids';
import { MailService } from '../../infra/mail/mail.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import { assertOrganizationAccess, isDistrictRole } from '../access/scope';
import { AttendanceReportsService } from '../attendance/attendance-reports.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canManage } from '../classes/classes.service';
import { CreateScheduleDto, UpdateScheduleDto } from './dto/insight.dto';
import {
  aiUsageSummary,
  attendanceRate,
  completeness,
  gradeBuckets,
  isFailing,
  missingByGradeLevel,
  nextRunAt,
  reportFileName,
  riskFlags,
  toCsv,
  transcriptSummary,
  weeklyCounts,
  type Frequency,
  type ReportKind,
  type TranscriptLine,
} from './insight-rules';

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export interface PublicSchedule {
  id: string;
  organizationId: string;
  name: string;
  kind: string;
  frequency: string;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  hour: number;
  classId: string | null;
  className: string | null;
  recipients: string[];
  active: boolean;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  lastRunAt: Date | null;
  nextRunAt: Date;
  createdAt: Date;
}

interface MissingRow {
  studentId: string;
  studentName: string;
  gradeLevel: string | null;
  classId: string;
  className: string;
  assignmentId: string;
  title: string;
  dueAt: Date;
}

/**
 * Insight (docs/07 row 17, docs/13 section 9): the principal dashboard, class and student analytics,
 * CSV reports on a schedule by email, and PDF transcripts. Everything is computed from the records the
 * school already keeps; nothing here ranks students against each other.
 */
@Injectable()
export class InsightService {
  private readonly logger = new Logger(InsightService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly attendanceReports: AttendanceReportsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // School overview (principal dashboard)
  // ---------------------------------------------------------------------------

  async overview(
    organizationId: string,
    actor: AuthenticatedUser,
    date?: string,
  ) {
    this.adminOf(organizationId, actor);
    return this.computeOverview(
      organizationId,
      date ? date.slice(0, 10) : isoDay(new Date()),
    );
  }

  private async computeOverview(organizationId: string, date: string) {
    const now = new Date();
    const day = new Date(`${date}T00:00:00Z`);
    const weekStart = new Date(now.getTime() - 7 * DAY);
    const [
      taken,
      todayRows,
      missing,
      failing,
      completenessRows,
      ai,
      engagement,
    ] = await Promise.all([
      this.attendanceReports.takenStatus(organizationId, date, null),
      this.prisma.attendance.findMany({
        where: { date: day, class: { organizationId, deletedAt: null } },
        select: { status: true },
      }),
      this.missingRows(organizationId),
      this.failingRows(organizationId),
      this.completenessRows(organizationId, now),
      this.aiUsage(organizationId, weekStart),
      this.engagement(organizationId, weekStart),
    ]);
    const byClass = new Map<
      string,
      {
        classId: string;
        className: string;
        count: number;
        students: Array<{ id: string; name: string; grade: number }>;
      }
    >();
    for (const f of failing) {
      const g = byClass.get(f.classId) ?? {
        classId: f.classId,
        className: f.className,
        count: 0,
        students: [],
      };
      g.count += 1;
      g.students.push({ id: f.studentId, name: f.studentName, grade: f.grade });
      byClass.set(f.classId, g);
    }
    return {
      date,
      attendance: {
        deadline: taken.deadline,
        classesMeeting: taken.taken.length + taken.missing.length,
        classesTaken: taken.taken.length,
        classesMissing: taken.missing.map((m) => ({
          classId: m.classId,
          name: m.name,
          period: m.period,
          teachers: m.teachers,
        })),
        rateToday: attendanceRate(todayRows.map((r) => r.status)),
        marked: todayRows.length,
      },
      missingWork: {
        windowDays: 14,
        items: missing.length,
        students: new Set(missing.map((m) => m.studentId)).size,
        byGradeLevel: missingByGradeLevel(missing),
      },
      failing: {
        threshold: 60,
        students: new Set(failing.map((f) => f.studentId)).size,
        byClass: [...byClass.values()]
          .sort(
            (a, b) =>
              b.count - a.count || a.className.localeCompare(b.className),
          )
          .map((c) => ({
            ...c,
            students: c.students.sort((a, b) => a.name.localeCompare(b.name)),
          })),
      },
      gradebook: {
        classes: completenessRows,
        average: completenessRows.length
          ? Math.round(
              (completenessRows.reduce((s, c) => s + (c.completeness ?? 0), 0) /
                completenessRows.length) *
                10,
            ) / 10
          : null,
      },
      ai,
      engagement,
    };
  }

  /** Published or closed work past due in the last 14 days with no submission, grade or mark for an enrolled student. */
  private async missingRows(
    organizationId: string,
    classId?: string,
  ): Promise<MissingRow[]> {
    const now = new Date();
    const assignments = await this.prisma.assignment.findMany({
      where: {
        deletedAt: null,
        status: { in: ['PUBLISHED', 'CLOSED'] },
        dueAt: { gte: new Date(now.getTime() - 14 * DAY), lt: now },
        class: {
          organizationId,
          deletedAt: null,
          ...(classId ? { id: classId } : {}),
        },
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        classId: true,
        class: {
          select: {
            name: true,
            enrollments: {
              where: { status: 'ENROLLED' },
              select: {
                studentId: true,
                student: {
                  select: { firstName: true, lastName: true, gradeLevel: true },
                },
              },
            },
          },
        },
        submissions: { select: { studentId: true } },
        grades: { select: { studentId: true } },
        marks: { select: { studentId: true } },
      },
      take: 1000,
    });
    const out: MissingRow[] = [];
    for (const a of assignments) {
      const done = new Set(
        [...a.submissions, ...a.grades, ...a.marks].map((x) => x.studentId),
      );
      for (const e of a.class.enrollments)
        if (!done.has(e.studentId) && a.dueAt)
          out.push({
            studentId: e.studentId,
            studentName: `${e.student.firstName} ${e.student.lastName}`,
            gradeLevel: e.student.gradeLevel,
            classId: a.classId,
            className: a.class.name,
            assignmentId: a.id,
            title: a.title,
            dueAt: a.dueAt,
          });
    }
    return out;
  }

  private async failingRows(organizationId: string) {
    const rows = await this.prisma.classEnrollment.findMany({
      where: {
        status: 'ENROLLED',
        currentGrade: { lt: 60 },
        class: {
          organizationId,
          deletedAt: null,
          status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
        },
      },
      select: {
        studentId: true,
        classId: true,
        currentGrade: true,
        student: {
          select: { firstName: true, lastName: true, gradeLevel: true },
        },
        class: { select: { name: true } },
      },
      orderBy: { currentGrade: 'asc' },
      take: 2000,
    });
    return rows
      .filter((r) =>
        isFailing(r.currentGrade === null ? null : Number(r.currentGrade)),
      )
      .map((r) => ({
        studentId: r.studentId,
        studentName: `${r.student.firstName} ${r.student.lastName}`,
        gradeLevel: r.student.gradeLevel,
        classId: r.classId,
        className: r.class.name,
        grade: Number(r.currentGrade),
      }));
  }

  /** Per class: graded cells over enrolled students times assignments due in the last 30 days. */
  private async completenessRows(organizationId: string, now: Date) {
    const classes = await this.prisma.class.findMany({
      where: {
        organizationId,
        deletedAt: null,
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      },
      select: {
        id: true,
        name: true,
        teachers: {
          select: { teacher: { select: { firstName: true, lastName: true } } },
        },
        _count: { select: { enrollments: { where: { status: 'ENROLLED' } } } },
        assignments: {
          where: {
            deletedAt: null,
            status: { in: ['PUBLISHED', 'CLOSED'] },
            dueAt: { gte: new Date(now.getTime() - 30 * DAY), lt: now },
          },
          select: {
            id: true,
            _count: { select: { grades: true, submissions: true } },
          },
        },
      },
      orderBy: { name: 'asc' },
    });
    return classes.map((c) => {
      const expected = c._count.enrollments * c.assignments.length;
      const graded = c.assignments.reduce((s, a) => s + a._count.grades, 0);
      const submitted = c.assignments.reduce(
        (s, a) => s + a._count.submissions,
        0,
      );
      return {
        classId: c.id,
        className: c.name,
        teachers: c.teachers.map(
          (t) => `${t.teacher.firstName} ${t.teacher.lastName}`,
        ),
        assignmentsDue: c.assignments.length,
        enrolled: c._count.enrollments,
        graded,
        ungradedSubmissions: Math.max(0, submitted - graded),
        completeness: completeness(graded, expected),
      };
    });
  }

  private async aiUsage(organizationId: string, since: Date) {
    const [conversations, refusedByConversation, lastWeekCount] =
      await Promise.all([
        this.prisma.aiConversation.findMany({
          where: { organizationId, createdAt: { gte: since }, deletedAt: null },
          select: {
            id: true,
            messageCount: true,
            capability: true,
            user: { select: { role: true } },
          },
        }),
        this.prisma.aiMessage.groupBy({
          by: ['conversationId'],
          where: {
            status: 'REFUSED',
            createdAt: { gte: since },
            conversation: { organizationId },
          },
          _count: { _all: true },
        }),
        this.prisma.aiConversation.count({
          where: {
            organizationId,
            createdAt: { gte: new Date(since.getTime() - 7 * DAY), lt: since },
            deletedAt: null,
          },
        }),
      ]);
    const refused = new Map(
      refusedByConversation.map((r) => [r.conversationId, r._count._all]),
    );
    const summary = aiUsageSummary(
      conversations.map((c) => ({
        role: c.user.role,
        messageCount: c.messageCount,
        refused: refused.get(c.id) ?? 0,
      })),
    );
    const byCapability = new Map<string, number>();
    for (const c of conversations)
      byCapability.set(c.capability, (byCapability.get(c.capability) ?? 0) + 1);
    return {
      windowDays: 7,
      ...summary,
      conversationsLastWeek: lastWeekCount,
      byCapability: [...byCapability.entries()]
        .map(([capability, conversations]) => ({ capability, conversations }))
        .sort((a, b) => b.conversations - a.conversations),
    };
  }

  private async engagement(organizationId: string, since: Date) {
    const [logins, submissions, completions, practice, usersByRole] =
      await Promise.all([
        this.prisma.user.groupBy({
          by: ['role'],
          where: {
            organizationId,
            deletedAt: null,
            lastLoginAt: { gte: since },
          },
          _count: { _all: true },
        }),
        this.prisma.assignmentSubmission.count({
          where: {
            submittedAt: { gte: since },
            assignment: { class: { organizationId } },
          },
        }),
        this.prisma.lessonCompletion.count({
          where: { completedAt: { gte: since }, student: { organizationId } },
        }),
        this.prisma.srsReview.count({
          where: { reviewedAt: { gte: since }, student: { organizationId } },
        }),
        this.prisma.user.groupBy({
          by: ['role'],
          where: { organizationId, deletedAt: null },
          _count: { _all: true },
        }),
      ]);
    const total = new Map(usersByRole.map((u) => [u.role, u._count._all]));
    return {
      windowDays: 7,
      loginsByRole: logins
        .map((l) => ({
          role: l.role,
          active: l._count._all,
          total: total.get(l.role) ?? 0,
        }))
        .sort((a, b) => b.active - a.active),
      submissions,
      lessonCompletions: completions,
      practiceReviews: practice,
    };
  }

  // ---------------------------------------------------------------------------
  // Class and student analytics
  // ---------------------------------------------------------------------------

  async classInsight(classId: string, actor: AuthenticatedUser) {
    const klass = await this.manageableClass(classId, actor);
    const now = new Date();
    const since30 = new Date(now.getTime() - 30 * DAY);
    const [members, attendance, assignments, missing] = await Promise.all([
      this.prisma.classEnrollment.findMany({
        where: { classId, status: 'ENROLLED' },
        select: {
          studentId: true,
          currentGrade: true,
          student: {
            select: { firstName: true, lastName: true, gradeLevel: true },
          },
        },
      }),
      this.prisma.attendance.findMany({
        where: { classId, date: { gte: since30 } },
        select: { studentId: true, status: true },
      }),
      this.prisma.assignment.findMany({
        where: {
          classId,
          deletedAt: null,
          status: { in: ['PUBLISHED', 'CLOSED'] },
          dueAt: { lt: now },
        },
        orderBy: { dueAt: 'desc' },
        take: 12,
        select: {
          id: true,
          title: true,
          dueAt: true,
          maxPoints: true,
          grades: { select: { percentage: true } },
          _count: { select: { submissions: true } },
        },
      }),
      this.missingRows(klass.organizationId, classId),
    ]);
    const missingBy = new Map<string, number>();
    for (const m of missing)
      missingBy.set(m.studentId, (missingBy.get(m.studentId) ?? 0) + 1);
    const attendanceBy = new Map<string, string[]>();
    for (const a of attendance)
      attendanceBy.set(a.studentId, [
        ...(attendanceBy.get(a.studentId) ?? []),
        a.status,
      ]);
    const students = members
      .map((m) => {
        const grade = m.currentGrade === null ? null : Number(m.currentGrade);
        const rate = attendanceRate(attendanceBy.get(m.studentId) ?? []);
        const miss = missingBy.get(m.studentId) ?? 0;
        return {
          studentId: m.studentId,
          name: `${m.student.firstName} ${m.student.lastName}`,
          gradeLevel: m.student.gradeLevel,
          grade,
          attendanceRate: rate,
          missing: miss,
          flags: riskFlags({ grade, missing: miss, attendanceRate: rate }),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const graded = students
      .map((s) => s.grade)
      .filter((g): g is number => g !== null);
    return {
      class: { id: klass.id, name: klass.name },
      students: members.length,
      distribution: gradeBuckets(graded),
      average: graded.length
        ? Math.round((graded.reduce((s, g) => s + g, 0) / graded.length) * 10) /
          10
        : null,
      attendanceRate30Days: attendanceRate(attendance.map((a) => a.status)),
      missingItems: missing.length,
      atRisk: students.filter((s) => s.flags.length > 0),
      roster: students,
      assignments: assignments
        .map((a) => ({
          id: a.id,
          title: a.title,
          dueAt: a.dueAt,
          submitted: a._count.submissions,
          graded: a.grades.length,
          average: a.grades.length
            ? Math.round(
                (a.grades.reduce((s, g) => s + Number(g.percentage), 0) /
                  a.grades.length) *
                  10,
              ) / 10
            : null,
        }))
        .reverse(),
    };
  }

  async studentInsight(studentId: string, actor: AuthenticatedUser) {
    const student = await this.visibleStudent(studentId, actor);
    const now = new Date();
    const since8w = new Date(now.getTime() - 56 * DAY);
    const since30 = new Date(now.getTime() - 30 * DAY);
    const [
      enrollments,
      attendance,
      submissions,
      completions,
      aiConversations,
      reviews,
      mastery,
      missing,
    ] = await Promise.all([
      this.prisma.classEnrollment.findMany({
        where: {
          studentId,
          status: { in: ['ENROLLED', 'COMPLETED'] },
          class: { deletedAt: null },
        },
        select: {
          classId: true,
          currentGrade: true,
          status: true,
          class: {
            select: {
              name: true,
              course: { select: { title: true } },
              teachers: {
                where: { isPrimary: true },
                select: {
                  teacher: { select: { firstName: true, lastName: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.attendance.findMany({
        where: { studentId, date: { gte: new Date(now.getTime() - 90 * DAY) } },
        select: { status: true, date: true },
      }),
      this.prisma.assignmentSubmission.findMany({
        where: { studentId, submittedAt: { gte: since8w } },
        select: { submittedAt: true, isLate: true },
      }),
      this.prisma.lessonCompletion.findMany({
        where: { studentId, completedAt: { gte: since8w } },
        select: { completedAt: true },
      }),
      student.userId
        ? this.prisma.aiConversation.count({
            where: {
              userId: student.userId,
              createdAt: { gte: since30 },
              deletedAt: null,
            },
          })
        : Promise.resolve(0),
      this.prisma.srsReview.count({
        where: { studentId, reviewedAt: { gte: since30 } },
      }),
      this.prisma.masteryLevel.findMany({
        where: { studentId },
        select: { level: true },
      }),
      this.missingRows(student.organizationId).then((rows) =>
        rows.filter((r) => r.studentId === studentId),
      ),
    ]);
    const classes = enrollments.map((e) => ({
      classId: e.classId,
      name: e.class.name,
      courseTitle: e.class.course.title,
      teacher: e.class.teachers[0]
        ? `${e.class.teachers[0].teacher.firstName} ${e.class.teachers[0].teacher.lastName}`
        : null,
      status: e.status,
      grade: e.currentGrade === null ? null : Number(e.currentGrade),
      failing: isFailing(
        e.currentGrade === null ? null : Number(e.currentGrade),
      ),
    }));
    const rate = attendanceRate(attendance.map((a) => a.status));
    const levels = mastery.map((m) => Number(m.level));
    return {
      student: {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        gradeLevel: student.gradeLevel,
        studentNumber: student.studentNumber,
      },
      classes,
      attendance: {
        days: attendance.length,
        rate,
        absences: attendance.filter((a) => a.status === 'ABSENT').length,
        tardies: attendance.filter(
          (a) => a.status === 'LATE' || a.status === 'TARDY',
        ).length,
        windowDays: 90,
      },
      missing: missing.map((m) => ({
        assignmentId: m.assignmentId,
        title: m.title,
        className: m.className,
        dueAt: m.dueAt,
      })),
      weekly: {
        submissions: weeklyCounts(
          submissions.map((s) => s.submittedAt),
          8,
          now,
        ),
        lessonCompletions: weeklyCounts(
          completions.map((c) => c.completedAt),
          8,
          now,
        ),
      },
      lateSubmissions: submissions.filter((s) => s.isLate).length,
      ai: { conversations30Days: aiConversations },
      practice: {
        reviews30Days: reviews,
        masteryAverage: levels.length
          ? Math.round(
              (levels.reduce((s, x) => s + x, 0) / levels.length) * 1000,
            ) / 1000
          : null,
        standardsMeasured: levels.length,
      },
      flags: riskFlags({
        grade: classes.some((c) => c.failing) ? 0 : null,
        missing: missing.length,
        attendanceRate: rate,
      }),
    };
  }

  // ---------------------------------------------------------------------------
  // Transcript
  // ---------------------------------------------------------------------------

  async transcriptPdf(
    studentId: string,
    actor: AuthenticatedUser,
  ): Promise<Buffer> {
    const student = await this.visibleStudent(studentId, actor);
    const [org, cards] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: student.organizationId },
        select: { name: true, address: true, phone: true },
      }),
      this.prisma.reportCard.findMany({
        where: { studentId, status: 'PUBLISHED', kind: 'REPORT_CARD' },
        select: {
          attendance: true,
          gradingPeriod: {
            select: {
              name: true,
              startDate: true,
              term: {
                select: {
                  name: true,
                  academicYear: { select: { name: true } },
                },
              },
            },
          },
          lines: {
            select: {
              courseTitle: true,
              className: true,
              teacherName: true,
              percentage: true,
              letter: true,
              gpaPoints: true,
            },
          },
        },
      }),
    ]);
    const lines: TranscriptLine[] = cards.flatMap((c) =>
      c.lines.map((l) => ({
        yearName: c.gradingPeriod.term.academicYear.name,
        termName: c.gradingPeriod.term.name,
        periodName: c.gradingPeriod.name,
        periodStart: isoDay(c.gradingPeriod.startDate),
        courseTitle: l.courseTitle,
        className: l.className,
        teacherName: l.teacherName,
        percentage: l.percentage === null ? null : Number(l.percentage),
        letter: l.letter,
        gpaPoints: l.gpaPoints === null ? null : Number(l.gpaPoints),
      })),
    );
    const summary = transcriptSummary(lines);
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'insight.transcript.pdf',
      entityType: 'Student',
      entityId: student.id,
      details: { courses: summary.courses },
    });
    return renderTranscript({ student, org, summary, generatedAt: new Date() });
  }

  // ---------------------------------------------------------------------------
  // CSV reports and schedules
  // ---------------------------------------------------------------------------

  async reportCsv(
    organizationId: string,
    kind: ReportKind,
    actor: AuthenticatedUser,
    classId?: string,
  ): Promise<{ fileName: string; csv: string; rows: number }> {
    if (kind === 'class_summary') {
      if (!classId)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'class_summary needs a classId.',
        });
      await this.manageableClass(classId, actor);
    } else this.adminOf(organizationId, actor);
    return this.buildReport(organizationId, kind, classId ?? null);
  }

  private async buildReport(
    organizationId: string,
    kind: ReportKind,
    classId: string | null,
  ): Promise<{ fileName: string; csv: string; rows: number }> {
    const now = new Date();
    const today = isoDay(now);
    const done = (
      name: string | null,
      headers: string[],
      rows: Array<Array<string | number | null>>,
    ) => ({
      fileName: reportFileName(kind, now, name),
      csv: toCsv(headers, rows),
      rows: rows.length,
    });
    switch (kind) {
      case 'attendance_today': {
        const t = await this.attendanceReports.takenStatus(
          organizationId,
          today,
          null,
        );
        return done(
          null,
          ['Class', 'Period', 'Teachers', 'Taken', 'Marked', 'Enrolled'],
          [...t.taken, ...t.missing].map((c) => [
            c.name,
            c.period,
            c.teachers.join('; '),
            c.taken ? 'yes' : 'no',
            c.marked,
            c.enrolled,
          ]),
        );
      }
      case 'missing_work': {
        const rows = await this.missingRows(organizationId);
        return done(
          null,
          ['Student', 'Grade level', 'Class', 'Assignment', 'Due'],
          rows
            .sort((a, b) => a.studentName.localeCompare(b.studentName))
            .map((r) => [
              r.studentName,
              r.gradeLevel,
              r.className,
              r.title,
              r.dueAt.toISOString(),
            ]),
        );
      }
      case 'failing_students': {
        const rows = await this.failingRows(organizationId);
        return done(
          null,
          ['Student', 'Grade level', 'Class', 'Current grade'],
          rows.map((r) => [r.studentName, r.gradeLevel, r.className, r.grade]),
        );
      }
      case 'gradebook_completeness': {
        const rows = await this.completenessRows(organizationId, now);
        return done(
          null,
          [
            'Class',
            'Teachers',
            'Assignments due (30 days)',
            'Enrolled',
            'Graded cells',
            'Ungraded submissions',
            'Completeness %',
          ],
          rows.map((r) => [
            r.className,
            r.teachers.join('; '),
            r.assignmentsDue,
            r.enrolled,
            r.graded,
            r.ungradedSubmissions,
            r.completeness,
          ]),
        );
      }
      case 'ai_usage': {
        const ai = await this.aiUsage(
          organizationId,
          new Date(now.getTime() - 7 * DAY),
        );
        return done(
          null,
          ['Measure', 'Value'],
          [
            ['Conversations (7 days)', ai.conversations],
            ['Conversations (previous 7 days)', ai.conversationsLastWeek],
            ['Messages', ai.messages],
            ['Refusals', ai.refusals],
            ['Refusal rate %', ai.refusalRate],
            ...ai.byRole.map(
              (r) =>
                [`Conversations: ${r.role}`, r.conversations] as [
                  string,
                  number,
                ],
            ),
            ...ai.byCapability.map(
              (c) =>
                [`Capability: ${c.capability}`, c.conversations] as [
                  string,
                  number,
                ],
            ),
          ],
        );
      }
      case 'class_summary': {
        const klass = await this.prisma.class.findFirstOrThrow({
          where: { id: classId ?? '', organizationId },
          select: { id: true, name: true },
        });
        const actor = {
          id: 'system',
          role: 'SUPER_ADMIN',
          organizationId: null,
        } as unknown as AuthenticatedUser;
        const insight = await this.classInsight(klass.id, actor);
        return done(
          klass.name,
          [
            'Student',
            'Grade level',
            'Current grade',
            'Attendance % (30 days)',
            'Missing items',
            'Flags',
          ],
          insight.roster.map((s) => [
            s.name,
            s.gradeLevel,
            s.grade,
            s.attendanceRate,
            s.missing,
            s.flags.join(' '),
          ]),
        );
      }
      case 'school_overview':
      default: {
        const o = await this.computeOverview(organizationId, today);
        return done(
          null,
          ['Measure', 'Value'],
          [
            ['Date', o.date],
            ['Classes meeting today', o.attendance.classesMeeting],
            ['Classes with attendance taken', o.attendance.classesTaken],
            ['Attendance rate today %', o.attendance.rateToday],
            ['Missing work items (14 days)', o.missingWork.items],
            ['Students with missing work', o.missingWork.students],
            ...o.missingWork.byGradeLevel.map(
              (g) =>
                [`Missing items: grade ${g.gradeLevel}`, g.items] as [
                  string,
                  number,
                ],
            ),
            ['Students failing a class', o.failing.students],
            ...o.failing.byClass.map(
              (c) => [`Failing: ${c.className}`, c.count] as [string, number],
            ),
            ['Gradebook completeness % (average)', o.gradebook.average],
            ['AI conversations (7 days)', o.ai.conversations],
            ['AI refusal rate %', o.ai.refusalRate],
            ['Submissions (7 days)', o.engagement.submissions],
            ['Lessons finished (7 days)', o.engagement.lessonCompletions],
            ['Practice reviews (7 days)', o.engagement.practiceReviews],
          ],
        );
      }
    }
  }

  async schedules(
    organizationId: string,
    actor: AuthenticatedUser,
  ): Promise<PublicSchedule[]> {
    this.adminOf(organizationId, actor);
    const rows = await this.prisma.reportSchedule.findMany({
      where: { organizationId },
      include: this.scheduleInclude,
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toSchedule(r));
  }

  async createSchedule(
    organizationId: string,
    dto: CreateScheduleDto,
    actor: AuthenticatedUser,
  ): Promise<PublicSchedule> {
    this.adminOf(organizationId, actor);
    if (dto.kind === 'class_summary') {
      if (!dto.classId)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'class_summary needs a classId.',
        });
      const klass = await this.prisma.class.findFirst({
        where: { id: dto.classId, organizationId, deletedAt: null },
        select: { id: true },
      });
      if (!klass)
        throw new NotFoundException({
          code: 'resource.not_found',
          detail: 'Class not found.',
        });
    }
    await this.assertStaffRecipients(organizationId, dto.recipients);
    const row = await this.prisma.reportSchedule.create({
      data: {
        id: newId(),
        organizationId,
        name: dto.name.trim(),
        kind: dto.kind,
        frequency: dto.frequency,
        dayOfWeek: dto.frequency === 'weekly' ? (dto.dayOfWeek ?? 1) : null,
        dayOfMonth: dto.frequency === 'monthly' ? (dto.dayOfMonth ?? 1) : null,
        hour: dto.hour ?? 7,
        classId: dto.kind === 'class_summary' ? (dto.classId ?? null) : null,
        recipients: JSON.stringify(dto.recipients.map((r) => r.toLowerCase())),
        createdById: actor.id,
        nextRunAt: nextRunAt(
          {
            frequency: dto.frequency,
            dayOfWeek: dto.dayOfWeek,
            dayOfMonth: dto.dayOfMonth,
            hour: dto.hour ?? 7,
          },
          new Date(),
        ),
      },
      include: this.scheduleInclude,
    });
    return this.toSchedule(row);
  }

  async updateSchedule(
    id: string,
    dto: UpdateScheduleDto,
    actor: AuthenticatedUser,
  ): Promise<PublicSchedule> {
    const row = await this.scheduleFor(id, actor);
    if (dto.recipients)
      await this.assertStaffRecipients(row.organizationId, dto.recipients);
    const frequency = (dto.frequency ?? row.frequency) as Frequency;
    const dayOfWeek = dto.dayOfWeek ?? row.dayOfWeek;
    const dayOfMonth = dto.dayOfMonth ?? row.dayOfMonth;
    const hour = dto.hour ?? row.hour;
    const updated = await this.prisma.reportSchedule.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        frequency,
        dayOfWeek: frequency === 'weekly' ? (dayOfWeek ?? 1) : null,
        dayOfMonth: frequency === 'monthly' ? (dayOfMonth ?? 1) : null,
        hour,
        recipients: dto.recipients
          ? JSON.stringify(dto.recipients.map((r) => r.toLowerCase()))
          : undefined,
        active: dto.active,
        nextRunAt: nextRunAt(
          { frequency, dayOfWeek, dayOfMonth, hour },
          new Date(),
        ),
      },
      include: this.scheduleInclude,
    });
    return this.toSchedule(updated);
  }

  async removeSchedule(id: string, actor: AuthenticatedUser): Promise<void> {
    await this.scheduleFor(id, actor);
    await this.prisma.reportSchedule.delete({ where: { id } });
  }

  async runs(id: string, actor: AuthenticatedUser) {
    await this.scheduleFor(id, actor);
    const rows = await this.prisma.reportRun.findMany({
      where: { scheduleId: id },
      orderBy: { startedAt: 'desc' },
      take: 50,
    });
    return rows.map((r) => ({
      ...r,
      recipients: JSON.parse(r.recipients) as string[],
    }));
  }

  /** Builds and emails the report now, outside its schedule; the schedule's next run is unchanged. */
  async runNow(id: string, actor: AuthenticatedUser) {
    const row = await this.scheduleFor(id, actor);
    return this.execute(row);
  }

  /** Every hour, at ten past: send every active schedule whose time has come. */
  @Cron('10 * * * *')
  async runDue(): Promise<number> {
    const due = await this.prisma.reportSchedule.findMany({
      where: { active: true, nextRunAt: { lte: new Date() } },
      include: this.scheduleInclude,
      take: 100,
    });
    let n = 0;
    for (const s of due) {
      try {
        await this.execute(s);
        n += 1;
      } catch (err) {
        this.logger.warn(
          `Scheduled report ${s.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      await this.prisma.reportSchedule.update({
        where: { id: s.id },
        data: {
          lastRunAt: new Date(),
          nextRunAt: nextRunAt(
            {
              frequency: s.frequency as Frequency,
              dayOfWeek: s.dayOfWeek,
              dayOfMonth: s.dayOfMonth,
              hour: s.hour,
            },
            new Date(),
          ),
        },
      });
    }
    return n;
  }

  private async execute(s: {
    id: string;
    organizationId: string;
    kind: string;
    classId: string | null;
    recipients: string;
    name: string;
  }) {
    const recipients = JSON.parse(s.recipients) as string[];
    const run = await this.prisma.reportRun.create({
      data: {
        id: newId(),
        scheduleId: s.id,
        organizationId: s.organizationId,
        kind: s.kind,
        status: 'running',
        recipients: s.recipients,
        fileName: '',
      },
    });
    try {
      const report = await this.buildReport(
        s.organizationId,
        s.kind as ReportKind,
        s.classId,
      );
      let delivered = false;
      for (const to of recipients) {
        const ok = await this.mail.send({
          to,
          subject: `${s.name} (${report.rows} rows)`,
          text: `Attached: ${s.name}, generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, ${report.rows} rows.\n\nThis report was sent by SmartSchool on a schedule an administrator set up. Reply to your school office with questions.`,
          attachments: [
            {
              filename: report.fileName,
              content: report.csv,
              contentType: 'text/csv; charset=utf-8',
            },
          ],
        });
        delivered = delivered || ok;
      }
      const finished = await this.prisma.reportRun.update({
        where: { id: run.id },
        data: {
          status: 'ok',
          delivered,
          rowCount: report.rows,
          fileName: report.fileName,
          finishedAt: new Date(),
        },
      });
      await this.prisma.reportSchedule.update({
        where: { id: s.id },
        data: { lastRunAt: new Date() },
      });
      return { ...finished, recipients };
    } catch (err) {
      const failed = await this.prisma.reportRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          error:
            err instanceof Error ? err.message.slice(0, 2000) : String(err),
          finishedAt: new Date(),
        },
      });
      return { ...failed, recipients };
    }
  }

  private readonly scheduleInclude = {
    createdBy: { select: { id: true, firstName: true, lastName: true } },
  } as const;

  private toSchedule(r: {
    id: string;
    organizationId: string;
    name: string;
    kind: string;
    frequency: string;
    dayOfWeek: number | null;
    dayOfMonth: number | null;
    hour: number;
    classId: string | null;
    recipients: string;
    active: boolean;
    createdBy: { id: string; firstName: string; lastName: string } | null;
    lastRunAt: Date | null;
    nextRunAt: Date;
    createdAt: Date;
  }): PublicSchedule {
    return {
      id: r.id,
      organizationId: r.organizationId,
      name: r.name,
      kind: r.kind,
      frequency: r.frequency,
      dayOfWeek: r.dayOfWeek,
      dayOfMonth: r.dayOfMonth,
      hour: r.hour,
      classId: r.classId,
      className: null,
      recipients: JSON.parse(r.recipients) as string[],
      active: r.active,
      createdBy: r.createdBy,
      lastRunAt: r.lastRunAt,
      nextRunAt: r.nextRunAt,
      createdAt: r.createdAt,
    };
  }

  private async scheduleFor(id: string, actor: AuthenticatedUser) {
    const row = await this.prisma.reportSchedule.findUnique({
      where: { id },
      include: this.scheduleInclude,
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Report schedule not found.',
      });
    this.adminOf(row.organizationId, actor);
    return row;
  }

  /** Reports carry student data, so they only go to staff accounts at this school. */
  private async assertStaffRecipients(
    organizationId: string,
    recipients: string[],
  ): Promise<void> {
    const emails = recipients.map((r) => r.toLowerCase());
    const users = await this.prisma.user.findMany({
      where: {
        email: { in: emails },
        deletedAt: null,
        role: { notIn: ['STUDENT', 'PARENT'] },
        OR: [
          { organizationId },
          { role: { in: ['SUPER_ADMIN', 'SUPERINTENDENT'] } },
        ],
      },
      select: { email: true },
    });
    const known = new Set(users.map((u) => u.email.toLowerCase()));
    const unknown = emails.filter((e) => !known.has(e));
    if (unknown.length)
      throw new BadRequestException({
        code: 'insight.recipient_not_staff',
        detail: `Reports go to staff accounts at this school only. Not staff here: ${unknown.join(', ')}.`,
      });
  }

  // ---------------------------------------------------------------------------
  // Access helpers
  // ---------------------------------------------------------------------------

  private adminOf(organizationId: string, actor: AuthenticatedUser): void {
    if (
      ROLE_LEVEL[actor.role] < ROLE_LEVEL.PRINCIPAL &&
      actor.role !== 'COUNSELOR'
    )
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'School-wide insight is for administrators and counselors.',
      });
    if (!isDistrictRole(actor)) assertOrganizationAccess(actor, organizationId);
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
    if (actor.id === 'system') return klass;
    if (
      !canManage(klass, actor) &&
      ROLE_LEVEL[actor.role] < ROLE_LEVEL.PRINCIPAL &&
      actor.role !== 'COUNSELOR'
    )
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only the class teachers, counselors and administrators see this.',
      });
    if (!isDistrictRole(actor))
      assertOrganizationAccess(actor, klass.organizationId);
    return klass;
  }

  private async visibleStudent(studentId: string, actor: AuthenticatedUser) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      include: { guardians: { select: { guardianUserId: true } } },
    });
    if (!student)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Student not found.',
      });
    const family =
      student.userId === actor.id ||
      student.guardians.some((g) => g.guardianUserId === actor.id);
    if (actor.role === 'STUDENT' || actor.role === 'PARENT') {
      if (family) return student;
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Not available for your account.',
      });
    }
    if (!isDistrictRole(actor))
      assertOrganizationAccess(actor, student.organizationId);
    if (actor.role === 'TEACHER' || actor.role === 'ASSISTANT') {
      const teaches = await this.prisma.classEnrollment.count({
        where: {
          studentId,
          status: { in: ['ENROLLED', 'COMPLETED'] },
          class: { teachers: { some: { teacherId: actor.id } } },
        },
      });
      if (teaches === 0)
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: "Only this student's teachers see their insight.",
        });
    }
    return student;
  }
}

/** A transcript: school header, student, one block per school year with its courses and GPA, cumulative GPA, a footer. */
function renderTranscript(input: {
  student: {
    firstName: string;
    lastName: string;
    studentNumber: string;
    gradeLevel: string | null;
    dateOfBirth: Date | null;
  };
  org: { name: string; address: string | null; phone: string | null };
  summary: ReturnType<typeof transcriptSummary>;
  generatedAt: Date;
}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 54,
      info: {
        Title: `Transcript ${input.student.lastName} ${input.student.firstName}`,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    doc.fontSize(18).text(input.org.name);
    doc
      .fontSize(9)
      .fillColor('#555')
      .text([input.org.address, input.org.phone].filter(Boolean).join(' · '));
    doc
      .moveDown(0.5)
      .fillColor('#000')
      .fontSize(14)
      .text('Official transcript');
    doc.fontSize(10).text(`Generated ${isoDay(input.generatedAt)}`);
    doc.moveDown();
    doc
      .fontSize(11)
      .text(`${input.student.lastName}, ${input.student.firstName}`, {
        continued: true,
      })
      .fontSize(9)
      .fillColor('#555')
      .text(
        `   ${input.student.studentNumber}${input.student.gradeLevel ? ` · Grade ${input.student.gradeLevel}` : ''}${input.student.dateOfBirth ? ` · Born ${isoDay(input.student.dateOfBirth)}` : ''}`,
      );
    doc.fillColor('#000');
    const cols = [
      width * 0.36,
      width * 0.2,
      width * 0.14,
      width * 0.1,
      width * 0.1,
      width * 0.1,
    ];
    const labels = ['Course', 'Class', 'Period', 'Percent', 'Letter', 'GPA'];
    const header = (y: number) => {
      doc.fontSize(8).fillColor('#555');
      let x = left;
      labels.forEach((label, i) => {
        doc.text(label, x, y, {
          width: cols[i],
          align: i >= 3 ? 'right' : 'left',
        });
        x += cols[i];
      });
      doc
        .moveTo(left, y + 12)
        .lineTo(left + width, y + 12)
        .strokeColor('#999')
        .stroke();
      doc.fillColor('#000');
    };
    let y = doc.y + 10;
    if (input.summary.years.length === 0) {
      doc.fontSize(10).text('No published report cards yet.', left, y);
      y += 20;
    }
    for (const year of input.summary.years) {
      if (y > doc.page.height - 160) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc
        .fontSize(12)
        .text(
          `${year.yearName}${year.gpa !== null ? `   GPA ${year.gpa.toFixed(2)}` : ''}`,
          left,
          y,
        );
      y += 18;
      header(y);
      y += 18;
      for (const l of year.lines) {
        if (y > doc.page.height - 120) {
          doc.addPage();
          y = doc.page.margins.top;
          header(y);
          y += 18;
        }
        doc.fontSize(9);
        const cells = [
          l.courseTitle,
          l.className,
          `${l.termName} ${l.periodName}`,
          l.percentage === null ? '' : `${l.percentage.toFixed(1)}%`,
          l.letter ?? '',
          l.gpaPoints === null ? '' : l.gpaPoints.toFixed(2),
        ];
        let x = left;
        cells.forEach((c, i) => {
          doc.text(c, x, y, {
            width: cols[i],
            align: i >= 3 ? 'right' : 'left',
            lineBreak: false,
            ellipsis: true,
          });
          x += cols[i];
        });
        y += 15;
      }
      y += 10;
    }
    if (y > doc.page.height - 120) {
      doc.addPage();
      y = doc.page.margins.top;
    }
    doc
      .fontSize(11)
      .text(
        `Courses on record: ${input.summary.courses}${input.summary.cumulativeGpa !== null ? `   ·   Cumulative GPA: ${input.summary.cumulativeGpa.toFixed(2)}` : ''}`,
        left,
        y + 6,
      );
    doc
      .moveDown(2)
      .fontSize(8)
      .fillColor('#555')
      .text(
        'GPA is the unweighted mean of GPA points on published report cards. Credits are not tracked. Questions go to the school office.',
        left,
      );
    doc.end();
  });
}
