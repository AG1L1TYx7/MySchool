import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import { assertOrganizationAccess, isDistrictRole } from '../access/scope';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canManage } from '../classes/classes.service';
import { parseLevels } from '../gradebook/gradebook-rules';
import { MotivationService } from '../motivation/motivation.service';
import { XP } from '../motivation/motivation-rules';
import {
  CreateCardDto,
  ExportQuery,
  ReviewCardDto,
  StatementsQuery,
} from './dto/learning.dto';
import {
  buildStatement,
  cardsFromDialogcards,
  EVIDENCE_WEIGHT,
  isMastered,
  isStruggling,
  isoDay,
  learningCurve,
  masteryBand,
  masteryFrom,
  retentionRate,
  schedule,
  verbsForResult,
  type Evidence,
  type StatementInput,
} from './learning-rules';

export interface PublicCard {
  id: string;
  front: string;
  back: string;
  hint: string | null;
  sourceType: string;
  sourceId: string | null;
  easiness: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  dueOn: string;
  lastReviewedAt: Date | null;
  suspended: boolean;
  status: 'new' | 'learning' | 'mastered' | 'struggling';
}

/** Reviews in one day that earn the practice XP once. */
const PRACTICE_SESSION_REVIEWS = 10;

/**
 * Learning records and learning science (docs/02 sections 24 and 25): xAPI statements for everything a student
 * does, SM-2 practice cards, mastery per standard from the evidence the school already has, and learning curves.
 * Students see their own; families, the student's teachers, counselors and administrators see a student's; teachers
 * see their class as a whole. Nothing ranks students.
 */
@Injectable()
export class LearningService {
  private readonly logger = new Logger(LearningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly motivation: MotivationService,
  ) {}

  // ---------------------------------------------------------------------------
  // Event hooks
  // ---------------------------------------------------------------------------

  async onH5pResult(input: {
    resultId: string;
    contentId: string;
    studentId: string | null;
    assignmentId: string | null;
    score: number;
    maxScore: number;
    completed: boolean;
    timeSpentSeconds: number | null;
    actorUserId: string;
    organizationId: string | null;
  }): Promise<void> {
    const content = await this.prisma.h5PContent.findUnique({
      where: { id: input.contentId },
      select: { title: true, organizationId: true },
    });
    const actor = await this.prisma.user.findUnique({
      where: { id: input.actorUserId },
      select: { firstName: true, lastName: true },
    });
    if (!content || !actor) return;
    const assignment = input.assignmentId
      ? await this.prisma.assignment.findUnique({
          where: { id: input.assignmentId },
          select: { classId: true },
        })
      : null;
    for (const verb of verbsForResult(
      input.score,
      input.maxScore,
      input.completed,
    )) {
      await this.store({
        organizationId: content.organizationId,
        actorUserId: input.actorUserId,
        studentId: input.studentId,
        input: {
          verb,
          actor: {
            userId: input.actorUserId,
            name: `${actor.firstName} ${actor.lastName}`,
          },
          object: {
            type: 'h5p-content',
            id: input.contentId,
            name: content.title,
          },
          result: {
            raw: input.score,
            max: input.maxScore,
            completion: input.completed,
            ...(verb === 'passed' || verb === 'failed'
              ? { success: verb === 'passed' }
              : {}),
            ...(input.timeSpentSeconds !== null
              ? { durationSeconds: input.timeSpentSeconds }
              : {}),
          },
          context: {
            classId: assignment?.classId ?? null,
            parentId: input.assignmentId,
            registration: input.resultId,
          },
        },
      });
    }
    if (input.studentId) {
      if (input.assignmentId)
        await this.recomputeForAssignment(input.studentId, input.assignmentId);
      if (input.completed)
        await this.motivation.recordAction(
          input.studentId,
          input.organizationId,
          { kind: 'practice' },
          [
            {
              reason: 'practice.completed',
              amount: XP.PRACTICE,
              entityType: 'H5PContent',
              entityId: input.contentId,
            },
          ],
        );
    }
  }

  async onLessonCompleted(
    studentId: string,
    lessonId: string,
    actorUserId: string,
    organizationId: string | null,
  ): Promise<void> {
    const [lesson, actor] = await Promise.all([
      this.prisma.lesson.findUnique({
        where: { id: lessonId },
        select: {
          title: true,
          module: { select: { course: { select: { organizationId: true } } } },
          standards: { select: { standardId: true } },
        },
      }),
      this.prisma.user.findUnique({
        where: { id: actorUserId },
        select: { firstName: true, lastName: true },
      }),
    ]);
    if (!lesson || !actor) return;
    await this.store({
      organizationId: organizationId ?? lesson.module.course.organizationId,
      actorUserId,
      studentId,
      input: {
        verb: 'completed',
        actor: {
          userId: actorUserId,
          name: `${actor.firstName} ${actor.lastName}`,
        },
        object: { type: 'lesson', id: lessonId, name: lesson.title },
        result: { completion: true },
      },
    });
    if (lesson.standards.length)
      await this.recompute(
        studentId,
        lesson.standards.map((s) => s.standardId),
      );
  }

