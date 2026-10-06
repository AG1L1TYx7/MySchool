import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AppConfigService } from '../../config/app-config.service';
import { MailService } from '../../infra/mail/mail.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { parseGradingScale, letterFor } from '../gradebook/gradebook-rules';
import { mergePreferences } from '../notifications/notification-rules';
import { NotificationsService } from '../notifications/notifications.service';
import {
  isMissing,
  isUpcoming,
  localeOf,
  renderDigest,
  strings,
  type ChildDigest,
  type WorkItem,
} from './family-rules';

export interface ChildHome {
  student: {
    id: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
    gradeLevel: string | null;
  };
  classes: Array<{
    id: string;
    name: string;
    courseTitle: string;
    teacher: string | null;
    percentage: number | null;
    letter: string | null;
  }>;
  attendance: {
    rate: number | null;
    daysPresent: number;
    daysAbsent: number;
    tardies: number;
  };
  missing: Array<{
    assignmentId: string;
    title: string;
    className: string;
    dueAt: Date | null;
  }>;
  upcoming: Array<{
    assignmentId: string;
    title: string;
    className: string;
    dueAt: Date | null;
  }>;
  recentGrades: Array<{
    assignmentId: string;
    title: string;
    className: string;
    score: number;
    maxPoints: number;
    percentage: number;
    gradedAt: Date;
  }>;
  behaviorNotes: number;
  reportCards: number;
}

/**
 * The family experience (docs/13 section 7): one home for every child, missing-work alerts and a weekly
 * digest in the family's language. Numbers come from the same tables teachers use; nothing is estimated.
 */
@Injectable()
export class FamilyService {
  private readonly logger = new Logger(FamilyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /** Every child of the signed-in parent (or the student themself) with the week at a glance. */
  async home(actor: AuthenticatedUser): Promise<{ children: ChildHome[] }> {
    if (actor.role !== 'PARENT' && actor.role !== 'STUDENT')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'The family home is for parents and students.',
      });
    const students = await this.prisma.student.findMany({
      where: {
        deletedAt: null,
        ...(actor.role === 'PARENT'
          ? { guardians: { some: { guardianUserId: actor.id } } }
          : { userId: actor.id }),
      },
      select: {
        id: true,
        studentNumber: true,
        firstName: true,
        lastName: true,
        gradeLevel: true,
        organizationId: true,
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    const children = await Promise.all(students.map((s) => this.childHome(s)));
    return { children };
  }

  private async childHome(student: {
    id: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
    gradeLevel: string | null;
    organizationId: string;
  }): Promise<ChildHome> {
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
    const [org, enrollments, work, attendance, behaviorNotes, reportCards] =
      await Promise.all([
        this.prisma.organization.findUnique({
          where: { id: student.organizationId },
          select: { gradingScale: true, behaviorVisibility: true },
        }),
        this.prisma.classEnrollment.findMany({
          where: {
            studentId: student.id,
            status: { in: ['ENROLLED', 'COMPLETED'] },
            class: { deletedAt: null },
          },
          include: {
            class: {
              select: {
                id: true,
                name: true,
                course: { select: { title: true } },
                teachers: {
                  where: { isPrimary: true },
                  include: {
                    teacher: { select: { firstName: true, lastName: true } },
                  },
                  take: 1,
                },
              },
            },
          },
        }),
        this.workItems(student.id),
        this.prisma.attendance.findMany({
          where: { studentId: student.id, date: { gte: since } },
          select: {
            date: true,
            status: true,
            code: { select: { countsAsPresent: true, category: true } },
          },
        }),
        this.prisma.behaviorRecord.count({
          where: {
            studentId: student.id,
            OR: [
              { parentVisible: true },
              { parentVisible: null, kind: 'POSITIVE' },
            ],
          },
        }),
        this.prisma.reportCard.count({
          where: { studentId: student.id, status: 'PUBLISHED' },
        }),
      ]);
    const scale = parseGradingScale(org?.gradingScale);
    const classes = enrollments.map((e) => {
      const pct = e.currentGrade === null ? null : Number(e.currentGrade);
      const t = e.class.teachers[0]?.teacher;
      return {
        id: e.class.id,
        name: e.class.name,
        courseTitle: e.class.course.title,
        teacher: t ? `${t.firstName} ${t.lastName}` : null,
        percentage: pct,
        letter: pct === null ? null : letterFor(pct, scale),
      };
    });
    const days = new Map<string, { present: boolean; tardy: boolean }>();
    for (const r of attendance) {
      const key = r.date.toISOString().slice(0, 10);
      const present = r.code
        ? r.code.countsAsPresent
        : ['PRESENT', 'TARDY', 'LATE', 'LEFT_EARLY'].includes(r.status);
      const tardy = r.code
        ? r.code.category === 'TARDY'
        : r.status === 'TARDY' || r.status === 'LATE';
      const cur = days.get(key) ?? { present: false, tardy: false };
      days.set(key, {
        present: cur.present || present,
        tardy: cur.tardy || tardy,
      });
    }
    const present = [...days.values()].filter((d) => d.present).length;
    const grades = await this.prisma.grade.findMany({
      where: { studentId: student.id, gradedAt: { gte: weekAgo } },
      include: {
        assignment: {
          select: { id: true, title: true, class: { select: { name: true } } },
        },
      },
      orderBy: { gradedAt: 'desc' },
      take: 8,
    });
    return {
      student: {
        id: student.id,
        studentNumber: student.studentNumber,
        firstName: student.firstName,
        lastName: student.lastName,
        gradeLevel: student.gradeLevel,
      },
      classes,
      attendance: {
        rate: days.size
          ? Math.round((present / days.size) * 10000) / 100
          : null,
        daysPresent: present,
        daysAbsent: days.size - present,
        tardies: [...days.values()].filter((d) => d.tardy).length,
      },
      missing: work
        .filter((w) => isMissing(w, now))
        .map(({ assignmentId, title, className, dueAt }) => ({
          assignmentId,
          title,
          className,
          dueAt,
        })),
      upcoming: work
        .filter((w) => isUpcoming(w, now))
        .sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0))
        .map(({ assignmentId, title, className, dueAt }) => ({
          assignmentId,
          title,
          className,
          dueAt,
        })),
      recentGrades: grades.map((g) => ({
        assignmentId: g.assignment.id,
        title: g.assignment.title,
        className: g.assignment.class.name,
        score: Number(g.score),
        maxPoints: Number(g.maxPoints),
        percentage: Number(g.percentage),
        gradedAt: g.gradedAt,
      })),
      behaviorNotes,
      reportCards,
    };
  }

