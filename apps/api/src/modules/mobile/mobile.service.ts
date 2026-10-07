import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AnnouncementsService } from '../announcements/announcements.service';
import { AssignmentsService } from '../assignments/assignments.service';
import { ListAssignmentsQuery } from '../assignments/dto/assignments.dto';
import { AttendanceReportsService } from '../attendance/attendance-reports.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ClassesService } from '../classes/classes.service';
import { MotivationService } from '../motivation/motivation.service';
import { NotificationsService } from '../notifications/notifications.service';
import { meetsOn } from '../school/school-rules';
import {
  compactAssignment,
  nextCursor,
  parseSince,
  sortForPhone,
  type CompactAssignment,
} from './mobile-rules';

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The mobile API (docs/02 section 17): one compact home call, a sync payload for offline use, and slim lists.
 * It composes the same services the web uses, so permissions and scoping are identical; it only trims the shapes.
 */
@Injectable()
export class MobileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly classes: ClassesService,
    private readonly assignments: AssignmentsService,
    private readonly announcements: AnnouncementsService,
    private readonly notifications: NotificationsService,
    private readonly motivation: MotivationService,
    private readonly attendanceReports: AttendanceReportsService,
  ) {}

  /** Everything the first screen of the app needs in one round trip. */
  async home(actor: AuthenticatedUser) {
    const now = new Date();
    const [classes, summary, announcements, work] = await Promise.all([
      this.classes.mine(actor),
      this.notifications.summary(actor),
      this.announcements.list({ page: 1, pageSize: 3 }, actor),
      this.workFor(actor, now),
    ]);
    const today = new Date(`${isoDay(now)}T00:00:00Z`);
    const todayClasses = classes
      .filter((c) => !c.period || meetsOn(c.period.days, today))
      .map((c) => ({
        id: c.id,
        name: c.name,
        course: c.course.title,
        period: c.period
          ? {
              name: c.period.name,
              startTime: c.period.startTime,
              endTime: c.period.endTime,
            }
          : null,
        teachers: c.teachers.map((t) => `${t.firstName} ${t.lastName}`),
      }))
      .sort((a, b) =>
        (a.period?.startTime ?? '99').localeCompare(
          b.period?.startTime ?? '99',
        ),
      );
    const motivation =
      actor.role === 'STUDENT'
        ? await this.motivation.mine(actor).catch(() => null)
        : null;
    const attendance =
      ['TEACHER', 'ASSISTANT'].includes(actor.role) && actor.organizationId
        ? await this.attendanceReports
            .takenStatus(actor.organizationId, isoDay(now), actor)
            .then((t) => {
              const mine = new Set(classes.map((c) => c.id));
              return {
                date: t.date,
                deadline: t.deadline,
                toTake: t.missing
                  .filter((m) => mine.has(m.classId))
                  .map((m) => ({
                    classId: m.classId,
                    name: m.name,
                    period: m.period,
                    enrolled: m.enrolled,
                  })),
              };
            })
            .catch(() => null)
        : null;
    const children =
      actor.role === 'PARENT'
        ? await this.prisma.student.findMany({
            where: {
              guardians: { some: { guardianUserId: actor.id } },
              deletedAt: null,
            },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              gradeLevel: true,
            },
            orderBy: { firstName: 'asc' },
          })
        : [];
    return {
      serverTime: now.toISOString(),
      user: {
        id: actor.id,
        role: actor.role,
        organizationId: actor.organizationId,
      },
      unread: summary.unread,
      todayClasses,
      work: {
        overdue: work
          .filter((w) => w.bucket === 'overdue' && w.state === 'missing')
          .slice(0, 20),
        dueSoon: work
          .filter(
            (w) =>
              ['today', 'tomorrow', 'this_week'].includes(w.bucket) &&
              w.state !== 'graded',
          )
          .slice(0, 20),
        recentlyGraded: work
          .filter((w) => w.state === 'graded')
          .slice(-5)
          .reverse(),
      },
      attendance,
      motivation: motivation
        ? {
            xp: motivation.xp,
            level: motivation.level,
            title: motivation.title,
            streakDays: motivation.streak.days,
            todayXp: motivation.todayXp,
          }
        : null,
      children,
      announcements: announcements.data.map((a) => ({
        id: a.id,
        title: a.title,
        publishedAt: a.publishedAt,
        author: a.author ? `${a.author.firstName} ${a.author.lastName}` : null,
      })),
    };
  }

  /** Changes since a cursor, for a phone that caches: assignments, grades, announcements, notifications, classes, tutor conversations. */
  async sync(actor: AuthenticatedUser, since?: string) {
    const now = new Date();
    const from = parseSince(since, now);
    const classes = await this.classes.mine(actor);
    const classIds = classes.map((c) => c.id);
    const [assignments, announcements, notifications, conversations] =
      await Promise.all([
        this.prisma.assignment.findMany({
          where: {
            classId: { in: classIds },
            deletedAt: null,
            status: { in: ['PUBLISHED', 'CLOSED'] },
            ...(from ? { updatedAt: { gt: from } } : {}),
          },
          select: {
            id: true,
            title: true,
            classId: true,
            type: true,
            dueAt: true,
            maxPoints: true,
            status: true,
            updatedAt: true,
            class: { select: { name: true } },
          },
          orderBy: { updatedAt: 'asc' },
          take: 500,
        }),
        this.announcements
          .list({ page: 1, pageSize: 50 }, actor)
          .then((r) =>
            r.data.filter(
              (a) => !from || !a.publishedAt || a.publishedAt > from,
            ),
          ),
        this.prisma.notification.findMany({
          where: {
            recipientId: actor.id,
            ...(from ? { createdAt: { gt: from } } : {}),
          },
          orderBy: { createdAt: 'asc' },
          take: 200,
        }),
        this.prisma.aiConversation.findMany({
          where: {
            userId: actor.id,
            deletedAt: null,
            ...(from ? { updatedAt: { gt: from } } : {}),
          },
          select: {
            id: true,
            title: true,
            capability: true,
            messageCount: true,
            lessonId: true,
            updatedAt: true,
          },
          orderBy: { updatedAt: 'asc' },
          take: 100,
        }),
      ]);
    const myGrades =
      actor.role === 'STUDENT' || actor.role === 'PARENT'
        ? await this.gradesFor(actor, from)
        : [];
    return {
      serverTime: now.toISOString(),
      since: from ? from.toISOString() : null,
      next: nextCursor(now),
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        course: c.course.title,
        term: c.term,
        period: c.period?.name ?? null,
      })),
      assignments: assignments.map((a) => ({
        id: a.id,
        title: a.title,
        classId: a.classId,
        className: a.class.name,
        type: a.type.toLowerCase(),
        dueAt: a.dueAt,
        maxPoints: Number(a.maxPoints),
        status: a.status.toLowerCase(),
        updatedAt: a.updatedAt,
      })),
      grades: myGrades,
      announcements: announcements.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.content.slice(0, 2000),
        publishedAt: a.publishedAt,
      })),
      notifications: notifications.map((n) => ({
        id: n.id,
        category: n.category.toLowerCase(),
        title: n.title,
        body: n.body,
        link: n.link,
        isRead: n.isRead,
        createdAt: n.createdAt,
      })),
      conversations,
    };
  }

  async classesList(actor: AuthenticatedUser) {
    const classes = await this.classes.mine(actor);
    return {
      data: classes.map((c) => ({
        id: c.id,
        name: c.name,
        course: c.course.title,
        courseCode: c.course.courseCode,
        term: c.term,
        period: c.period
          ? {
              name: c.period.name,
              days: c.period.days,
              startTime: c.period.startTime,
              endTime: c.period.endTime,
            }
          : null,
        teachers: c.teachers.map((t) => `${t.firstName} ${t.lastName}`),
        status: c.status,
      })),
    };
  }

  async assignmentsList(actor: AuthenticatedUser, page = 1, pageSize = 25) {
    const res = await this.assignments.list(
      Object.assign(new ListAssignmentsQuery(), {
        page,
        pageSize,
        dueAfter: new Date(Date.now() - 30 * DAY).toISOString(),
      }),
      actor,
    );
    const now = new Date();
    return {
      data: sortForPhone(
        res.data.map((a) =>
          compactAssignment(
            { ...a, dueAt: a.dueAt ? new Date(a.dueAt) : null },
            now,
          ),
        ),
      ),
      meta: res.meta,
    };
  }

  async gradesList(actor: AuthenticatedUser) {
    return { data: await this.gradesFor(actor, null) };
  }

  async attendanceList(actor: AuthenticatedUser, days = 30) {
    const since = new Date(Date.now() - days * DAY);
    const studentIds =
      actor.role === 'STUDENT'
        ? (
            await this.prisma.student.findMany({
              where: { userId: actor.id, deletedAt: null },
              select: { id: true },
            })
          ).map((s) => s.id)
        : actor.role === 'PARENT'
          ? (
              await this.prisma.student.findMany({
                where: {
                  guardians: { some: { guardianUserId: actor.id } },
                  deletedAt: null,
                },
                select: { id: true },
              })
            ).map((s) => s.id)
          : [];
    if (studentIds.length === 0) return { data: [] };
    const rows = await this.prisma.attendance.findMany({
      where: { studentId: { in: studentIds }, date: { gte: since } },
      select: {
        id: true,
        studentId: true,
        classId: true,
        date: true,
        status: true,
        class: { select: { name: true } },
      },
      orderBy: { date: 'desc' },
      take: 500,
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        studentId: r.studentId,
        classId: r.classId,
        className: r.class.name,
        date: isoDay(r.date),
        status: r.status.toLowerCase(),
      })),
    };
  }

  private async workFor(
    actor: AuthenticatedUser,
    now: Date,
  ): Promise<CompactAssignment[]> {
    const res = await this.assignments.list(
      Object.assign(new ListAssignmentsQuery(), {
        page: 1,
        pageSize: 100,
        dueAfter: new Date(now.getTime() - 14 * DAY).toISOString(),
        dueBefore: new Date(now.getTime() + 14 * DAY).toISOString(),
      }),
      actor,
    );
    return sortForPhone(
      res.data.map((a) =>
        compactAssignment(
          { ...a, dueAt: a.dueAt ? new Date(a.dueAt) : null },
          now,
        ),
      ),
    );
  }

  private async gradesFor(actor: AuthenticatedUser, from: Date | null) {
    const where =
      actor.role === 'STUDENT'
        ? { student: { userId: actor.id } }
        : { student: { guardians: { some: { guardianUserId: actor.id } } } };
    const rows = await this.prisma.grade.findMany({
      where: { ...where, ...(from ? { gradedAt: { gt: from } } : {}) },
      select: {
        id: true,
        studentId: true,
        assignmentId: true,
        score: true,
        maxPoints: true,
        percentage: true,
        letterGrade: true,
        feedback: true,
        gradedAt: true,
        assignment: {
          select: {
            title: true,
            classId: true,
            class: { select: { name: true } },
          },
        },
      },
      orderBy: { gradedAt: 'desc' },
      take: 200,
    });
    return rows.map((g) => ({
      id: g.id,
      studentId: g.studentId,
      assignmentId: g.assignmentId,
      title: g.assignment.title,
      classId: g.assignment.classId,
      className: g.assignment.class.name,
      score: Number(g.score),
      maxPoints: Number(g.maxPoints),
      percentage: Number(g.percentage),
      letter: g.letterGrade,
      feedback: g.feedback,
      gradedAt: g.gradedAt,
      updatedAt: g.gradedAt,
    }));
  }
}