  async onSubmitted(
    studentId: string,
    assignmentId: string,
    attemptNumber: number,
    actorUserId: string,
    organizationId: string | null,
  ): Promise<void> {
    const [assignment, actor] = await Promise.all([
      this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { title: true, classId: true, organizationId: true },
      }),
      this.prisma.user.findUnique({
        where: { id: actorUserId },
        select: { firstName: true, lastName: true },
      }),
    ]);
    if (!assignment || !actor) return;
    await this.store({
      organizationId: organizationId ?? assignment.organizationId,
      actorUserId,
      studentId,
      input: {
        verb: 'completed',
        actor: {
          userId: actorUserId,
          name: `${actor.firstName} ${actor.lastName}`,
        },
        object: {
          type: 'assignment',
          id: assignmentId,
          name: assignment.title,
        },
        result: { completion: true, response: `attempt ${attemptNumber}` },
        context: { classId: assignment.classId },
      },
    });
  }

  async onGraded(
    studentId: string,
    assignmentId: string,
    score: number,
    maxPoints: number,
    actorUserId: string,
    organizationId: string | null,
  ): Promise<void> {
    const [assignment, student] = await Promise.all([
      this.prisma.assignment.findUnique({
        where: { id: assignmentId },
        select: { title: true, classId: true, organizationId: true },
      }),
      this.prisma.student.findUnique({
        where: { id: studentId },
        select: { userId: true, firstName: true, lastName: true },
      }),
    ]);
    if (!assignment || !student) return;
    const passed = maxPoints > 0 && score / maxPoints >= 0.6;
    await this.store({
      organizationId: organizationId ?? assignment.organizationId,
      actorUserId: student.userId ?? actorUserId,
      studentId,
      input: {
        verb: passed ? 'passed' : 'failed',
        actor: {
          userId: student.userId ?? actorUserId,
          name: `${student.firstName} ${student.lastName}`,
        },
        object: {
          type: 'assignment',
          id: assignmentId,
          name: assignment.title,
        },
        result: {
          raw: score,
          max: maxPoints,
          success: passed,
          completion: true,
        },
        context: { classId: assignment.classId },
      },
    });
    await this.recomputeForAssignment(studentId, assignmentId);
  }

  private async store(args: {
    organizationId: string;
    actorUserId: string;
    studentId: string | null;
    input: StatementInput;
  }): Promise<void> {
    const built = buildStatement(args.input);
    await this.prisma.xapiStatement.create({
      data: {
        id: newId(),
        organizationId: args.organizationId,
        actorUserId: args.actorUserId,
        studentId: args.studentId,
        verb: built.verb,
        objectType: args.input.object.type,
        objectId: args.input.object.id,
        objectName: args.input.object.name.slice(0, 200),
        resultScaled: built.resultScaled,
        resultRaw: built.resultRaw,
        resultMax: built.resultMax,
        resultSuccess: built.resultSuccess,
        resultCompletion: built.resultCompletion,
        durationSeconds: built.durationSeconds,
        contextClassId: args.input.context?.classId ?? null,
        contextParentId: args.input.context?.parentId ?? null,
        registration: args.input.context?.registration ?? null,
        statement: JSON.stringify(built.statement),
        timestamp: built.timestamp,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Records: timelines, analytics, query and export
  // ---------------------------------------------------------------------------

  async timeline(studentId: string, actor: AuthenticatedUser, limit = 50) {
    await this.visibleStudent(studentId, actor);
    const rows = await this.prisma.xapiStatement.findMany({
      where: { studentId, voidedAt: null },
      orderBy: { timestamp: 'desc' },
      take: Math.min(200, limit),
    });
    return rows.map((r) => this.toRecord(r));
  }

  async contentAnalytics(contentId: string, actor: AuthenticatedUser) {
    const content = await this.prisma.h5PContent.findFirst({
      where: { id: contentId, deletedAt: null },
      select: { id: true, title: true, organizationId: true },
    });
    if (!content)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Content not found.',
      });
    assertOrganizationAccess(actor, content.organizationId);
    const rows = await this.prisma.xapiStatement.findMany({
      where: {
        objectType: 'h5p-content',
        objectId: contentId,
        voidedAt: null,
        verb: { in: ['completed', 'passed', 'failed', 'attempted'] },
      },
      select: {
        verb: true,
        resultScaled: true,
        durationSeconds: true,
        studentId: true,
        timestamp: true,
      },
    });
    const attempts = rows.filter(
      (r) => r.verb === 'completed' || r.verb === 'attempted',
    ).length;
    const completed = rows.filter((r) => r.verb === 'completed').length;
    const passed = rows.filter((r) => r.verb === 'passed').length;
    const failed = rows.filter((r) => r.verb === 'failed').length;
    const scores = rows
      .filter((r) => r.verb === 'completed' && r.resultScaled !== null)
      .map((r) => Number(r.resultScaled));
    const times = rows
      .filter((r) => r.verb === 'completed' && r.durationSeconds !== null)
      .map((r) => r.durationSeconds as number);
    return {
      content: { id: content.id, title: content.title },
      attempts,
      completed,
      completionRate: attempts
        ? Math.round((completed / attempts) * 100)
        : null,
      passRate:
        passed + failed ? Math.round((passed / (passed + failed)) * 100) : null,
      averageScaled: scores.length
        ? Math.round(
            (scores.reduce((s, x) => s + x, 0) / scores.length) * 1000,
          ) / 1000
        : null,
      averageSeconds: times.length
        ? Math.round(times.reduce((s, x) => s + x, 0) / times.length)
        : null,
      students: new Set(rows.map((r) => r.studentId).filter(Boolean)).size,
      lastAt: rows.length
        ? rows
            .map((r) => r.timestamp)
            .sort((a, b) => b.getTime() - a.getTime())[0]
        : null,
    };
  }

  async statements(q: StatementsQuery, actor: AuthenticatedUser) {
    const organizationId = isDistrictRole(actor)
      ? undefined
      : (actor.organizationId ?? '');
    if (q.studentId) await this.visibleStudent(q.studentId, actor);
    const rows = await this.prisma.xapiStatement.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        ...(q.studentId ? { studentId: q.studentId } : {}),
        ...(q.objectId ? { objectId: q.objectId } : {}),
        ...(q.objectType ? { objectType: q.objectType } : {}),
        ...(q.verb ? { verb: q.verb } : {}),
        ...(q.since || q.until
          ? {
              timestamp: {
                ...(q.since ? { gte: new Date(q.since) } : {}),
                ...(q.until ? { lte: new Date(q.until) } : {}),
              },
            }
          : {}),
        voidedAt: null,
      },
      orderBy: { timestamp: 'desc' },
      take: q.limit ?? 50,
    });
    return rows.map((r) => this.toRecord(r));
  }

  /** Full statements for an external learning record store, oldest first, by stored time so a sync can resume. */
  async exportStatements(
    organizationId: string,
    q: ExportQuery,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    const rows = await this.prisma.xapiStatement.findMany({
      where: {
        organizationId,
        voidedAt: null,
        ...(q.since ? { storedAt: { gt: new Date(q.since) } } : {}),
      },
      orderBy: { storedAt: 'asc' },
      take: q.limit ?? 1000,
      select: { id: true, storedAt: true, statement: true },
    });
    return {
      data: rows.map((r) => ({
        id: r.id,
        stored: r.storedAt,
        ...(JSON.parse(r.statement) as Record<string, unknown>),
      })),
      next: rows.length ? rows[rows.length - 1].storedAt : null,
    };
  }

  private toRecord(r: {
    id: string;
    verb: string;
    objectType: string;
    objectId: string;
    objectName: string;
    resultScaled: unknown;
    resultRaw: unknown;
    resultMax: unknown;
    resultSuccess: boolean | null;
    resultCompletion: boolean | null;
    durationSeconds: number | null;
    contextClassId: string | null;
    timestamp: Date;
  }) {
    return {
      id: r.id,
      verb: r.verb,
      objectType: r.objectType,
      objectId: r.objectId,
      objectName: r.objectName,
      scaled: r.resultScaled === null ? null : Number(r.resultScaled),
      raw: r.resultRaw === null ? null : Number(r.resultRaw),
      max: r.resultMax === null ? null : Number(r.resultMax),
      success: r.resultSuccess,
      completion: r.resultCompletion,
      durationSeconds: r.durationSeconds,
      classId: r.contextClassId,
      timestamp: r.timestamp,
    };
  }

  // ---------------------------------------------------------------------------
  // Practice cards (SM-2)
  // ---------------------------------------------------------------------------

  async createCard(
    dto: CreateCardDto,
    actor: AuthenticatedUser,
  ): Promise<PublicCard> {
    const student = await this.ownStudent(actor);
    const row = await this.prisma.srsCard.create({
      data: {
        id: newId(),
        organizationId: student.organizationId,
        studentId: student.id,
        sourceType: 'manual',
        front: dto.front.trim(),
        back: dto.back.trim(),
        hint: dto.hint?.trim() || null,
        dueOn: new Date(`${isoDay(new Date())}T00:00:00Z`),
      },
    });
    return this.toCard(row);
  }

  /** Every card of a Dialogcards set the student can play, skipping ones they already have. */
  async cardsFromContent(contentId: string, actor: AuthenticatedUser) {
    const student = await this.ownStudent(actor);
    const content = await this.prisma.h5PContent.findFirst({
      where: { id: contentId, deletedAt: null, status: 'PUBLISHED' },
      select: {
        library: true,
        parameters: true,
        organizationId: true,
        title: true,
      },
    });
    if (!content || content.organizationId !== student.organizationId)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Content not found.',
      });
    if (!content.library.startsWith('H5P.Dialogcards'))
      throw new ForbiddenException({
        code: 'learning.not_flashcards',
        detail: 'Only flashcard sets become practice cards.',
      });
    const cards = cardsFromDialogcards(JSON.parse(content.parameters));
    const existing = await this.prisma.srsCard.findMany({
      where: {
        studentId: student.id,
        sourceType: 'h5p-flashcards',
        sourceId: contentId,
      },
      select: { front: true },
    });
    const have = new Set(existing.map((e) => e.front));
    const today = new Date(`${isoDay(new Date())}T00:00:00Z`);
    let created = 0;
    for (const c of cards) {
      if (have.has(c.front)) continue;
      await this.prisma.srsCard.create({
        data: {
          id: newId(),
          organizationId: student.organizationId,
          studentId: student.id,
          sourceType: 'h5p-flashcards',
          sourceId: contentId,
          front: c.front,
          back: c.back,
          hint: c.hint,
          dueOn: today,
        },
      });
      created += 1;
    }
    return { created, skipped: cards.length - created, title: content.title };
  }

  async cards(
    actor: AuthenticatedUser,
    status?: string,
  ): Promise<PublicCard[]> {
    const student = await this.ownStudent(actor);
    const rows = await this.prisma.srsCard.findMany({
      where: { studentId: student.id },
      orderBy: [{ dueOn: 'asc' }, { createdAt: 'asc' }],
      take: 500,
    });
    const all = rows.map((r) => this.toCard(r));
    return status ? all.filter((c) => c.status === status) : all;
  }

  /** Due cards first (oldest due), then new ones, up to the limit. */
  async queue(
    actor: AuthenticatedUser,
    limit = 20,
  ): Promise<{
    data: PublicCard[];
    due: number;
    newCards: number;
    reviewedToday: number;
  }> {
    const student = await this.ownStudent(actor);
    const today = isoDay(new Date());
    const todayStart = new Date(`${today}T00:00:00Z`);
    const [due, fresh, reviewedToday] = await Promise.all([
      this.prisma.srsCard.findMany({
        where: {
          studentId: student.id,
          suspended: false,
          dueOn: { lte: todayStart },
          repetitions: { gt: 0 },
        },
        orderBy: { dueOn: 'asc' },
        take: limit,
      }),
      this.prisma.srsCard.findMany({
        where: {
          studentId: student.id,
          suspended: false,
          repetitions: 0,
          dueOn: { lte: todayStart },
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
      }),
      this.prisma.srsReview.count({
        where: { studentId: student.id, reviewedAt: { gte: todayStart } },
      }),
    ]);
    const data = [...due, ...fresh].slice(0, limit).map((r) => this.toCard(r));
    return { data, due: due.length, newCards: fresh.length, reviewedToday };
  }

  async review(cardId: string, dto: ReviewCardDto, actor: AuthenticatedUser) {
    const student = await this.ownStudent(actor);
    const card = await this.prisma.srsCard.findFirst({
      where: { id: cardId, studentId: student.id },
    });
    if (!card)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Card not found.',
      });
    const today = isoDay(new Date());
    const next = schedule(
      {
        easiness: Number(card.easiness),
        intervalDays: card.intervalDays,
        repetitions: card.repetitions,
        lapses: card.lapses,
      },
      dto.quality,
      today,
    );
    const [updated] = await this.prisma.$transaction([
      this.prisma.srsCard.update({
        where: { id: card.id },
        data: {
          easiness: next.easiness,
          intervalDays: next.intervalDays,
          repetitions: next.repetitions,
          lapses: next.lapses,
          dueOn: new Date(`${next.dueOn}T00:00:00Z`),
          lastReviewedAt: new Date(),
        },
      }),
      this.prisma.srsReview.create({
        data: {
          id: newId(),
          cardId: card.id,
          studentId: student.id,
          quality: dto.quality,
          intervalBefore: card.intervalDays,
          intervalAfter: next.intervalDays,
          easinessAfter: next.easiness,
          durationMs: dto.durationMs ?? null,
        },
      }),
    ]);
    const actorUser = await this.prisma.user.findUnique({
      where: { id: actor.id },
      select: { firstName: true, lastName: true },
    });
    await this.store({
      organizationId: student.organizationId,
      actorUserId: actor.id,
      studentId: student.id,
      input: {
        verb: 'answered',
        actor: {
          userId: actor.id,
          name: actorUser
            ? `${actorUser.firstName} ${actorUser.lastName}`
            : 'student',
        },
        object: {
          type: 'srs-card',
          id: card.id,
          name: card.front.slice(0, 200),
        },
        result: {
          raw: dto.quality,
          max: 5,
          success: dto.quality >= 3,
          completion: true,
          ...(dto.durationMs
            ? { durationSeconds: Math.round(dto.durationMs / 1000) }
            : {}),
        },
      },
    });
    const reviewedToday = await this.prisma.srsReview.count({
      where: {
        studentId: student.id,
        reviewedAt: { gte: new Date(`${today}T00:00:00Z`) },
      },
    });
    let reward = null;
    if (reviewedToday === PRACTICE_SESSION_REVIEWS)
      reward = await this.motivation.recordAction(
        student.id,
        student.organizationId,
        { kind: 'practice' },
        [
          {
            reason: 'practice.completed',
            amount: XP.PRACTICE,
            entityType: 'SrsDay',
            entityId: today,
          },
        ],
      );
    return {
      card: this.toCard(updated),
      reviewedToday,
      sessionGoal: PRACTICE_SESSION_REVIEWS,
      reward,
    };
  }

  async removeCard(cardId: string, actor: AuthenticatedUser): Promise<void> {
    const student = await this.ownStudent(actor);
    const card = await this.prisma.srsCard.findFirst({
      where: { id: cardId, studentId: student.id },
      select: { id: true },
    });
    if (!card)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Card not found.',
      });
    await this.prisma.srsCard.delete({ where: { id: card.id } });
  }

  async suspendCard(
    cardId: string,
    suspended: boolean,
    actor: AuthenticatedUser,
  ): Promise<PublicCard> {
    const student = await this.ownStudent(actor);
    const card = await this.prisma.srsCard.findFirst({
      where: { id: cardId, studentId: student.id },
      select: { id: true },
    });
    if (!card)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Card not found.',
      });
    return this.toCard(
      await this.prisma.srsCard.update({
        where: { id: card.id },
        data: { suspended },
      }),
    );
  }

  async practiceStats(studentId: string) {
    const today = isoDay(new Date());
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [cards, reviews, reviewDays] = await Promise.all([
      this.prisma.srsCard.findMany({
        where: { studentId },
        select: {
          easiness: true,
          intervalDays: true,
          repetitions: true,
          lapses: true,
          dueOn: true,
          suspended: true,
        },
      }),
      this.prisma.srsReview.findMany({
        where: { studentId, reviewedAt: { gte: since } },
        select: { quality: true, reviewedAt: true },
      }),
      this.prisma.srsReview.findMany({
        where: {
          studentId,
          reviewedAt: { gte: new Date(Date.now() - 60 * 86_400_000) },
        },
        select: { reviewedAt: true },
        distinct: ['reviewedAt'],
      }),
    ]);
    const active = cards.filter((c) => !c.suspended);
    const states = active.map((c) => ({
      easiness: Number(c.easiness),
      intervalDays: c.intervalDays,
      repetitions: c.repetitions,
      lapses: c.lapses,
    }));
    const todayStart = new Date(`${today}T00:00:00Z`);
    return {
      total: cards.length,
      dueToday: active.filter((c) => c.dueOn.getTime() <= todayStart.getTime())
        .length,
      mastered: states.filter(isMastered).length,
      struggling: states.filter(isStruggling).length,
      reviewedToday: reviews.filter((r) => r.reviewedAt >= todayStart).length,
      reviewsLast30Days: reviews.length,
      retentionLast30Days: retentionRate(reviews.map((r) => r.quality)),
      practiceDaysLast60: new Set(reviewDays.map((r) => isoDay(r.reviewedAt)))
        .size,
      sessionGoal: PRACTICE_SESSION_REVIEWS,
    };
  }

  private toCard(r: {
    id: string;
    front: string;
    back: string;
    hint: string | null;
    sourceType: string;
    sourceId: string | null;
    easiness: unknown;
    intervalDays: number;
    repetitions: number;
    lapses: number;
    dueOn: Date;
    lastReviewedAt: Date | null;
    suspended: boolean;
  }): PublicCard {
    const state = {
      easiness: Number(r.easiness),
      intervalDays: r.intervalDays,
      repetitions: r.repetitions,
      lapses: r.lapses,
    };
    return {
      id: r.id,
      front: r.front,
      back: r.back,
      hint: r.hint,
      sourceType: r.sourceType,
      sourceId: r.sourceId,
      easiness: state.easiness,
      intervalDays: r.intervalDays,
      repetitions: r.repetitions,
      lapses: r.lapses,
      dueOn: isoDay(r.dueOn),
      lastReviewedAt: r.lastReviewedAt,
      suspended: r.suspended,
      status:
        r.repetitions === 0
          ? 'new'
          : isMastered(state)
            ? 'mastered'
            : isStruggling(state)
              ? 'struggling'
              : 'learning',
    };
  }

  // ---------------------------------------------------------------------------
  // Mastery per standard
  // ---------------------------------------------------------------------------

  private async recomputeForAssignment(
    studentId: string,
    assignmentId: string,
  ): Promise<void> {
    const tags = await this.prisma.assignmentStandard.findMany({
      where: { assignmentId },
      select: { standardId: true },
    });
    if (tags.length)
      await this.recompute(
        studentId,
        tags.map((t) => t.standardId),
      );
  }

  /** Gathers every piece of evidence for the standards and stores the recency-weighted level and trend. */
  async recompute(studentId: string, standardIds?: string[]): Promise<number> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { organizationId: true },
    });
    if (!student) return 0;
    const scale = await this.prisma.proficiencyScale.findFirst({
      where: { organizationId: student.organizationId, isDefault: true },
      select: { levels: true },
    });
    const maxLevel = Math.max(
      ...parseLevels(scale?.levels ?? null).map((l) => l.level),
      1,
    );
    const ids = standardIds ?? (await this.evidenceStandardIds(studentId));
    let touched = 0;
    for (const standardId of ids) {
      const [grades, scores, results, lessons] = await Promise.all([
        this.prisma.grade.findMany({
          where: {
            studentId,
            assignment: { standards: { some: { standardId } } },
          },
          select: { percentage: true, gradedAt: true },
        }),
        this.prisma.standardScore.findMany({
          where: { standardId, grade: { studentId } },
          select: { level: true, grade: { select: { gradedAt: true } } },
        }),
        this.prisma.h5PContentResult.findMany({
          where: {
            studentId,
            completed: true,
            assignment: { standards: { some: { standardId } } },
          },
          select: { score: true, maxScore: true, createdAt: true },
        }),
        this.prisma.lessonCompletion.findMany({
          where: { studentId, lesson: { standards: { some: { standardId } } } },
          select: { completedAt: true },
        }),
      ]);
      const evidence: Evidence[] = [
        ...grades.map((g) => ({
          score: Number(g.percentage) / 100,
          at: g.gradedAt,
          weight: EVIDENCE_WEIGHT.grade,
        })),
        ...scores.map((s) => ({
          score: s.level / maxLevel,
          at: s.grade.gradedAt,
          weight: EVIDENCE_WEIGHT.standardScore,
        })),
        ...results
          .filter((r) => Number(r.maxScore) > 0)
          .map((r) => ({
            score: Number(r.score) / Number(r.maxScore),
            at: r.createdAt,
            weight: EVIDENCE_WEIGHT.practice,
          })),
        ...lessons.map((l) => ({
          score: 1,
          at: l.completedAt,
          weight: EVIDENCE_WEIGHT.lesson,
        })),
      ];
      const { level, trend } = masteryFrom(evidence);
      if (level === null) continue;
      const lastEvidenceAt = evidence
        .map((e) => e.at)
        .sort((a, b) => b.getTime() - a.getTime())[0];
      await this.prisma.masteryLevel.upsert({
        where: { studentId_standardId: { studentId, standardId } },
        create: {
          id: newId(),
          studentId,
          standardId,
          level,
          evidenceCount: evidence.length,
          trend,
          lastEvidenceAt,
        },
        update: {
          level,
          evidenceCount: evidence.length,
          trend,
          lastEvidenceAt,
        },
      });
      touched += 1;
    }
    return touched;
  }

  private async evidenceStandardIds(studentId: string): Promise<string[]> {
    const [a, l] = await Promise.all([
      this.prisma.assignmentStandard.findMany({
        where: {
          assignment: {
            OR: [
              { grades: { some: { studentId } } },
              { h5pResults: { some: { studentId } } },
            ],
          },
        },
        select: { standardId: true },
        distinct: ['standardId'],
      }),
      this.prisma.lessonStandard.findMany({
        where: { lesson: { completions: { some: { studentId } } } },
        select: { standardId: true },
        distinct: ['standardId'],
      }),
    ]);
    return [...new Set([...a, ...l].map((x) => x.standardId))];
  }

  async masteryFor(studentId: string, actor: AuthenticatedUser) {
    const student = await this.visibleStudent(studentId, actor);
    return this.masterySummary(student.id, student.firstName, student.lastName);
  }

  async myMastery(actor: AuthenticatedUser) {
    const student = await this.ownStudent(actor);
    return this.masterySummary(student.id, student.firstName, student.lastName);
  }

  private async masterySummary(
    studentId: string,
    firstName: string,
    lastName: string,
  ) {
    const rows = await this.prisma.masteryLevel.findMany({
      where: { studentId },
      include: {
        standard: {
          select: {
            id: true,
            code: true,
            description: true,
            setId: true,
            parentId: true,
            set: { select: { name: true, subject: true } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
    const items = rows.map((r) => ({
      standardId: r.standardId,
      code: r.standard.code,
      description: r.standard.description,
      subject: r.standard.set.subject,
      setName: r.standard.set.name,
      level: Number(r.level),
      band: masteryBand(Number(r.level)),
      trend: r.trend,
      evidenceCount: r.evidenceCount,
      lastEvidenceAt: r.lastEvidenceAt,
    }));
    const levels = items.map((i) => i.level);
    return {
      student: { id: studentId, firstName, lastName },
      standards: items.sort((a, b) => a.code.localeCompare(b.code)),
      average: levels.length
        ? Math.round(
            (levels.reduce((s, x) => s + x, 0) / levels.length) * 1000,
          ) / 1000
        : null,
      counts: {
        advanced: items.filter((i) => i.band === 'advanced').length,
        proficient: items.filter((i) => i.band === 'proficient').length,
        developing: items.filter((i) => i.band === 'developing').length,
        beginning: items.filter((i) => i.band === 'beginning').length,
      },
      strongest: [...items].sort((a, b) => b.level - a.level).slice(0, 3),
      weakest: [...items].sort((a, b) => a.level - b.level).slice(0, 3),
    };
  }

  /** Mastery rings for a course: the standards attached to each module's lessons and assignments, for one student. */
  async courseMastery(
    courseId: string,
    actor: AuthenticatedUser,
    studentId?: string,
  ) {
    const student =
      actor.role === 'STUDENT'
        ? await this.ownStudent(actor)
        : await this.visibleStudent(studentId ?? '', actor);
    const course = await this.prisma.course.findFirst({
      where: { id: courseId, deletedAt: null },
      select: {
        id: true,
        title: true,
        organizationId: true,
        modules: {
          orderBy: { sortOrder: 'asc' },
          select: {
            id: true,
            title: true,
            lessons: {
              select: { standards: { select: { standardId: true } } },
            },
          },
        },
        classes: {
          select: {
            assignments: {
              select: { standards: { select: { standardId: true } } },
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
    if (course.organizationId !== student.organizationId)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Not available for your account.',
      });
    const allIds = new Set<string>();
    for (const m of course.modules)
      for (const l of m.lessons)
        for (const s of l.standards) allIds.add(s.standardId);
    for (const k of course.classes)
      for (const a of k.assignments)
        for (const s of a.standards) allIds.add(s.standardId);
    const levels = allIds.size
      ? await this.prisma.masteryLevel.findMany({
          where: { studentId: student.id, standardId: { in: [...allIds] } },
          include: { standard: { select: { code: true, description: true } } },
        })
      : [];
    const byId = new Map(levels.map((l) => [l.standardId, l]));
    const modules = course.modules.map((m) => {
      const ids = [
        ...new Set(
          m.lessons.flatMap((l) => l.standards.map((s) => s.standardId)),
        ),
      ];
      const known = ids
        .map((id) => byId.get(id))
        .filter((x): x is NonNullable<typeof x> => !!x);
      const avg = known.length
        ? Math.round(
            (known.reduce((s, l) => s + Number(l.level), 0) / known.length) *
              1000,
          ) / 1000
        : null;
      return {
        id: m.id,
        title: m.title,
        standards: ids.length,
        measured: known.length,
        level: avg,
        band: masteryBand(avg),
      };
    });
    const all = levels.map((l) => Number(l.level));
    return {
      course: { id: course.id, title: course.title },
      student: {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
      },
      level: all.length
        ? Math.round((all.reduce((s, x) => s + x, 0) / all.length) * 1000) /
          1000
        : null,
      modules,
      standards: levels.map((l) => ({
        standardId: l.standardId,
        code: l.standard.code,
        description: l.standard.description,
        level: Number(l.level),
        band: masteryBand(Number(l.level)),
        trend: l.trend,
      })),
    };
  }

  /** The class as a whole per standard: average, band counts and who needs help; the teacher's view, never the students'. */
  async classMastery(classId: string, actor: AuthenticatedUser) {
    const klass = await this.manageableClass(classId, actor);
    const members = await this.prisma.classEnrollment.findMany({
      where: { classId, status: 'ENROLLED' },
      select: {
        studentId: true,
        student: { select: { firstName: true, lastName: true } },
      },
    });
    const ids = members.map((m) => m.studentId);
    const standardIds = new Set<string>();
    const [aTags, lTags] = await Promise.all([
      this.prisma.assignmentStandard.findMany({
        where: { assignment: { classId } },
        select: { standardId: true },
      }),
      this.prisma.lessonStandard.findMany({
        where: { lesson: { module: { courseId: klass.courseId } } },
        select: { standardId: true },
      }),
    ]);
    for (const t of [...aTags, ...lTags]) standardIds.add(t.standardId);
    const rows =
      standardIds.size && ids.length
        ? await this.prisma.masteryLevel.findMany({
            where: {
              studentId: { in: ids },
              standardId: { in: [...standardIds] },
            },
            include: {
              standard: { select: { code: true, description: true } },
            },
          })
        : [];
    const nameOf = new Map(
      members.map((m) => [
        m.studentId,
        `${m.student.firstName} ${m.student.lastName}`,
      ]),
    );
    const byStandard = new Map<
      string,
      {
        code: string;
        description: string;
        levels: Array<{ studentId: string; level: number }>;
      }
    >();
    for (const r of rows) {
      const entry = byStandard.get(r.standardId) ?? {
        code: r.standard.code,
        description: r.standard.description,
        levels: [],
      };
      entry.levels.push({ studentId: r.studentId, level: Number(r.level) });
      byStandard.set(r.standardId, entry);
    }
    const standards = [...byStandard.entries()]
      .map(([standardId, e]) => {
        const avg =
          Math.round(
            (e.levels.reduce((s, l) => s + l.level, 0) / e.levels.length) *
              1000,
          ) / 1000;
        return {
          standardId,
          code: e.code,
          description: e.description,
          measured: e.levels.length,
          average: avg,
          band: masteryBand(avg),
          counts: {
            advanced: e.levels.filter((l) => l.level >= 0.9).length,
            proficient: e.levels.filter((l) => l.level >= 0.7 && l.level < 0.9)
              .length,
            developing: e.levels.filter((l) => l.level >= 0.5 && l.level < 0.7)
              .length,
            beginning: e.levels.filter((l) => l.level < 0.5).length,
          },
          needsHelp: e.levels
            .filter((l) => l.level < 0.5)
            .sort((a, b) =>
              (nameOf.get(a.studentId) ?? '').localeCompare(
                nameOf.get(b.studentId) ?? '',
              ),
            )
            .map((l) => ({
              studentId: l.studentId,
              name: nameOf.get(l.studentId) ?? '',
              level: l.level,
            })),
        };
      })
      .sort((a, b) => a.code.localeCompare(b.code));
    return {
      class: { id: klass.id, name: klass.name },
      students: ids.length,
      standards,
    };
  }

  /** Nightly: refresh every student who produced evidence in the last day. */
  @Cron('10 2 * * *')
  async recomputeRecent(): Promise<number> {
    const since = new Date(Date.now() - 86_400_000);
    const ids = new Set<string>();
    for (const g of await this.prisma.grade.findMany({
      where: { gradedAt: { gte: since } },
      select: { studentId: true },
      distinct: ['studentId'],
    }))
      ids.add(g.studentId);
    for (const r of await this.prisma.h5PContentResult.findMany({
      where: { createdAt: { gte: since }, studentId: { not: null } },
      select: { studentId: true },
      distinct: ['studentId'],
    }))
      if (r.studentId) ids.add(r.studentId);
    for (const l of await this.prisma.lessonCompletion.findMany({
      where: { completedAt: { gte: since } },
      select: { studentId: true },
      distinct: ['studentId'],
    }))
      ids.add(l.studentId);
    let n = 0;
    for (const id of ids) {
      try {
        n += await this.recompute(id);
      } catch (err) {
        this.logger.warn(
          `Mastery recompute failed for ${id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return n;
  }

  // ---------------------------------------------------------------------------
  // Learning curves
  // ---------------------------------------------------------------------------

  async curveFor(studentId: string, actor: AuthenticatedUser, weeks = 12) {
    const student = await this.visibleStudent(studentId, actor);
    return this.curve([student.id], weeks);
  }

  async myCurve(actor: AuthenticatedUser, weeks = 12) {
    const student = await this.ownStudent(actor);
    return this.curve([student.id], weeks);
  }

  async classCurve(classId: string, actor: AuthenticatedUser, weeks = 12) {
    await this.manageableClass(classId, actor);
    const members = await this.prisma.classEnrollment.findMany({
      where: { classId, status: 'ENROLLED' },
      select: { studentId: true },
    });
    return this.curve(
      members.map((m) => m.studentId),
      weeks,
    );
  }

  private async curve(studentIds: string[], weeks: number) {
    if (studentIds.length === 0)
      return { weeks: learningCurve([], [], weeks), students: 0 };
    const since = new Date(Date.now() - weeks * 7 * 86_400_000);
    const [events, reviews] = await Promise.all([
      this.prisma.xapiStatement.findMany({
        where: {
          studentId: { in: studentIds },
          voidedAt: null,
          timestamp: { gte: since },
          verb: { in: ['completed', 'passed', 'failed'] },
          objectType: { in: ['h5p-content', 'assignment', 'lesson'] },
        },
        select: {
          timestamp: true,
          resultScaled: true,
          verb: true,
          objectType: true,
        },
      }),
      this.prisma.srsReview.findMany({
        where: { studentId: { in: studentIds }, reviewedAt: { gte: since } },
        select: { reviewedAt: true, quality: true },
      }),
    ]);
    // One scored event per thing: passed/failed carry the score, completed carries the count.
    const scored = events
      .filter((e) => e.verb !== 'completed' || e.objectType === 'lesson')
      .map((e) => ({
        at: e.timestamp,
        scaled: e.resultScaled === null ? null : Number(e.resultScaled),
      }));
    return {
      weeks: learningCurve(
        scored,
        reviews.map((r) => ({ at: r.reviewedAt, quality: r.quality })),
        weeks,
      ),
      students: studentIds.length,
    };
  }

  // ---------------------------------------------------------------------------
  // Access helpers
  // ---------------------------------------------------------------------------

  private async ownStudent(actor: AuthenticatedUser) {
    if (actor.role !== 'STUDENT')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Practice cards belong to students.',
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
    return student;
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
          detail: "Only this student's teachers see their learning.",
        });
    }
    return student;
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
    if (actor.role === 'COUNSELOR')
      assertOrganizationAccess(actor, klass.organizationId);
    return klass;
  }
}