  /** Published assignments in the student's classes with their submission, grade and mark state. */
  private async workItems(studentId: string): Promise<WorkItem[]> {
    const rows = await this.prisma.assignment.findMany({
      where: {
        deletedAt: null,
        status: { in: ['PUBLISHED', 'CLOSED'] },
        class: {
          deletedAt: null,
          enrollments: {
            some: { studentId, status: { in: ['ENROLLED', 'COMPLETED'] } },
          },
        },
      },
      select: {
        id: true,
        title: true,
        dueAt: true,
        class: { select: { name: true } },
        submissions: { where: { studentId }, select: { id: true }, take: 1 },
        grades: { where: { studentId }, select: { id: true }, take: 1 },
        marks: { where: { studentId }, select: { mark: true }, take: 1 },
      },
      orderBy: { dueAt: 'asc' },
      take: 500,
    });
    return rows.map((a) => ({
      assignmentId: a.id,
      title: a.title,
      className: a.class.name,
      dueAt: a.dueAt,
      submitted: a.submissions.length > 0,
      graded: a.grades.length > 0,
      mark: a.marks[0]?.mark ?? null,
    }));
  }

  // ---------------------------------------------------------------------------
  // Alerts and digest
  // ---------------------------------------------------------------------------

  /** Each school-day afternoon: tell guardians about work that became missing in the last day. */
  @Cron('30 16 * * 1-5')
  async missingWorkAlerts(): Promise<void> {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 86_400_000);
    const students = await this.prisma.student.findMany({
      where: {
        deletedAt: null,
        enrollmentStatus: 'ACTIVE',
        guardians: { some: { receivesNotifications: true } },
      },
      select: { id: true, firstName: true, organizationId: true },
    });
    let sent = 0;
    for (const s of students) {
      try {
        const work = await this.workItems(s.id);
        const fresh = work.filter(
          (w) =>
            isMissing(w, now) &&
            w.dueAt &&
            w.dueAt.getTime() >= dayAgo.getTime(),
        );
        if (fresh.length === 0) continue;
        sent += await this.notifyGuardians(
          s.id,
          (locale) => {
            const t = strings(locale);
            return {
              title: t.missingAlertTitle(s.firstName, fresh.length),
              body: t.missingAlertBody(
                fresh.map((w) => `${w.title} (${w.className})`).join(', '),
              ),
            };
          },
          'ASSIGNMENT',
          '/family',
          s.organizationId,
        );
      } catch (err) {
        this.logger.warn(
          `Missing-work alert failed for student ${s.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (sent)
      this.logger.log(
        `Missing-work alerts: ${sent} guardian notification${sent === 1 ? '' : 's'}`,
      );
  }

  /** Sunday evening: one email per guardian with every child's week, in the guardian's language. */
  @Cron('0 17 * * 0')
  async weeklyDigest(): Promise<void> {
    const guardians = await this.prisma.user.findMany({
      where: {
        role: 'PARENT',
        status: 'ACTIVE',
        deletedAt: null,
        guardianLinks: { some: { receivesNotifications: true } },
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        locale: true,
        guardianLinks: {
          where: { receivesNotifications: true },
          select: {
            student: {
              select: {
                id: true,
                studentNumber: true,
                firstName: true,
                lastName: true,
                gradeLevel: true,
                organizationId: true,
                deletedAt: true,
              },
            },
          },
        },
      },
    });
    let sent = 0;
    for (const g of guardians) {
      try {
        const prefs = mergePreferences(
          await this.prisma.notificationPreference.findMany({
            where: { userId: g.id },
          }),
        );
        const digestPref = prefs.find((p) => p.category === 'DIGEST');
        if (digestPref && !digestPref.email && !digestPref.inApp) continue;
        const children = g.guardianLinks
          .map((x) => x.student)
          .filter((s) => !s.deletedAt);
        if (children.length === 0) continue;
        const locale = localeOf(g.locale);
        const digests: ChildDigest[] = [];
        for (const child of children) {
          const home = await this.childHome(child);
          digests.push({
            firstName: child.firstName,
            classes: home.classes.map((c) => ({
              name: c.name,
              percentage: c.percentage,
              letter: c.letter,
            })),
            attendanceRate: home.attendance.rate,
            daysAbsent: home.attendance.daysAbsent,
            missing: home.missing.map((m) => ({
              title: m.title,
              className: m.className,
            })),
            upcoming: home.upcoming.slice(0, 5).map((u) => ({
              title: u.title,
              className: u.className,
              dueAt: u.dueAt,
            })),
            gradedThisWeek: home.recentGrades.length,
          });
        }
        const t = strings(locale);
        const names = children
          .map((c) => c.firstName)
          .join(locale === 'es' ? ' y ' : ' and ');
        if (!digestPref || digestPref.inApp)
          await this.notifications.notify([g.id], {
            category: 'DIGEST',
            title: t.digestTitle,
            body: t.digestBody(names),
            link: '/family',
            entityType: 'User',
            entityId: g.id,
          });
        if (!digestPref || digestPref.email) {
          const rendered = renderDigest(locale, g.firstName, digests);
          const base = this.config.get('WEB_APP_URL').replace(/\/$/, '');
          await this.mail.send({
            to: g.email,
            subject: `[SmartSchool] ${rendered.subject}`,
            text: `${rendered.text}\n\n${base}/family`,
          });
        }
        sent += 1;
      } catch (err) {
        this.logger.warn(
          `Weekly digest failed for guardian ${g.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (sent)
      this.logger.log(
        `Weekly digest: ${sent} guardian${sent === 1 ? '' : 's'}`,
      );
    await this.audit.record({
      userId: null,
      organizationId: null,
      action: 'family.digest.sent',
      entityType: 'System',
      entityId: null,
      details: { guardians: sent },
    });
  }

  /** Builds a digest on demand (for a parent's own preview or an e2e check); same content as the email. */
  async digestPreview(
    actor: AuthenticatedUser,
  ): Promise<{ subject: string; text: string }> {
    if (actor.role !== 'PARENT')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Parents only.',
      });
    const me = await this.prisma.user.findUniqueOrThrow({
      where: { id: actor.id },
      select: { firstName: true, locale: true },
    });
    const { children } = await this.home(actor);
    const locale = localeOf(me.locale);
    return renderDigest(
      locale,
      me.firstName,
      children.map((c) => ({
        firstName: c.student.firstName,
        classes: c.classes.map((k) => ({
          name: k.name,
          percentage: k.percentage,
          letter: k.letter,
        })),
        attendanceRate: c.attendance.rate,
        daysAbsent: c.attendance.daysAbsent,
        missing: c.missing.map((m) => ({
          title: m.title,
          className: m.className,
        })),
        upcoming: c.upcoming.slice(0, 5).map((u) => ({
          title: u.title,
          className: u.className,
          dueAt: u.dueAt,
        })),
        gradedThisWeek: c.recentGrades.length,
      })),
    );
  }

  private async notifyGuardians(
    studentId: string,
    build: (locale: 'en' | 'es') => { title: string; body: string },
    category: 'ASSIGNMENT' | 'DIGEST',
    link: string,
    organizationId: string,
  ): Promise<number> {
    const guardians = await this.prisma.studentGuardian.findMany({
      where: { studentId, receivesNotifications: true },
      select: {
        guardian: { select: { id: true, locale: true, status: true } },
      },
    });
    let count = 0;
    for (const g of guardians) {
      if (g.guardian.status !== 'ACTIVE') continue;
      const msg = build(localeOf(g.guardian.locale));
      count += await this.notifications.notify([g.guardian.id], {
        category,
        title: msg.title,
        body: msg.body,
        link,
        entityType: 'Student',
        entityId: studentId,
      });
    }
    if (count)
      await this.audit.record({
        userId: null,
        organizationId,
        action: 'family.missing_work.alert',
        entityType: 'Student',
        entityId: studentId,
        details: { notified: count },
      });
    return count;
  }
}
