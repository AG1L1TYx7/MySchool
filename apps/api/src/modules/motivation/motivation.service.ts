import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { Cron } from '@nestjs/schedule';
import { domainEvent } from '../../common/events/domain-event';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { assertOrganizationAccess } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canManage } from '../classes/classes.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AwardDto,
  CreateQuestDto,
  MotivationSettingsDto,
} from './dto/motivation.dto';
import {
  advanceStreak,
  BADGES,
  DAILY_AUTO_XP_CAP,
  isoDate,
  levelFor,
  newlyEarnedBadges,
  questIncrement,
  streakAlive,
  titleFor,
  weeklyQuests,
  weekWindow,
  XP,
  xpForLevel,
  type BadgeStats,
  type LearningAction,
  type StreakState,
  type XpReason,
} from './motivation-rules';

export interface PublicBadge {
  code: string;
  name: string;
  description: string;
  category: string;
  tier: number;
  icon: string;
  teacherAwarded: boolean;
  earnedAt: Date;
  reason: string | null;
  awardedBy: { firstName: string; lastName: string } | null;
}
export interface PublicQuest {
  id: string;
  title: string;
  description: string | null;
  metric: string;
  goal: number;
  rewardXp: number;
  startsAt: Date;
  endsAt: Date;
  status: 'active' | 'completed' | 'expired';
  kind: 'personal' | 'class';
  auto: boolean;
  classId: string | null;
  className: string | null;
  /** The caller's (or the viewed student's) own count. */
  progress: number;
  /** Class quests: everyone's count together; never broken down by student. */
  classTotal: number | null;
}
export interface MotivationSummary {
  enabled: boolean;
  student: { id: string; firstName: string; lastName: string };
  xp: number;
  level: number;
  title: string;
  levelStartXp: number;
  nextLevelXp: number;
  todayXp: number;
  streak: {
    days: number;
    longest: number;
    alive: boolean;
    freezeTokens: number;
    lastActionOn: string | null;
  };
  badges: PublicBadge[];
  quests: PublicQuest[];
  recent: Array<{
    id: string;
    reason: string;
    amount: number;
    note: string | null;
    entityType: string;
    createdAt: Date;
  }>;
}
export interface RewardOutcome {
  granted: number;
  level: number;
  leveledUp: boolean;
  badges: string[];
  streakDays: number;
}

interface Grant {
  reason: XpReason;
  amount: number;
  entityType: string;
  entityId: string;
  note?: string;
  awardedById?: string;
}

const AUTO_REASONS: XpReason[] = [
  'lesson.completed',
  'assignment.submitted',
  'assignment.on_time',
  'score.improved',
  'score.perfect',
];

const dayStart = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isUnique = (err: unknown) =>
  typeof err === 'object' &&
  err !== null &&
  (err as { code?: string }).code === 'P2002';

/**
 * Private motivation (docs/12 section 4, ADR-024): XP, levels, streaks, badges and quests awarded from
 * learning events, visible only to the student, their family and their teachers. Nothing here ranks.
 */
@Injectable()
export class MotivationService {
  private readonly logger = new Logger(MotivationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Event handlers
  // ---------------------------------------------------------------------------

  async onSubmitted(
    studentId: string,
    assignmentId: string,
    late: boolean,
    organizationId: string | null,
  ): Promise<RewardOutcome | null> {
    const grants: Grant[] = [
      {
        reason: 'assignment.submitted',
        amount: XP.ASSIGNMENT_SUBMITTED,
        entityType: 'Assignment',
        entityId: assignmentId,
      },
    ];
    if (!late)
      grants.push({
        reason: 'assignment.on_time',
        amount: XP.ON_TIME_BONUS,
        entityType: 'Assignment',
        entityId: assignmentId,
      });
    // A second attempt grants nothing (unique per assignment) and does not count as a new submission.
    const already = await this.prisma.rewardTransaction.findFirst({
      where: {
        studentId,
        reason: 'assignment.submitted',
        entityType: 'Assignment',
        entityId: assignmentId,
      },
      select: { id: true },
    });
    if (already) return null;
    return this.recordAction(
      studentId,
      organizationId,
      { kind: 'submission', onTime: !late },
      grants,
    );
  }

  async onGraded(
    studentId: string,
    assignmentId: string,
    percentage: number,
    organizationId: string | null,
  ): Promise<RewardOutcome | null> {
    const grants: Grant[] = [];
    if (percentage >= 100)
      grants.push({
        reason: 'score.perfect',
        amount: XP.PERFECT_SCORE,
        entityType: 'Assignment',
        entityId: assignmentId,
      });
    const current = await this.prisma.grade.findFirst({
      where: { studentId, assignmentId },
      select: { gradedAt: true },
      orderBy: { gradedAt: 'desc' },
    });
    const previous = await this.prisma.grade.findFirst({
      where: {
        studentId,
        assignmentId: { not: assignmentId },
        ...(current ? { gradedAt: { lt: current.gradedAt } } : {}),
      },
      orderBy: { gradedAt: 'desc' },
      select: { percentage: true },
    });
    if (previous && percentage > Number(previous.percentage))
      grants.push({
        reason: 'score.improved',
        amount: XP.SCORE_IMPROVED,
        entityType: 'Assignment',
        entityId: assignmentId,
      });
    if (grants.length === 0) return null;
    return this.recordAction(
      studentId,
      organizationId,
      { kind: 'xp', amount: grants.reduce((s, g) => s + g.amount, 0) },
      grants,
    );
  }

  // ---------------------------------------------------------------------------
  // Core: one learning action
  // ---------------------------------------------------------------------------

  /** Applies grants once per entity under the daily cap, advances the streak, quests and badges. */
  async recordAction(
    studentId: string,
    organizationId: string | null,
    action: LearningAction,
    grants: Grant[],
  ): Promise<RewardOutcome | null> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: {
        id: true,
        userId: true,
        firstName: true,
        organizationId: true,
        organization: { select: { motivationEnabled: true } },
      },
    });
    if (!student || !student.organization.motivationEnabled) return null;
    const orgId = organizationId ?? student.organizationId;
    const today = isoDate(new Date());
    const points = await this.ensurePoints(studentId);
    const autoToday = await this.prisma.rewardTransaction.aggregate({
      _sum: { amount: true },
      where: {
        studentId,
        createdAt: { gte: dayStart(today) },
        reason: { in: AUTO_REASONS },
      },
    });
    let autoSoFar = autoToday._sum.amount ?? 0;
    let granted = 0;
    for (const g of grants) {
      let amount = g.amount;
      if (AUTO_REASONS.includes(g.reason)) {
        const room = DAILY_AUTO_XP_CAP - autoSoFar;
        if (room <= 0) continue;
        amount = Math.min(amount, room);
      }
      try {
        await this.prisma.rewardTransaction.create({
          data: {
            id: newId(),
            studentId,
            amount,
            reason: g.reason,
            entityType: g.entityType,
            entityId: g.entityId,
            note: g.note ?? null,
            awardedById: g.awardedById ?? null,
          },
        });
      } catch (err) {
        if (isUnique(err)) continue; // already granted for this entity
        throw err;
      }
      granted += amount;
      if (AUTO_REASONS.includes(g.reason)) autoSoFar += amount;
    }

    const learning = action.kind !== 'xp' || granted > 0;
    const streak = learning
      ? advanceStreak(this.streakState(points), today)
      : null;
    const xp = points.xp + granted;
    const level = levelFor(xp);
    const leveledUp = level > points.level;
    await this.prisma.studentPoints.update({
      where: { studentId },
      data: {
        xp,
        level,
        title: titleFor(level),
        ...(streak
          ? {
              streakDays: streak.streakDays,
              longestStreak: streak.longestStreak,
              lastActionOn: dayStart(today),
              freezeTokens: streak.freezeTokens,
              freezesUsed: streak.freezesUsed,
            }
          : {}),
      },
    });

    const actions: LearningAction[] = [action];
    if (granted > 0 && action.kind !== 'xp')
      actions.push({ kind: 'xp', amount: granted });
    await this.advanceQuests(studentId, orgId, actions);

    const stats = await this.stats(studentId, {
      level,
      streakDays: streak?.streakDays ?? points.streakDays,
      longestStreak: streak?.longestStreak ?? points.longestStreak,
    });
    const owned = new Set(
      (
        await this.prisma.studentBadge.findMany({
          where: { studentId },
          select: { badge: { select: { code: true } } },
        })
      ).map((b) => b.badge.code),
    );
    const earned = newlyEarnedBadges(stats, owned);
    for (const code of earned)
      await this.giveBadge(studentId, code, null, null);

    if (student.userId) {
      if (leveledUp)
        await this.notifications.notify([student.userId], {
          category: 'MOTIVATION',
          title: `Level ${level}! You are now ${titleFor(level)}`,
          body: `${xp} XP so far. Keep going.`,
          link: '/motivation',
          entityType: 'StudentPoints',
          entityId: studentId,
        });
      if (streak?.earnedFreeze)
        await this.notifications.notify([student.userId], {
          category: 'MOTIVATION',
          title: `${streak.streakDays}-day streak: you earned a freeze`,
          body: 'A freeze keeps your streak alive if you miss one school day.',
          link: '/motivation',
          entityType: 'StudentPoints',
          entityId: studentId,
        });
    }
    return {
      granted,
      level,
      leveledUp,
      badges: earned,
      streakDays: streak?.streakDays ?? points.streakDays,
    };
  }

  private async giveBadge(
    studentId: string,
    code: string,
    awardedById: string | null,
    reason: string | null,
  ): Promise<PublicBadge | null> {
    const badge = await this.prisma.badge.findUnique({ where: { code } });
    if (!badge) return null;
    try {
      const row = await this.prisma.studentBadge.create({
        data: {
          id: newId(),
          studentId,
          badgeId: badge.id,
          awardedById,
          reason,
        },
        include: {
          badge: true,
          awardedBy: { select: { firstName: true, lastName: true } },
        },
      });
      const student = await this.prisma.student.findUnique({
        where: { id: studentId },
        select: { userId: true },
      });
      if (student?.userId)
        await this.notifications.notify([student.userId], {
          category: 'MOTIVATION',
          title: `New badge: ${badge.name} ${badge.icon}`,
          body: reason ?? badge.description,
          link: '/motivation',
          entityType: 'Badge',
          entityId: badge.id,
        });
      return this.toBadge(row);
    } catch (err) {
      if (isUnique(err)) return null;
      throw err;
    }
  }

  private async advanceQuests(
    studentId: string,
    organizationId: string,
    actions: LearningAction[],
  ): Promise<void> {
    const now = new Date();
    const classIds = (
      await this.prisma.classEnrollment.findMany({
        where: { studentId, status: { in: ['ENROLLED', 'COMPLETED'] } },
        select: { classId: true },
      })
    ).map((e) => e.classId);
    const quests = await this.prisma.quest.findMany({
      where: {
        organizationId,
        status: 'ACTIVE',
        startsAt: { lte: now },
        endsAt: { gt: now },
        OR: [{ studentId }, { classId: { in: classIds } }],
      },
      include: { progress: { where: { studentId } } },
    });
    for (const q of quests) {
      const inc = actions.reduce((s, a) => s + questIncrement(q.metric, a), 0);
      if (inc <= 0) continue;
      const prev = q.progress[0]?.count ?? 0;
      const next = prev + inc;
      await this.prisma.questProgress.upsert({
        where: { questId_studentId: { questId: q.id, studentId } },
        update: {
          count: next,
          ...(q.studentId && next >= q.goal && prev < q.goal
            ? { completedAt: now }
            : {}),
        },
        create: { id: newId(), questId: q.id, studentId, count: next },
      });
      if (q.studentId) {
        if (prev < q.goal && next >= q.goal)
          await this.completeQuest(q.id, [studentId], q.rewardXp, q.title);
      } else {
        const total = await this.prisma.questProgress.aggregate({
          _sum: { count: true },
          where: { questId: q.id },
        });
        if ((total._sum.count ?? 0) >= q.goal) {
          const members = await this.prisma.classEnrollment.findMany({
            where: { classId: q.classId ?? '', status: 'ENROLLED' },
            select: { studentId: true },
          });
          await this.completeQuest(
            q.id,
            members.map((m) => m.studentId),
            q.rewardXp,
            q.title,
          );
        }
      }
    }
  }

  /** Marks the quest done and shares its reward with everyone named; the reward itself never moves quests. */
  private async completeQuest(
    questId: string,
    studentIds: string[],
    rewardXp: number,
    title: string,
  ): Promise<void> {
    const updated = await this.prisma.quest.updateMany({
      where: { id: questId, status: 'ACTIVE' },
      data: { status: 'COMPLETED' },
    });
    if (updated.count === 0) return;
    for (const studentId of studentIds) {
      if (rewardXp > 0) {
        try {
          await this.prisma.rewardTransaction.create({
            data: {
              id: newId(),
              studentId,
              amount: rewardXp,
              reason: 'quest.completed',
              entityType: 'Quest',
              entityId: questId,
              note: title,
            },
          });
        } catch (err) {
          if (!isUnique(err)) throw err;
          continue;
        }
        const points = await this.ensurePoints(studentId);
        const xp = points.xp + rewardXp;
        const level = levelFor(xp);
        await this.prisma.studentPoints.update({
          where: { studentId },
          data: { xp, level, title: titleFor(level) },
        });
      }
      const student = await this.prisma.student.findUnique({
        where: { id: studentId },
        select: { userId: true },
      });
      if (student?.userId)
        await this.notifications.notify([student.userId], {
          category: 'MOTIVATION',
          title: `Quest complete: ${title}`,
          body: rewardXp > 0 ? `+${rewardXp} XP.` : 'Well done.',
          link: '/motivation',
          entityType: 'Quest',
          entityId: questId,
        });
    }
  }

  private async stats(
    studentId: string,
    points: { level: number; streakDays: number; longestStreak: number },
  ): Promise<BadgeStats> {
    const [lessonsCompleted, onTime, perfect, completions, grades] =
      await Promise.all([
        this.prisma.lessonCompletion.count({ where: { studentId } }),
        this.prisma.rewardTransaction.count({
          where: { studentId, reason: 'assignment.on_time' },
        }),
        this.prisma.rewardTransaction.count({
          where: { studentId, reason: 'score.perfect' },
        }),
        this.prisma.lessonCompletion.findMany({
          where: { studentId },
          select: { lesson: { select: { moduleId: true } } },
        }),
        this.prisma.grade.findMany({
          where: { studentId },
          orderBy: { gradedAt: 'asc' },
          select: { percentage: true },
          take: 50,
        }),
      ]);
    const perModule = new Map<string, number>();
    for (const c of completions)
      perModule.set(
        c.lesson.moduleId,
        (perModule.get(c.lesson.moduleId) ?? 0) + 1,
      );
    const modules = perModule.size
      ? await this.prisma.module.findMany({
          where: { id: { in: [...perModule.keys()] } },
          select: {
            id: true,
            _count: { select: { lessons: { where: { isPublished: true } } } },
          },
        })
      : [];
    const modulesCompleted = modules.filter(
      (m) =>
        m._count.lessons > 0 && (perModule.get(m.id) ?? 0) >= m._count.lessons,
    ).length;
    let improvedInARow = 0;
    for (let i = grades.length - 1; i > 0; i--) {
      if (Number(grades[i].percentage) > Number(grades[i - 1].percentage))
        improvedInARow += 1;
      else break;
    }
    return {
      lessonsCompleted,
      modulesCompleted,
      onTimeSubmissions: onTime,
      improvedInARow,
      perfectScores: perfect,
      streakDays: points.streakDays,
      longestStreak: points.longestStreak,
      level: points.level,
    };
  }

  // ---------------------------------------------------------------------------
  // Reads
  // ---------------------------------------------------------------------------

  async mine(actor: AuthenticatedUser): Promise<MotivationSummary> {
    if (actor.role !== 'STUDENT')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only students have their own motivation page; open a student to see theirs.',
      });
    const student = await this.prisma.student.findFirst({
      where: { userId: actor.id, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        organizationId: true,
      },
    });
    if (!student)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'No student record is linked to your account.',
      });
    return this.summary(student);
  }

  async forStudent(
    studentId: string,
    actor: AuthenticatedUser,
  ): Promise<MotivationSummary> {
    const student = await this.visibleStudent(studentId, actor);
    return this.summary(student);
  }

  private async summary(student: {
    id: string;
    firstName: string;
    lastName: string;
    organizationId: string;
  }): Promise<MotivationSummary> {
    const [org, points, badges, recent, todayXp] = await Promise.all([
      this.prisma.organization.findUnique({
        where: { id: student.organizationId },
        select: { motivationEnabled: true },
      }),
      this.ensurePoints(student.id),
      this.prisma.studentBadge.findMany({
        where: { studentId: student.id },
        include: {
          badge: true,
          awardedBy: { select: { firstName: true, lastName: true } },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.rewardTransaction.findMany({
        where: { studentId: student.id },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      this.prisma.rewardTransaction.aggregate({
        _sum: { amount: true },
        where: {
          studentId: student.id,
          createdAt: { gte: dayStart(isoDate(new Date())) },
        },
      }),
    ]);
    const today = isoDate(new Date());
    const state = this.streakState(points);
    const alive = streakAlive(state, today);
    return {
      enabled: org?.motivationEnabled ?? true,
      student: {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
      },
      xp: points.xp,
      level: points.level,
      title: points.title,
      levelStartXp: xpForLevel(points.level),
      nextLevelXp: xpForLevel(points.level + 1),
      todayXp: todayXp._sum.amount ?? 0,
      streak: {
        days: alive ? points.streakDays : 0,
        longest: points.longestStreak,
        alive,
        freezeTokens: points.freezeTokens,
        lastActionOn: state.lastActionOn,
      },
      badges: badges.map((b) => this.toBadge(b)),
      quests: await this.questsFor(student.id, student.organizationId),
      recent: recent.map((r) => ({
        id: r.id,
        reason: r.reason,
        amount: r.amount,
        note: r.note,
        entityType: r.entityType,
        createdAt: r.createdAt,
      })),
    };
  }

  private async questsFor(
    studentId: string,
    organizationId: string,
  ): Promise<PublicQuest[]> {
    const now = new Date();
    const since = new Date(now.getTime() - 7 * 86_400_000);
    const classIds = (
      await this.prisma.classEnrollment.findMany({
        where: { studentId, status: { in: ['ENROLLED', 'COMPLETED'] } },
        select: { classId: true },
      })
    ).map((e) => e.classId);
    const quests = await this.prisma.quest.findMany({
      where: {
        organizationId,
        OR: [{ studentId }, { classId: { in: classIds } }],
        AND: [
          {
            OR: [
              { status: 'ACTIVE', endsAt: { gt: now } },
              { status: 'COMPLETED', updatedAt: { gte: since } },
            ],
          },
        ],
      },
      include: {
        progress: { where: { studentId } },
        class: { select: { name: true } },
      },
      orderBy: [{ status: 'asc' }, { endsAt: 'asc' }],
    });
    const totals = await this.classTotals(
      quests.filter((q) => q.classId).map((q) => q.id),
    );
    return quests.map((q) =>
      this.toQuest(q, q.progress[0]?.count ?? 0, totals),
    );
  }

  private async classTotals(questIds: string[]): Promise<Map<string, number>> {
    if (questIds.length === 0) return new Map();
    const rows = await this.prisma.questProgress.groupBy({
      by: ['questId'],
      _sum: { count: true },
      where: { questId: { in: questIds } },
    });
    return new Map(rows.map((r) => [r.questId, r._sum.count ?? 0]));
  }

  async classConsole(classId: string, actor: AuthenticatedUser) {
    const klass = await this.manageableClass(classId, actor);
    const enrollments = await this.prisma.classEnrollment.findMany({
      where: { classId, status: 'ENROLLED' },
      include: {
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            points: true,
            _count: { select: { badges: true } },
          },
        },
      },
      orderBy: [
        { student: { lastName: 'asc' } },
        { student: { firstName: 'asc' } },
      ],
    });
    const today = isoDate(new Date());
    const onTime = await this.prisma.rewardTransaction.groupBy({
      by: ['studentId'],
      _count: { _all: true },
      where: {
        studentId: { in: enrollments.map((e) => e.studentId) },
        reason: 'assignment.on_time',
      },
    });
    const onTimeBy = new Map(onTime.map((r) => [r.studentId, r._count._all]));
    const students = enrollments.map((e) => {
      const p = e.student.points;
      const state: StreakState = p
        ? this.streakState(p)
        : {
            streakDays: 0,
            longestStreak: 0,
            lastActionOn: null,
            freezeTokens: 0,
            freezesUsed: 0,
          };
      const alive = streakAlive(state, today);
      const xp = p?.xp ?? 0;
      const level = p?.level ?? 1;
      const toNext = xpForLevel(level + 1) - xp;
      return {
        id: e.student.id,
        firstName: e.student.firstName,
        lastName: e.student.lastName,
        xp,
        level,
        title: p?.title ?? 'newcomer',
        streakDays: alive ? state.streakDays : 0,
        longestStreak: state.longestStreak,
        freezeTokens: state.freezeTokens,
        lastActionOn: state.lastActionOn,
        badges: e.student._count.badges,
        onTimeSubmissions: onTimeBy.get(e.student.id) ?? 0,
        nearMilestone:
          toNext <= 30 || (alive && state.streakDays % 5 === 4) || false,
      };
    });
    const quests = await this.prisma.quest.findMany({
      where: { classId, status: { in: ['ACTIVE', 'COMPLETED'] } },
      orderBy: [{ status: 'asc' }, { endsAt: 'desc' }],
      take: 20,
    });
    const totals = await this.classTotals(quests.map((q) => q.id));
    const participants = quests.length
      ? await this.prisma.questProgress.groupBy({
          by: ['questId'],
          _count: { _all: true },
          where: { questId: { in: quests.map((q) => q.id) }, count: { gt: 0 } },
        })
      : [];
    const participantsBy = new Map(
      participants.map((r) => [r.questId, r._count._all]),
    );
    return {
      class: { id: klass.id, name: klass.name },
      enabled: klass.organization.motivationEnabled,
      students,
      streaks: {
        active: students.filter((s) => s.streakDays > 0).length,
        total: students.length,
      },
      quests: quests.map((q) => ({
        ...this.toQuest({ ...q, class: { name: klass.name } }, 0, totals),
        participants: participantsBy.get(q.id) ?? 0,
      })),
      badges: BADGES.filter((b) => b.teacherAwarded),
    };
  }

  async classQuests(
    classId: string,
    actor: AuthenticatedUser,
  ): Promise<PublicQuest[]> {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      include: { teachers: { select: { teacherId: true } } },
    });
    if (!klass)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    let studentId: string | null = null;
    if (actor.role === 'STUDENT' || actor.role === 'PARENT') {
      const member = await this.prisma.classEnrollment.findFirst({
        where: {
          classId,
          status: { in: ['ENROLLED', 'COMPLETED'] },
          student:
            actor.role === 'STUDENT'
              ? { userId: actor.id }
              : { guardians: { some: { guardianUserId: actor.id } } },
        },
        select: { studentId: true },
      });
      if (!member)
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'Not available for your account.',
        });
      studentId = member.studentId;
    } else {
      assertOrganizationAccess(actor, klass.organizationId);
    }
    const now = new Date();
    const quests = await this.prisma.quest.findMany({
      where: {
        classId,
        OR: [
          { status: 'ACTIVE', endsAt: { gt: now } },
          {
            status: 'COMPLETED',
            updatedAt: { gte: new Date(now.getTime() - 7 * 86_400_000) },
          },
        ],
      },
      include: {
        progress: studentId ? { where: { studentId } } : false,
      },
      orderBy: [{ status: 'asc' }, { endsAt: 'asc' }],
    });
    const totals = await this.classTotals(quests.map((q) => q.id));
    return quests.map((q) =>
      this.toQuest(
        { ...q, class: { name: klass.name } },
        Array.isArray(q.progress) ? (q.progress[0]?.count ?? 0) : 0,
        totals,
      ),
    );
  }

  async createClassQuest(
    classId: string,
    dto: CreateQuestDto,
    actor: AuthenticatedUser,
  ): Promise<PublicQuest> {
    const klass = await this.manageableClass(classId, actor);
    const now = new Date();
    const endsAt = dto.endsAt ? new Date(dto.endsAt) : weekWindow(now).endsAt;
    if (endsAt.getTime() <= now.getTime())
      throw new ForbiddenException({
        code: 'validation.failed',
        detail: 'The quest must end in the future.',
      });
    const q = await this.prisma.quest.create({
      data: {
        id: newId(),
        organizationId: klass.organizationId,
        classId,
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        metric: dto.metric,
        goal: dto.goal,
        rewardXp: dto.rewardXp ?? 30,
        startsAt: now,
        endsAt,
        createdById: actor.id,
      },
    });
    return this.toQuest({ ...q, class: { name: klass.name } }, 0, new Map());
  }

  async removeQuest(id: string, actor: AuthenticatedUser): Promise<void> {
    const q = await this.prisma.quest.findUnique({ where: { id } });
    if (!q || !q.classId)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Quest not found.',
      });
    await this.manageableClass(q.classId, actor);
    await this.prisma.quest.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------
  // Lessons and progress maps
  // ---------------------------------------------------------------------------

  async completeLesson(lessonId: string, actor: AuthenticatedUser) {
    if (actor.role !== 'STUDENT')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Students mark their own lessons finished.',
      });
    const student = await this.prisma.student.findFirst({
      where: { userId: actor.id, deletedAt: null },
      select: { id: true, organizationId: true },
    });
    if (!student)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'No student record is linked to your account.',
      });
    const lesson = await this.prisma.lesson.findFirst({
      where: {
        id: lessonId,
        isPublished: true,
        module: { isPublished: true, course: { isPublished: true } },
      },
      select: {
        id: true,
        title: true,
        module: { select: { courseId: true } },
      },
    });
    if (!lesson)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Lesson not found.',
      });
    const existing = await this.prisma.lessonCompletion.findUnique({
      where: { studentId_lessonId: { studentId: student.id, lessonId } },
    });
    if (existing)
      return { completed: true, alreadyCompleted: true, reward: null };
    await this.prisma.lessonCompletion.create({
      data: { id: newId(), studentId: student.id, lessonId },
    });
    const reward = await this.recordAction(
      student.id,
      student.organizationId,
      { kind: 'lesson' },
      [
        {
          reason: 'lesson.completed',
          amount: XP.LESSON_COMPLETED,
          entityType: 'Lesson',
          entityId: lessonId,
        },
      ],
    );
    this.events.emit(
      'lesson.completed',
      domainEvent({
        eventType: 'lesson.completed',
        entityType: 'Lesson',
        entityId: lessonId,
        organizationId: student.organizationId,
        actorId: actor.id,
        data: {
          lessonId,
          studentId: student.id,
          courseId: lesson.module.courseId,
        },
      }),
    );
    return { completed: true, alreadyCompleted: false, reward };
  }

  async progress(
    courseId: string,
    actor: AuthenticatedUser,
    studentId?: string,
  ) {
    let student: { id: string; firstName: string; lastName: string };
    if (actor.role === 'STUDENT') {
      const own = await this.prisma.student.findFirst({
        where: { userId: actor.id, deletedAt: null },
        select: { id: true, firstName: true, lastName: true },
      });
      if (!own)
        throw new NotFoundException({
          code: 'resource.not_found',
          detail: 'No student record is linked to your account.',
        });
      student = own;
    } else {
      if (!studentId)
        throw new ForbiddenException({
          code: 'validation.failed',
          detail: 'studentId is required to see a student’s progress.',
        });
      student = await this.visibleStudent(studentId, actor);
    }
    const staff = actor.role !== 'STUDENT' && actor.role !== 'PARENT';
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: {
        id: true,
        title: true,
        modules: {
          where: staff ? {} : { isPublished: true },
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            title: true,
            lessons: {
              where: staff ? {} : { isPublished: true },
              orderBy: { sortOrder: 'asc' },
              select: { id: true, title: true, isPublished: true },
            },
          },
        },
      },
    });
    if (!course)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Course not found.',
      });
    const done = new Map(
      (
        await this.prisma.lessonCompletion.findMany({
          where: {
            studentId: student.id,
            lesson: { module: { courseId } },
          },
          select: { lessonId: true, completedAt: true },
        })
      ).map((c) => [c.lessonId, c.completedAt]),
    );
    let nextLessonId: string | null = null;
    const modules = course.modules.map((m) => {
      const lessons = m.lessons.map((l) => {
        const completedAt = done.get(l.id) ?? null;
        if (!completedAt && !nextLessonId && l.isPublished) nextLessonId = l.id;
        return {
          id: l.id,
          title: l.title,
          completed: !!completedAt,
          completedAt,
        };
      });
      return {
        id: m.id,
        title: m.title,
        total: lessons.length,
        completed: lessons.filter((l) => l.completed).length,
        lessons,
      };
    });
    const totalLessons = modules.reduce((s, m) => s + m.total, 0);
    const completedLessons = modules.reduce((s, m) => s + m.completed, 0);
    return {
      course: { id: course.id, title: course.title },
      student,
      modules,
      totalLessons,
      completedLessons,
      percent: totalLessons
        ? Math.round((completedLessons / totalLessons) * 100)
        : 0,
      nextLessonId,
    };
  }

  // ---------------------------------------------------------------------------
  // Teacher awards and settings
  // ---------------------------------------------------------------------------

  async award(studentId: string, dto: AwardDto, actor: AuthenticatedUser) {
    const student = await this.visibleStudent(studentId, actor);
    if (dto.kind === 'badge') {
      const def = BADGES.find((b) => b.code === dto.badgeCode);
      if (!def || !def.teacherAwarded)
        throw new ForbiddenException({
          code: 'validation.failed',
          detail:
            'Only kindness, helper and leader badges are teacher-awarded.',
        });
      const badge = await this.giveBadge(
        studentId,
        def.code,
        actor.id,
        dto.reason.trim(),
      );
      if (!badge)
        throw new ForbiddenException({
          code: 'motivation.already_awarded',
          detail: `${student.firstName} already has that badge.`,
        });
      return { kind: 'badge' as const, badge, reward: null };
    }
    const reward = await this.recordAction(
      studentId,
      student.organizationId,
      { kind: 'xp', amount: dto.amount ?? 0 },
      [
        {
          reason: 'teacher.award',
          amount: dto.amount ?? 0,
          entityType: 'User',
          entityId: newId(),
          note: dto.reason.trim(),
          awardedById: actor.id,
        },
      ],
    );
    const user = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { userId: true },
    });
    if (user?.userId && reward && reward.granted > 0)
      await this.notifications.notify([user.userId], {
        category: 'MOTIVATION',
        title: `+${reward.granted} XP from your teacher`,
        body: dto.reason.trim(),
        link: '/motivation',
        entityType: 'StudentPoints',
        entityId: studentId,
      });
    return { kind: 'xp' as const, badge: null, reward };
  }

  async settings(organizationId: string, actor: AuthenticatedUser) {
    if (actor.role === 'STUDENT' || actor.role === 'PARENT') {
      if (actor.organizationId !== organizationId)
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'Not available for your account.',
        });
    } else assertOrganizationAccess(actor, organizationId);
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { motivationEnabled: true },
    });
    if (!org)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Organisation not found.',
      });
    return { motivationEnabled: org.motivationEnabled };
  }

  async updateSettings(
    organizationId: string,
    dto: MotivationSettingsDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    const org = await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        ...(dto.motivationEnabled !== undefined
          ? { motivationEnabled: dto.motivationEnabled }
          : {}),
      },
      select: { motivationEnabled: true },
    });
    return { motivationEnabled: org.motivationEnabled };
  }

  // ---------------------------------------------------------------------------
  // Jobs
  // ---------------------------------------------------------------------------

  /** Monday 06:00: a few personal quests per student, built from what they actually have ahead. */
  @Cron('0 6 * * 1')
  async generateWeeklyQuests(): Promise<number> {
    const now = new Date();
    const window = weekWindow(now);
    const students = await this.prisma.student.findMany({
      where: {
        deletedAt: null,
        enrollmentStatus: 'ACTIVE',
        userId: { not: null },
        organization: { motivationEnabled: true },
      },
      select: { id: true, organizationId: true },
    });
    let created = 0;
    for (const s of students) {
      try {
        const existing = await this.prisma.quest.count({
          where: { studentId: s.id, auto: true, startsAt: window.startsAt },
        });
        if (existing > 0) continue;
        const classes = await this.prisma.classEnrollment.findMany({
          where: { studentId: s.id, status: 'ENROLLED' },
          select: { classId: true, class: { select: { courseId: true } } },
        });
        const courseIds = classes.map((c) => c.class.courseId);
        const classIds = classes.map((c) => c.classId);
        const [lessons, completed, due] = await Promise.all([
          this.prisma.lesson.count({
            where: {
              isPublished: true,
              module: {
                isPublished: true,
                course: { id: { in: courseIds }, isPublished: true },
              },
            },
          }),
          this.prisma.lessonCompletion.count({
            where: {
              studentId: s.id,
              lesson: { module: { courseId: { in: courseIds } } },
            },
          }),
          this.prisma.assignment.count({
            where: {
              classId: { in: classIds },
              status: 'PUBLISHED',
              deletedAt: null,
              dueAt: { gte: window.startsAt, lt: window.endsAt },
            },
          }),
        ]);
        const defs = weeklyQuests({
          lessonsAvailable: Math.max(0, lessons - completed),
          assignmentsDueThisWeek: due,
        });
        for (const d of defs) {
          await this.prisma.quest.create({
            data: {
              id: newId(),
              organizationId: s.organizationId,
              studentId: s.id,
              title:
                d.key === 'lessons'
                  ? `Finish ${d.goal} lesson${d.goal === 1 ? '' : 's'} this week`
                  : d.key === 'on_time'
                    ? `Turn in ${d.goal} assignment${d.goal === 1 ? '' : 's'} on time`
                    : `Earn ${d.goal} XP this week`,
              metric: d.metric,
              goal: d.goal,
              rewardXp: d.rewardXp,
              startsAt: window.startsAt,
              endsAt: window.endsAt,
              auto: true,
            },
          });
          created += 1;
        }
      } catch (err) {
        this.logger.warn(
          `Weekly quests failed for student ${s.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    if (created) this.logger.log(`Weekly quests: ${created} created`);
    return created;
  }

  /** Just after midnight: quests past their end date stop moving. */
  @Cron('10 0 * * *')
  async expireQuests(): Promise<number> {
    const r = await this.prisma.quest.updateMany({
      where: { status: 'ACTIVE', endsAt: { lte: new Date() } },
      data: { status: 'EXPIRED' },
    });
    return r.count;
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async ensurePoints(studentId: string) {
    return this.prisma.studentPoints.upsert({
      where: { studentId },
      update: {},
      create: { id: newId(), studentId },
    });
  }

  private streakState(p: {
    streakDays: number;
    longestStreak: number;
    lastActionOn: Date | null;
    freezeTokens: number;
    freezesUsed: number;
  }): StreakState {
    return {
      streakDays: p.streakDays,
      longestStreak: p.longestStreak,
      lastActionOn: p.lastActionOn ? isoDate(p.lastActionOn) : null,
      freezeTokens: p.freezeTokens,
      freezesUsed: p.freezesUsed,
    };
  }

  private toBadge(row: {
    createdAt: Date;
    reason: string | null;
    badge: {
      code: string;
      name: string;
      description: string;
      category: string;
      tier: number;
      icon: string;
      teacherAwarded: boolean;
    };
    awardedBy: { firstName: string; lastName: string } | null;
  }): PublicBadge {
    return {
      code: row.badge.code,
      name: row.badge.name,
      description: row.badge.description,
      category: row.badge.category,
      tier: row.badge.tier,
      icon: row.badge.icon,
      teacherAwarded: row.badge.teacherAwarded,
      earnedAt: row.createdAt,
      reason: row.reason,
      awardedBy: row.awardedBy,
    };
  }

  private toQuest(
    q: {
      id: string;
      title: string;
      description: string | null;
      metric: string;
      goal: number;
      rewardXp: number;
      startsAt: Date;
      endsAt: Date;
      status: string;
      auto: boolean;
      classId: string | null;
      studentId: string | null;
      class?: { name: string } | null;
    },
    progress: number,
    totals: Map<string, number>,
  ): PublicQuest {
    return {
      id: q.id,
      title: q.title,
      description: q.description,
      metric: q.metric,
      goal: q.goal,
      rewardXp: q.rewardXp,
      startsAt: q.startsAt,
      endsAt: q.endsAt,
      status: q.status.toLowerCase() as PublicQuest['status'],
      kind: q.classId ? 'class' : 'personal',
      auto: q.auto,
      classId: q.classId,
      className: q.class?.name ?? null,
      progress,
      classTotal: q.classId ? (totals.get(q.id) ?? 0) : null,
    };
  }

  /** The student themself, their guardians, their teachers, counselors and administrators of the school. */
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
          detail: "Only this student's teachers see their progress.",
        });
    }
    return student;
  }

  private async manageableClass(classId: string, actor: AuthenticatedUser) {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      include: {
        teachers: { select: { teacherId: true } },
        organization: { select: { motivationEnabled: true } },
      },
    });
    if (!klass)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    if (!canManage(klass, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only the class teachers and administrators manage motivation.',
      });
    return klass;
  }
}
