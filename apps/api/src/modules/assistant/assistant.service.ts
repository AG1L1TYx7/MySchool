import {
  BadRequestException,
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
import { AiContentService, type PublicJob } from '../ai/ai-content.service';
import { AssignmentsService } from '../assignments/assignments.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { CalendarService } from '../calendar/calendar.service';
import { canManage } from '../classes/classes.service';
import { MessagingService } from '../messaging/messaging.service';
import { weekWindow } from '../motivation/motivation-rules';
import { ReportCardsService } from '../report-cards/report-cards.service';
import {
  composeEmail,
  feedbackFromSuggestion,
  insightDataLines,
  rubricBlock,
  scaledScore,
  shouldRevokeTeacherRow,
  topTopics as rankTopics,
  validSubstituteWindow,
  type RubricCriterionDef,
} from './assistant-rules';
import {
  ApproveSuggestionDto,
  BulkNarrativeDto,
  DifferentiationDto,
  GeneratePlanDto,
  NarrativeDto,
  ParentEmailDto,
  PracticeSetDto,
  SubstituteDto,
  UpdateDraftDto,
  UpdateInsightDto,
  UpdatePlanDto,
} from './dto/assistant.dto';

const parse = <T>(text: string | null, fallback: T): T => {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
};
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const LEVEL_LABEL: Record<string, string> = {
  support: 'support',
  core: 'core',
  extension: 'extension',
};

export interface PublicPlan {
  id: string;
  title: string;
  topic: string;
  durationMinutes: number;
  gradeLevel: string | null;
  subject: string | null;
  standardCodes: string | null;
  status: 'draft' | 'published';
  scheduledOn: string | null;
  classId: string | null;
  className: string | null;
  courseId: string | null;
  lessonId: string | null;
  content: Record<string, unknown>;
  aiGenerated: boolean;
  author: { id: string; firstName: string; lastName: string };
  updatedAt: Date;
}

export interface PublicDraft {
  id: string;
  kind: string;
  title: string;
  language: string;
  status: string;
  studentId: string | null;
  studentName: string | null;
  lessonId: string | null;
  classId: string | null;
  content: Record<string, unknown>;
  aiGenerated: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The teacher assistant (docs/13 section 8, docs/02 section 19): lesson plans, grading suggestions, parent
 * emails, narratives, differentiation and class insight as AI drafts a teacher reviews; substitute access
 * with an expiry; a weekly planner. Nothing here reaches a student, a family or the gradebook without a
 * teacher action.
 */
@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly content: AiContentService,
    private readonly assignments: AssignmentsService,
    private readonly messaging: MessagingService,
    private readonly reportCards: ReportCardsService,
    private readonly calendar: CalendarService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lesson plans
  // ---------------------------------------------------------------------------

  async lessonPlans(
    actor: AuthenticatedUser,
    classId?: string,
  ): Promise<PublicPlan[]> {
    const rows = await this.prisma.lessonPlan.findMany({
      where: {
        ...(classId ? { classId } : {}),
        ...(ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL
          ? isDistrictRole(actor)
            ? {}
            : { organizationId: actor.organizationId ?? '' }
          : { authorId: actor.id }),
      },
      include: {
        class: { select: { name: true } },
        author: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => this.toPlan(r));
  }

  async generatePlan(
    dto: GeneratePlanDto,
    actor: AuthenticatedUser,
  ): Promise<PublicJob> {
    this.staffOnly(actor);
    const organizationId = actor.organizationId;
    if (!organizationId)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'District accounts draft plans from a school account.',
      });
    const blocks: Array<{ id: string; label: string; text: string }> = [];
    let courseId = dto.courseId;
    let gradeLevel = dto.gradeLevel ?? '';
    let subject = dto.subject ?? '';
    if (dto.classId) {
      const klass = await this.prisma.class.findFirst({
        where: { id: dto.classId, deletedAt: null },
        include: {
          teachers: { select: { teacherId: true } },
          course: { select: { id: true, gradeLevel: true, subject: true } },
        },
      });
      if (!klass || !canManage(klass, actor))
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'Only the class teachers plan for a class.',
        });
      courseId = courseId ?? klass.course.id;
      gradeLevel = gradeLevel || klass.course.gradeLevel || '';
      subject = subject || klass.course.subject || '';
    }
    if (dto.lessonId) {
      const lesson = await this.prisma.lesson.findFirst({
        where: { id: dto.lessonId },
        select: {
          title: true,
          content: true,
          description: true,
          module: { select: { courseId: true } },
        },
      });
      if (lesson) {
        courseId = courseId ?? lesson.module.courseId;
        blocks.push({
          id: 'C1',
          label: `Lesson: ${lesson.title}`,
          text:
            (lesson.description ? `${lesson.description}\n\n` : '') +
            (lesson.content ?? '').slice(0, 6000),
        });
      }
    }
    if (courseId) {
      const course = await this.prisma.course.findFirst({
        where: { id: courseId, deletedAt: null },
        select: {
          title: true,
          gradeLevel: true,
          subject: true,
          modules: {
            orderBy: { sortOrder: 'asc' },
            select: {
              title: true,
              lessons: {
                orderBy: { sortOrder: 'asc' },
                select: { title: true },
              },
            },
          },
        },
      });
      if (course) {
        gradeLevel = gradeLevel || course.gradeLevel || '';
        subject = subject || course.subject || '';
        blocks.push({
          id: 'C2',
          label: `Course outline: ${course.title}`,
          text: course.modules
            .map(
              (m) => `${m.title}: ${m.lessons.map((l) => l.title).join('; ')}`,
            )
            .join('\n')
            .slice(0, 3000),
        });
      }
    }
    return this.content.startText(
      'content.lesson_plan',
      {
        topic: dto.topic,
        subject,
        gradeLevel: gradeLevel || '7',
        language: dto.language ?? 'en',
        lessonId: dto.lessonId,
        courseId,
        classId: dto.classId,
        durationMinutes: dto.durationMinutes ?? 45,
        standard: dto.standard ?? null,
      },
      { courseId: courseId ?? null, lessonId: dto.lessonId ?? null, blocks },
      actor,
      organizationId,
    );
  }

  async plan(id: string, actor: AuthenticatedUser): Promise<PublicPlan> {
    return this.toPlan(await this.ownPlan(id, actor));
  }

  async updatePlan(
    id: string,
    dto: UpdatePlanDto,
    actor: AuthenticatedUser,
  ): Promise<PublicPlan> {
    await this.ownPlan(id, actor);
    if (dto.classId) {
      const klass = await this.prisma.class.findFirst({
        where: { id: dto.classId, deletedAt: null },
        include: { teachers: { select: { teacherId: true } } },
      });
      if (!klass || !canManage(klass, actor))
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'Only the class teachers schedule for a class.',
        });
    }
    const row = await this.prisma.lessonPlan.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.content !== undefined
          ? { content: JSON.stringify(dto.content) }
          : {}),
        ...(dto.status !== undefined
          ? { status: dto.status === 'published' ? 'PUBLISHED' : 'DRAFT' }
          : {}),
        ...(dto.scheduledOn !== undefined
          ? {
              scheduledOn: dto.scheduledOn
                ? new Date(`${dto.scheduledOn}T00:00:00Z`)
                : null,
            }
          : {}),
        ...(dto.classId !== undefined ? { classId: dto.classId } : {}),
      },
      include: {
        class: { select: { name: true } },
        author: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    return this.toPlan(row);
  }

  async removePlan(id: string, actor: AuthenticatedUser): Promise<void> {
    await this.ownPlan(id, actor);
    await this.prisma.lessonPlan.delete({ where: { id } });
  }

  private async ownPlan(id: string, actor: AuthenticatedUser) {
    const row = await this.prisma.lessonPlan.findUnique({
      where: { id },
      include: {
        class: { select: { name: true } },
        author: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Lesson plan not found.',
      });
    if (row.authorId !== actor.id) {
      if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.PRINCIPAL)
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'Only the author or an administrator opens this plan.',
        });
      assertOrganizationAccess(actor, row.organizationId);
    }
    return row;
  }

  private toPlan(row: {
    id: string;
    title: string;
    topic: string;
    durationMinutes: number;
    gradeLevel: string | null;
    subject: string | null;
    standardCodes: string | null;
    status: string;
    scheduledOn: Date | null;
    classId: string | null;
    courseId: string | null;
    lessonId: string | null;
    content: string;
    aiModel: string | null;
    updatedAt: Date;
    class: { name: string } | null;
    author: { id: string; firstName: string; lastName: string };
  }): PublicPlan {
    return {
      id: row.id,
      title: row.title,
      topic: row.topic,
      durationMinutes: row.durationMinutes,
      gradeLevel: row.gradeLevel,
      subject: row.subject,
      standardCodes: row.standardCodes,
      status: row.status === 'PUBLISHED' ? 'published' : 'draft',
      scheduledOn: row.scheduledOn ? isoDay(row.scheduledOn) : null,
      classId: row.classId,
      className: row.class?.name ?? null,
      courseId: row.courseId,
      lessonId: row.lessonId,
      content: parse<Record<string, unknown>>(row.content, {}),
      aiGenerated: !!row.aiModel,
      author: row.author,
      updatedAt: row.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Grading suggestions
  // ---------------------------------------------------------------------------

  async suggestGrades(assignmentId: string, actor: AuthenticatedUser) {
    const assignment = await this.gradableAssignment(assignmentId, actor);
    const latest = await this.prisma.assignmentSubmission.findMany({
      where: { assignmentId },
      orderBy: [{ studentId: 'asc' }, { attemptNumber: 'desc' }],
      select: {
        id: true,
        studentId: true,
        textContent: true,
        student: { select: { firstName: true } },
      },
    });
    const seen = new Set<string>();
    const candidates = latest.filter((s) => {
      if (seen.has(s.studentId)) return false;
      seen.add(s.studentId);
      return true;
    });
    const graded = new Set(
      (
        await this.prisma.grade.findMany({
          where: { assignmentId },
          select: { studentId: true },
        })
      ).map((g) => g.studentId),
    );
    const pending = new Set(
      (
        await this.prisma.gradingSuggestion.findMany({
          where: { assignmentId, status: 'PENDING' },
          select: { submissionId: true },
        })
      ).map((s) => s.submissionId),
    );
    const rubricText = this.rubricBlock(assignment);
    const jobs: Array<{ submissionId: string; jobId: string }> = [];
    const skipped = { graded: 0, pending: 0, noText: 0 };
    for (const s of candidates) {
      if (graded.has(s.studentId)) {
        skipped.graded += 1;
        continue;
      }
      if (pending.has(s.id)) {
        skipped.pending += 1;
        continue;
      }
      if (!s.textContent || s.textContent.trim().length < 20) {
        skipped.noText += 1;
        continue;
      }
      const job = await this.content.startText(
        'grading.rubric',
        {
          topic: assignment.title,
          subject: assignment.class.course.subject ?? '',
          gradeLevel: assignment.class.course.gradeLevel ?? '7',
          language: 'en',
          submissionId: s.id,
          assignmentId,
          studentId: s.studentId,
          classId: assignment.classId,
        },
        {
          courseId: assignment.class.course.id,
          lessonId: null,
          blocks: [
            { id: 'R1', label: 'RUBRIC', text: rubricText },
            {
              id: 'A1',
              label: 'ASSIGNMENT',
              text: `${assignment.title}\n${assignment.instructions ?? assignment.description ?? ''}`.slice(
                0,
                3000,
              ),
            },
            {
              id: 'S1',
              label: 'SUBMISSION',
              text: s.textContent.slice(0, 12000),
            },
          ],
        },
        actor,
        assignment.organizationId,
      );
      jobs.push({ submissionId: s.id, jobId: job.id });
    }
    return { started: jobs.length, skipped, jobs };
  }

  async suggestions(assignmentId: string, actor: AuthenticatedUser) {
    const assignment = await this.gradableAssignment(assignmentId, actor);
    const rows = await this.prisma.gradingSuggestion.findMany({
      where: { assignmentId },
      include: {
        student: { select: { id: true, firstName: true, lastName: true } },
        submission: {
          select: { textContent: true, attemptNumber: true, isLate: true },
        },
        reviewedBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: [
        { student: { lastName: 'asc' } },
        { student: { firstName: 'asc' } },
      ],
    });
    const graded = new Set(
      (
        await this.prisma.grade.findMany({
          where: { assignmentId },
          select: { studentId: true },
        })
      ).map((g) => g.studentId),
    );
    const max = Number(assignment.maxPoints);
    return {
      assignment: {
        id: assignment.id,
        title: assignment.title,
        maxPoints: max,
        hasRubric: !!assignment.rubric,
      },
      data: rows.map((r) => ({
        id: r.id,
        submissionId: r.submissionId,
        student: r.student,
        excerpt: (r.submission.textContent ?? '').slice(0, 300),
        attemptNumber: r.submission.attemptNumber,
        isLate: r.submission.isLate,
        content: parse<Record<string, unknown>>(r.content, {}),
        score: Number(r.score),
        maxPoints: Number(r.maxPoints),
        suggestedPoints: this.scaled(Number(r.score), Number(r.maxPoints), max),
        confidence: Number(r.confidence),
        needsHumanReview: r.needsHumanReview,
        flag: r.flag,
        status: r.status.toLowerCase(),
        reviewedBy: r.reviewedBy,
        reviewedAt: r.reviewedAt,
        alreadyGraded: graded.has(r.studentId),
        aiModel: r.aiModel,
      })),
    };
  }

  async approve(
    id: string,
    dto: ApproveSuggestionDto,
    actor: AuthenticatedUser,
  ) {
    const s = await this.prisma.gradingSuggestion.findUnique({
      where: { id },
      include: { assignment: { select: { maxPoints: true, rubricId: true } } },
    });
    if (!s)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Suggestion not found.',
      });
    if (s.status !== 'PENDING')
      throw new ForbiddenException({
        code: 'assistant.already_reviewed',
        detail: 'This suggestion was already reviewed.',
      });
    const max = Number(s.assignment.maxPoints);
    const draft = parse<{
      criteria?: Array<{
        criterionId: string;
        score: number;
        feedback?: string;
      }>;
      summary?: string;
    }>(s.content, {});
    const score =
      dto.score ?? this.scaled(Number(s.score), Number(s.maxPoints), max);
    const feedback = dto.feedback ?? feedbackFromSuggestion(draft);
    const rubricScores =
      s.assignment.rubricId && draft.criteria?.length
        ? draft.criteria.map((c) => ({
            criterionId: c.criterionId,
            points: c.score,
          }))
        : undefined;
    // The grade route enforces who may grade and the score ceiling; a 403 there stays a 403 here.
    const grade = await this.assignments.grade(
      s.submissionId,
      { score, feedback, rubricScores },
      actor,
    );
    await this.prisma.gradingSuggestion.update({
      where: { id },
      data: {
        status: 'APPROVED',
        reviewedById: actor.id,
        reviewedAt: new Date(),
      },
    });
    return { status: 'approved', grade };
  }

  async reject(id: string, actor: AuthenticatedUser) {
    const s = await this.prisma.gradingSuggestion.findUnique({ where: { id } });
    if (!s)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Suggestion not found.',
      });
    await this.gradableAssignment(s.assignmentId, actor);
    await this.prisma.gradingSuggestion.update({
      where: { id },
      data: {
        status: 'REJECTED',
        reviewedById: actor.id,
        reviewedAt: new Date(),
      },
    });
    return { status: 'rejected' };
  }

  /** Bulk approve: only confident suggestions; anything flagged for a human stays pending. */
  async approveAll(assignmentId: string, actor: AuthenticatedUser) {
    await this.gradableAssignment(assignmentId, actor);
    const rows = await this.prisma.gradingSuggestion.findMany({
      where: { assignmentId, status: 'PENDING', needsHumanReview: false },
      select: { id: true },
    });
    let approved = 0;
    for (const r of rows) {
      try {
        await this.approve(r.id, {}, actor);
        approved += 1;
      } catch (err) {
        this.logger.warn(
          `Bulk approve skipped ${r.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    const left = await this.prisma.gradingSuggestion.count({
      where: { assignmentId, status: 'PENDING' },
    });
    return { approved, left };
  }

  private rubricBlock(assignment: {
    maxPoints: unknown;
    rubric: { criteria: string } | null;
  }): string {
    return rubricBlock(
      parse<RubricCriterionDef[]>(assignment.rubric?.criteria ?? null, []),
      Number(assignment.maxPoints),
    );
  }

  private scaled(score: number, max: number, assignmentMax: number): number {
    return scaledScore(score, max, assignmentMax);
  }

  private async gradableAssignment(id: string, actor: AuthenticatedUser) {
    const a = await this.prisma.assignment.findFirst({
      where: { id, deletedAt: null },
      include: {
        rubric: { select: { criteria: true } },
        class: {
          include: {
            teachers: { select: { teacherId: true } },
            course: { select: { id: true, subject: true, gradeLevel: true } },
          },
        },
      },
    });
    if (!a)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Assignment not found.',
      });
    if (!canManage(a.class, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only the class teachers and administrators grade this class.',
      });
    return a;
  }

  // ---------------------------------------------------------------------------
  // Drafts: parent emails, narratives, differentiation
  // ---------------------------------------------------------------------------

  async drafts(
    actor: AuthenticatedUser,
    kind?: string,
    studentId?: string,
  ): Promise<PublicDraft[]> {
    this.staffOnly(actor);
    const rows = await this.prisma.teacherDraft.findMany({
      where: {
        authorId: actor.id,
        ...(kind ? { kind } : {}),
        ...(studentId ? { studentId } : {}),
      },
      include: { student: { select: { firstName: true, lastName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => this.toDraft(r));
  }

  async draft(id: string, actor: AuthenticatedUser): Promise<PublicDraft> {
    return this.toDraft(await this.ownDraft(id, actor));
  }

  async updateDraft(
    id: string,
    dto: UpdateDraftDto,
    actor: AuthenticatedUser,
  ): Promise<PublicDraft> {
    await this.ownDraft(id, actor);
    const row = await this.prisma.teacherDraft.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title.trim() } : {}),
        ...(dto.content !== undefined
          ? { content: JSON.stringify(dto.content) }
          : {}),
        ...(dto.status !== undefined ? { status: dto.status } : {}),
      },
      include: { student: { select: { firstName: true, lastName: true } } },
    });
    return this.toDraft(row);
  }

  async removeDraft(id: string, actor: AuthenticatedUser): Promise<void> {
    await this.ownDraft(id, actor);
    await this.prisma.teacherDraft.delete({ where: { id } });
  }

  async draftParentEmail(
    dto: ParentEmailDto,
    actor: AuthenticatedUser,
  ): Promise<PublicJob> {
    const student = await this.taughtStudent(dto.studentId, actor);
    const data = await this.studentDataBlock(student.id, actor);
    return this.content.startText(
      'content.parent_email',
      {
        topic: dto.topic ?? `${student.firstName}'s progress`,
        subject: '',
        gradeLevel: student.gradeLevel ?? '7',
        language: dto.language ?? 'en',
        studentId: student.id,
        purpose: dto.purpose,
        tone: dto.tone ?? 'warm and specific',
      },
      {
        courseId: null,
        lessonId: null,
        blocks: [{ id: 'D1', label: 'DATA', text: data }],
      },
      actor,
      student.organizationId,
    );
  }

  async draftNarrative(
    dto: NarrativeDto,
    actor: AuthenticatedUser,
  ): Promise<PublicJob> {
    const student = await this.taughtStudent(dto.studentId, actor);
    const klass = await this.prisma.class.findFirst({
      where: { id: dto.classId, deletedAt: null },
      include: {
        teachers: { select: { teacherId: true } },
        course: { select: { subject: true, gradeLevel: true } },
      },
    });
    if (!klass || !canManage(klass, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only the class teachers write its narratives.',
      });
    const data = await this.studentDataBlock(student.id, actor, klass.id);
    return this.content.startText(
      'content.narrative',
      {
        topic: student.firstName,
        subject: klass.course.subject ?? '',
        gradeLevel: klass.course.gradeLevel ?? student.gradeLevel ?? '7',
        language: dto.language ?? 'en',
        studentId: student.id,
        classId: klass.id,
      },
      {
        courseId: null,
        lessonId: null,
        blocks: [{ id: 'D1', label: 'DATA', text: data }],
      },
      actor,
      student.organizationId,
    );
  }

  async draftNarratives(dto: BulkNarrativeDto, actor: AuthenticatedUser) {
    const members = await this.prisma.classEnrollment.findMany({
      where: { classId: dto.classId, status: 'ENROLLED' },
      select: { studentId: true },
      take: 40,
    });
    const jobs: Array<{ studentId: string; jobId: string }> = [];
    for (const m of members) {
      const job = await this.draftNarrative(
        {
          studentId: m.studentId,
          classId: dto.classId,
          language: dto.language,
        },
        actor,
      );
      jobs.push({ studentId: m.studentId, jobId: job.id });
    }
    return { started: jobs.length, jobs };
  }

  async draftDifferentiation(
    dto: DifferentiationDto,
    actor: AuthenticatedUser,
  ): Promise<PublicJob> {
    this.staffOnly(actor);
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: dto.lessonId },
      include: {
        module: {
          select: {
            course: {
              select: {
                id: true,
                organizationId: true,
                subject: true,
                gradeLevel: true,
              },
            },
          },
        },
      },
    });
    if (!lesson)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Lesson not found.',
      });
    assertOrganizationAccess(actor, lesson.module.course.organizationId);
    if (!lesson.content || lesson.content.trim().length < 40)
      throw new ForbiddenException({
        code: 'assistant.no_content',
        detail: 'This lesson has no text to adapt yet.',
      });
    return this.content.startText(
      'content.differentiation',
      {
        topic: lesson.title,
        subject: lesson.module.course.subject ?? '',
        gradeLevel: lesson.module.course.gradeLevel ?? '7',
        language: dto.language ?? 'en',
        lessonId: lesson.id,
        courseId: lesson.module.course.id,
      },
      {
        courseId: lesson.module.course.id,
        lessonId: lesson.id,
        blocks: [
          { id: 'S1', label: 'SOURCE', text: lesson.content.slice(0, 8000) },
        ],
      },
      actor,
      lesson.module.course.organizationId,
    );
  }

  /** Posts the email as a message to each guardian who receives notifications. */
  async sendParentEmail(id: string, actor: AuthenticatedUser) {
    const draft = await this.ownDraft(id, actor);
    if (draft.kind !== 'parent_email' || !draft.studentId)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Only a parent email draft can be sent.',
      });
    const content = parse<{
      subject?: string;
      greeting?: string;
      body?: string[];
      closing?: string;
      signature?: string;
    }>(draft.content, {});
    const text = composeEmail(content, draft.title);
    const guardians = await this.prisma.studentGuardian.findMany({
      where: { studentId: draft.studentId, receivesNotifications: true },
      select: { guardianUserId: true },
    });
    let sent = 0;
    for (const g of guardians) {
      const conversation = await this.messaging.create(
        { type: 'direct', participantIds: [g.guardianUserId] },
        actor,
      );
      await this.messaging.send(conversation.id, { content: text }, actor);
      sent += 1;
    }
    await this.prisma.teacherDraft.update({
      where: { id },
      data: { status: 'sent' },
    });
    return { sentTo: sent };
  }

  /** Puts the narrative on the student's draft report card line for that class. */
  async applyNarrative(id: string, actor: AuthenticatedUser) {
    const draft = await this.ownDraft(id, actor);
    if (draft.kind !== 'narrative' || !draft.studentId || !draft.classId)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Only a narrative draft can be applied to a report card.',
      });
    const card = await this.prisma.reportCard.findFirst({
      where: {
        studentId: draft.studentId,
        status: 'DRAFT',
        lines: { some: { classId: draft.classId } },
      },
      orderBy: { createdAt: 'desc' },
      include: {
        lines: { where: { classId: draft.classId }, select: { id: true } },
      },
    });
    if (!card || !card.lines[0])
      throw new NotFoundException({
        code: 'assistant.no_report_card',
        detail:
          'No draft report card for this student and class yet. Generate report cards first.',
      });
    const content = parse<{ narrative?: string }>(draft.content, {});
    const narrative = (content.narrative ?? '').trim();
    if (!narrative)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'The narrative is empty.',
      });
    await this.reportCards.comment(
      card.id,
      card.lines[0].id,
      { comment: narrative.slice(0, 2000) },
      actor,
    );
    await this.prisma.teacherDraft.update({
      where: { id },
      data: { status: 'used' },
    });
    return { reportCardId: card.id, lineId: card.lines[0].id };
  }

  /** Three unpublished lessons next to the source, one per level, for the teacher to review and publish. */
  async createLevelLessons(id: string, actor: AuthenticatedUser) {
    const draft = await this.ownDraft(id, actor);
    if (draft.kind !== 'differentiation' || !draft.lessonId)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Only a differentiation draft creates lessons.',
      });
    const source = await this.prisma.lesson.findFirst({
      where: { id: draft.lessonId },
      select: { moduleId: true, sortOrder: true, title: true },
    });
    if (!source)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'The source lesson no longer exists.',
      });
    const content = parse<{
      levels?: Array<{
        level: string;
        title: string;
        readingLevel?: string;
        text: string;
        keyWords?: string[];
        questions?: Array<{ prompt: string; answer: string }>;
      }>;
    }>(draft.content, {});
    const created: Array<{ id: string; title: string; level: string }> = [];
    let order = source.sortOrder;
    for (const lv of content.levels ?? []) {
      order += 1;
      const body = [
        lv.text.trim(),
        lv.keyWords?.length ? `\n\nKey words: ${lv.keyWords.join(', ')}` : '',
        lv.questions?.length
          ? `\n\nQuestions:\n${lv.questions.map((q, i) => `${i + 1}. ${q.prompt}`).join('\n')}`
          : '',
      ].join('');
      const row = await this.prisma.lesson.create({
        data: {
          id: newId(),
          moduleId: source.moduleId,
          title: `${lv.title || source.title} (${LEVEL_LABEL[lv.level] ?? lv.level}${lv.readingLevel ? `, ${lv.readingLevel}` : ''})`,
          lessonType: 'TEXT',
          content: body.slice(0, 20000),
          sortOrder: order,
          isPublished: false,
        },
      });
      created.push({ id: row.id, title: row.title, level: lv.level });
    }
    await this.prisma.teacherDraft.update({
      where: { id },
      data: { status: 'used' },
    });
    return { data: created };
  }

  private async ownDraft(id: string, actor: AuthenticatedUser) {
    const row = await this.prisma.teacherDraft.findUnique({
      where: { id },
      include: { student: { select: { firstName: true, lastName: true } } },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Draft not found.',
      });
    if (row.authorId !== actor.id)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Drafts are private to the teacher who made them.',
      });
    return row;
  }

  private toDraft(row: {
    id: string;
    kind: string;
    title: string;
    language: string;
    status: string;
    studentId: string | null;
    lessonId: string | null;
    classId: string | null;
    content: string;
    aiModel: string | null;
    createdAt: Date;
    updatedAt: Date;
    student: { firstName: string; lastName: string } | null;
  }): PublicDraft {
    return {
      id: row.id,
      kind: row.kind,
      title: row.title,
      language: row.language,
      status: row.status,
      studentId: row.studentId,
      studentName: row.student
        ? `${row.student.firstName} ${row.student.lastName}`
        : null,
      lessonId: row.lessonId,
      classId: row.classId,
      content: parse<Record<string, unknown>>(row.content, {}),
      aiGenerated: !!row.aiModel,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** The one student's own numbers as lines; never another student's. */
  private async studentDataBlock(
    studentId: string,
    actor: AuthenticatedUser,
    classId?: string,
  ): Promise<string> {
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 86_400_000);
    const [
      student,
      enrollments,
      attendance,
      submissions,
      grades,
      behaviour,
      me,
    ] = await Promise.all([
      this.prisma.student.findUniqueOrThrow({
        where: { id: studentId },
        select: { firstName: true, gradeLevel: true },
      }),
      this.prisma.classEnrollment.findMany({
        where: {
          studentId,
          status: { in: ['ENROLLED', 'COMPLETED'] },
          ...(classId ? { classId } : {}),
        },
        select: {
          currentGrade: true,
          class: {
            select: { name: true, course: { select: { title: true } } },
          },
        },
      }),
      this.prisma.attendance.findMany({
        where: {
          studentId,
          date: { gte: since },
          ...(classId ? { classId } : {}),
        },
        select: { status: true },
      }),
      this.prisma.assignmentSubmission.findMany({
        where: {
          studentId,
          submittedAt: { gte: since },
          ...(classId ? { assignment: { classId } } : {}),
        },
        select: { isLate: true },
      }),
      this.prisma.grade.findMany({
        where: {
          studentId,
          gradedAt: { gte: since },
          ...(classId ? { assignment: { classId } } : {}),
        },
        orderBy: { gradedAt: 'desc' },
        take: 6,
        select: { percentage: true, assignment: { select: { title: true } } },
      }),
      this.prisma.behaviorRecord.findMany({
        where: { studentId, kind: 'POSITIVE', occurredAt: { gte: since } },
        select: { title: true },
        take: 3,
      }),
      this.prisma.user.findUnique({
        where: { id: actor.id },
        select: { firstName: true, lastName: true },
      }),
    ]);
    const present = attendance.filter((a) =>
      ['PRESENT', 'LATE', 'TARDY', 'LEFT_EARLY'].includes(a.status),
    ).length;
    const lines = [
      `student first name: ${student.firstName}`,
      `grade level: ${student.gradeLevel ?? 'unknown'}`,
      `teacher: ${me ? `${me.firstName} ${me.lastName}` : 'the teacher'}`,
      ...enrollments.map(
        (e) =>
          `class ${e.class.name} (${e.class.course.title}): current grade ${e.currentGrade === null ? 'not yet available' : `${Number(e.currentGrade)}%`}`,
      ),
      `attendance last 30 days: ${attendance.length ? `${present} of ${attendance.length} days present` : 'no records'}`,
      `assignments turned in last 30 days: ${submissions.length}, on time: ${submissions.filter((s) => !s.isLate).length}`,
      ...grades.map(
        (g) => `recent score: ${g.assignment.title} ${Number(g.percentage)}%`,
      ),
      ...behaviour.map((b) => `positive note: ${b.title}`),
    ];
    return lines.join('\n');
  }

  private async taughtStudent(studentId: string, actor: AuthenticatedUser) {
    this.staffOnly(actor);
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        gradeLevel: true,
        organizationId: true,
      },
    });
    if (!student)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Student not found.',
      });
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
          detail: "Only this student's teachers draft about them.",
        });
    }
    return student;
  }

  // ---------------------------------------------------------------------------
  // Class insight from tutor traces and the week's numbers
  // ---------------------------------------------------------------------------

  async classInsight(classId: string, actor: AuthenticatedUser) {
    await this.manageableClass(classId, actor);
    const row = await this.prisma.classInsight.findFirst({
      where: { classId },
      orderBy: { weekStart: 'desc' },
    });
    return row ? this.toInsight(row) : null;
  }

  async buildInsight(classId: string, actor: AuthenticatedUser) {
    const klass = await this.manageableClass(classId, actor);
    const now = new Date();
    const { startsAt } = weekWindow(now);
    const previousStart = new Date(startsAt.getTime() - 7 * 86_400_000);
    const members = await this.prisma.classEnrollment.findMany({
      where: { classId, status: 'ENROLLED' },
      select: {
        studentId: true,
        currentGrade: true,
        student: { select: { userId: true } },
      },
    });
    const studentIds = members.map((m) => m.studentId);
    const userIds = members
      .map((m) => m.student.userId)
      .filter((x): x is string => !!x);
    const [
      conversations,
      refusals,
      assignments,
      submissionsThisWeek,
      attendance,
      completions,
    ] = await Promise.all([
      this.prisma.aiConversation.findMany({
        where: {
          userId: { in: userIds },
          createdAt: { gte: previousStart },
          deletedAt: null,
        },
        select: {
          userId: true,
          createdAt: true,
          lessonId: true,
          title: true,
          messageCount: true,
        },
      }),
      this.prisma.aiMessage.count({
        where: {
          status: 'REFUSED',
          createdAt: { gte: startsAt },
          conversation: { userId: { in: userIds } },
        },
      }),
      this.prisma.assignment.findMany({
        where: {
          classId,
          status: 'PUBLISHED',
          deletedAt: null,
          dueAt: { gte: new Date(now.getTime() - 14 * 86_400_000), lt: now },
        },
        select: {
          id: true,
          title: true,
          submissions: { select: { studentId: true } },
          grades: { select: { percentage: true } },
        },
      }),
      this.prisma.assignmentSubmission.count({
        where: { assignment: { classId }, submittedAt: { gte: startsAt } },
      }),
      this.prisma.attendance.findMany({
        where: { classId, date: { gte: startsAt } },
        select: { status: true },
      }),
      this.prisma.lessonCompletion.count({
        where: {
          studentId: { in: studentIds },
          completedAt: { gte: startsAt },
          lesson: { module: { courseId: klass.courseId } },
        },
      }),
    ]);
    const thisWeek = conversations.filter((c) => c.createdAt >= startsAt);
    const lastWeek = conversations.filter((c) => c.createdAt < startsAt);
    const lessonIds = [
      ...new Set(
        thisWeek.map((c) => c.lessonId).filter((x): x is string => !!x),
      ),
    ];
    const lessons = lessonIds.length
      ? await this.prisma.lesson.findMany({
          where: { id: { in: lessonIds } },
          select: { id: true, title: true },
        })
      : [];
    const titleOf = new Map(lessons.map((l) => [l.id, l.title]));
    const topTopics = rankTopics(
      thisWeek.map((c) => ({
        topic: c.lessonId ? (titleOf.get(c.lessonId) ?? c.title) : c.title,
      })),
    );
    let missing = 0;
    const scores: number[] = [];
    for (const a of assignments) {
      const submitted = new Set(a.submissions.map((s) => s.studentId));
      missing += studentIds.filter((s) => !submitted.has(s)).length;
      for (const g of a.grades) scores.push(Number(g.percentage));
    }
    const lowScoring = assignments
      .map((a) => ({
        title: a.title,
        average: a.grades.length
          ? Math.round(
              a.grades.reduce((s, g) => s + Number(g.percentage), 0) /
                a.grades.length,
            )
          : null,
      }))
      .filter((a) => a.average !== null && a.average < 70);
    const present = attendance.filter((a) =>
      ['PRESENT', 'LATE', 'TARDY', 'LEFT_EARLY'].includes(a.status),
    ).length;
    const graded = members.filter((m) => m.currentGrade !== null);
    const data = {
      weekStart: isoDay(startsAt),
      students: studentIds.length,
      tutor: {
        studentsWhoUsedIt: new Set(thisWeek.map((c) => c.userId)).size,
        conversationsThisWeek: thisWeek.length,
        conversationsLastWeek: lastWeek.length,
        refusals,
        topTopics,
      },
      work: {
        assignmentsDueLast14Days: assignments.length,
        missingItems: missing,
        submissionsThisWeek,
        averageScoreRecent: scores.length
          ? Math.round(scores.reduce((s, x) => s + x, 0) / scores.length)
          : null,
        lowScoringAssignments: lowScoring,
      },
      attendance: {
        recordsThisWeek: attendance.length,
        presentRate: attendance.length
          ? Math.round((present / attendance.length) * 100)
          : null,
      },
      classAverage: graded.length
        ? Math.round(
            graded.reduce((s, m) => s + Number(m.currentGrade), 0) /
              graded.length,
          )
        : null,
      lessonsCompletedThisWeek: completions,
    };
    const dataText = insightDataLines(data).join('\n');
    const existing = await this.prisma.classInsight.findUnique({
      where: { classId_weekStart: { classId, weekStart: startsAt } },
    });
    const row = existing
      ? await this.prisma.classInsight.update({
          where: { id: existing.id },
          data: { data: JSON.stringify(data), requestedById: actor.id },
        })
      : await this.prisma.classInsight.create({
          data: {
            id: newId(),
            classId,
            weekStart: startsAt,
            requestedById: actor.id,
            data: JSON.stringify(data),
          },
        });
    const job = await this.content.startText(
      'insight.teacher',
      {
        topic: klass.name,
        subject: klass.course.subject ?? '',
        gradeLevel: klass.course.gradeLevel ?? '7',
        language: 'en',
        classId,
        insightId: row.id,
      },
      {
        courseId: klass.courseId,
        lessonId: null,
        blocks: [{ id: 'D1', label: 'DATA', text: dataText }],
      },
      actor,
      klass.organizationId,
    );
    return { insight: this.toInsight(row), job };
  }

  async practiceSet(id: string, dto: PracticeSetDto, actor: AuthenticatedUser) {
    const insight = await this.prisma.classInsight.findUnique({
      where: { id },
    });
    if (!insight)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Insight not found.',
      });
    const klass = await this.manageableClass(insight.classId, actor);
    const data = parse<{ tutor?: { topTopics?: Array<{ topic: string }> } }>(
      insight.data,
      {},
    );
    const topic =
      dto.topic ?? data.tutor?.topTopics?.[0]?.topic ?? klass.course.title;
    return this.content.generate(
      'content.quiz',
      {
        topic,
        subject: klass.course.subject ?? undefined,
        gradeLevel: klass.course.gradeLevel ?? undefined,
        count: dto.count ?? 5,
        courseId: klass.courseId,
      },
      actor,
    );
  }

  async updateInsight(
    id: string,
    dto: UpdateInsightDto,
    actor: AuthenticatedUser,
  ) {
    const insight = await this.prisma.classInsight.findUnique({
      where: { id },
    });
    if (!insight)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Insight not found.',
      });
    await this.manageableClass(insight.classId, actor);
    const row = await this.prisma.classInsight.update({
      where: { id },
      data: {
        ...(dto.practiceContentId !== undefined
          ? { practiceContentId: dto.practiceContentId }
          : {}),
      },
    });
    return this.toInsight(row);
  }

  private toInsight(row: {
    id: string;
    classId: string;
    weekStart: Date;
    data: string;
    narrative: string | null;
    practiceContentId: string | null;
    aiModel: string | null;
    updatedAt: Date;
  }) {
    return {
      id: row.id,
      classId: row.classId,
      weekStart: isoDay(row.weekStart),
      data: parse<Record<string, unknown>>(row.data, {}),
      narrative: parse<Record<string, unknown> | null>(row.narrative, null),
      practiceContentId: row.practiceContentId,
      aiGenerated: !!row.aiModel,
      updatedAt: row.updatedAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Substitute access
  // ---------------------------------------------------------------------------

  async substitutes(classId: string, actor: AuthenticatedUser) {
    await this.manageableClass(classId, actor);
    const rows = await this.prisma.substituteAccess.findMany({
      where: { classId },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            role: true,
          },
        },
        createdBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { endsAt: 'desc' },
    });
    const now = Date.now();
    return rows.map((r) => ({
      id: r.id,
      user: r.user,
      startsAt: r.startsAt,
      endsAt: r.endsAt,
      note: r.note,
      active: r.startsAt.getTime() <= now && r.endsAt.getTime() > now,
      grantedBy: r.createdBy,
    }));
  }

  /** Teachers and assistants of the school who could stand in (never the directory itself). */
  async substituteCandidates(classId: string, actor: AuthenticatedUser) {
    const klass = await this.manageableClass(classId, actor);
    const rows = await this.prisma.user.findMany({
      where: {
        organizationId: klass.organizationId,
        role: { in: ['TEACHER', 'ASSISTANT'] },
        status: 'ACTIVE',
        deletedAt: null,
        id: { notIn: klass.teachers.map((t) => t.teacherId) },
      },
      select: { id: true, firstName: true, lastName: true, role: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 200,
    });
    return rows.map((r) => ({ ...r, role: r.role.toLowerCase() }));
  }

  async addSubstitute(
    classId: string,
    dto: SubstituteDto,
    actor: AuthenticatedUser,
  ) {
    const klass = await this.manageableClass(classId, actor);
    const startsAt = new Date(dto.startsAt);
    const endsAt = new Date(dto.endsAt);
    if (!validSubstituteWindow(startsAt, endsAt))
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'The access must end after it starts, in the future.',
      });
    const user = await this.prisma.user.findFirst({
      where: {
        id: dto.userId,
        deletedAt: null,
        status: 'ACTIVE',
        role: { in: ['TEACHER', 'ASSISTANT'] },
        organizationId: klass.organizationId,
      },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        role: true,
      },
    });
    if (!user)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Choose an active teacher or assistant of this school.',
      });
    if (klass.teachers.some((t) => t.teacherId === user.id))
      throw new ForbiddenException({
        code: 'assistant.already_teacher',
        detail: `${user.firstName} ${user.lastName} already teaches this class.`,
      });
    const row = await this.prisma.substituteAccess.create({
      data: {
        id: newId(),
        classId,
        userId: user.id,
        createdById: actor.id,
        startsAt,
        endsAt,
        note: dto.note?.trim() || null,
      },
    });
    if (startsAt.getTime() <= Date.now())
      await this.grantTeacherRow(classId, user.id);
    return {
      id: row.id,
      user,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      note: row.note,
      active: startsAt.getTime() <= Date.now(),
    };
  }

  async removeSubstitute(id: string, actor: AuthenticatedUser): Promise<void> {
    const row = await this.prisma.substituteAccess.findUnique({
      where: { id },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Substitute access not found.',
      });
    await this.manageableClass(row.classId, actor);
    await this.prisma.substituteAccess.delete({ where: { id } });
    await this.revokeTeacherRowIfSubstituteOnly(row.classId, row.userId);
  }

  /** Every five minutes: start access that has begun, end access that has expired. */
  @Cron('*/5 * * * *')
  async rollSubstitutes(): Promise<{ started: number; ended: number }> {
    const now = new Date();
    const starting = await this.prisma.substituteAccess.findMany({
      where: { startsAt: { lte: now }, endsAt: { gt: now } },
      select: { classId: true, userId: true },
    });
    let started = 0;
    for (const s of starting)
      if (await this.grantTeacherRow(s.classId, s.userId)) started += 1;
    const ended = await this.prisma.substituteAccess.findMany({
      where: { endsAt: { lte: now } },
    });
    for (const e of ended) {
      await this.prisma.substituteAccess.delete({ where: { id: e.id } });
      await this.revokeTeacherRowIfSubstituteOnly(e.classId, e.userId);
    }
    return { started, ended: ended.length };
  }

  private async grantTeacherRow(
    classId: string,
    userId: string,
  ): Promise<boolean> {
    const existing = await this.prisma.classTeacher.findUnique({
      where: { classId_teacherId: { classId, teacherId: userId } },
    });
    if (existing) return false;
    await this.prisma.classTeacher.create({
      data: { id: newId(), classId, teacherId: userId, isPrimary: false },
    });
    return true;
  }

  private async revokeTeacherRowIfSubstituteOnly(
    classId: string,
    userId: string,
  ): Promise<void> {
    const stillActive = await this.prisma.substituteAccess.count({
      where: { classId, userId, endsAt: { gt: new Date() } },
    });
    if (stillActive > 0) return;
    // Only rows a substitute grant created: never a real co-teacher who was assigned before any grant.
    const earliestGrant = await this.prisma.auditLog.findFirst({
      where: { action: 'classes.substitute.granted', entityId: classId },
      orderBy: { timestamp: 'asc' },
      select: { timestamp: true },
    });
    const row = await this.prisma.classTeacher.findUnique({
      where: { classId_teacherId: { classId, teacherId: userId } },
    });
    if (
      !row ||
      !shouldRevokeTeacherRow({
        stillActiveAccess: stillActive,
        row,
        earliestGrantAt: earliestGrant?.timestamp ?? null,
      })
    )
      return;
    await this.prisma.classTeacher.delete({ where: { id: row.id } });
  }

  // ---------------------------------------------------------------------------
  // Weekly planner
  // ---------------------------------------------------------------------------

  async planner(week: string | undefined, actor: AuthenticatedUser) {
    this.staffOnly(actor);
    const anchor = week ? new Date(`${week}T12:00:00Z`) : new Date();
    const { startsAt, endsAt } = weekWindow(anchor);
    const admin = ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL;
    const classes = await this.prisma.class.findMany({
      where: {
        deletedAt: null,
        ...(admin
          ? isDistrictRole(actor)
            ? {}
            : { organizationId: actor.organizationId ?? '' }
          : { teachers: { some: { teacherId: actor.id } } }),
      },
      select: {
        id: true,
        name: true,
        periodLabel: true,
      },
      orderBy: { name: 'asc' },
      take: 50,
    });
    const classIds = classes.map((c) => c.id);
    const nameOf = new Map(classes.map((c) => [c.id, c.name]));
    const [assignments, plans, feed] = await Promise.all([
      this.prisma.assignment.findMany({
        where: {
          classId: { in: classIds },
          deletedAt: null,
          status: { in: ['PUBLISHED', 'CLOSED'] },
          dueAt: { gte: startsAt, lt: endsAt },
        },
        select: {
          id: true,
          title: true,
          dueAt: true,
          classId: true,
          _count: { select: { submissions: true } },
        },
        orderBy: { dueAt: 'asc' },
      }),
      this.prisma.lessonPlan.findMany({
        where: {
          scheduledOn: { gte: startsAt, lt: endsAt },
          OR: [{ authorId: actor.id }, { classId: { in: classIds } }],
        },
        select: {
          id: true,
          title: true,
          scheduledOn: true,
          classId: true,
          status: true,
          durationMinutes: true,
        },
      }),
      this.calendar
        .feed(
          {
            from: isoDay(startsAt),
            to: isoDay(new Date(endsAt.getTime() - 1)),
          },
          actor,
        )
        .catch(() => []),
    ]);
    type Item = {
      kind: 'assignment' | 'plan' | 'event' | 'term';
      id: string;
      title: string;
      time: string | null;
      classId: string | null;
      className: string | null;
      link: string | null;
      detail: string | null;
    };
    const days = new Map<string, Item[]>();
    for (let i = 0; i < 7; i++)
      days.set(isoDay(new Date(startsAt.getTime() + i * 86_400_000)), []);
    const push = (date: string, item: Item) => {
      if (days.has(date)) days.get(date)!.push(item);
    };
    for (const a of assignments)
      if (a.dueAt)
        push(isoDay(a.dueAt), {
          kind: 'assignment',
          id: a.id,
          title: a.title,
          time: a.dueAt.toISOString().slice(11, 16),
          classId: a.classId,
          className: nameOf.get(a.classId) ?? null,
          link: `/assignments/${a.id}`,
          detail: `${a._count.submissions} submitted`,
        });
    for (const p of plans)
      if (p.scheduledOn)
        push(isoDay(p.scheduledOn), {
          kind: 'plan',
          id: p.id,
          title: p.title,
          time: null,
          classId: p.classId,
          className: p.classId ? (nameOf.get(p.classId) ?? null) : null,
          link: `/assistant?plan=${p.id}`,
          detail: `${p.durationMinutes} min · ${p.status === 'PUBLISHED' ? 'published' : 'draft'}`,
        });
    for (const f of feed)
      if (f.kind !== 'assignment')
        push(f.startsAt.slice(0, 10), {
          kind: f.kind === 'term' ? 'term' : 'event',
          id: f.id,
          title: f.title,
          time: f.allDay ? null : f.startsAt.slice(11, 16),
          classId: f.classId,
          className: f.className,
          link: f.link,
          detail: f.type,
        });
    return {
      weekStart: isoDay(startsAt),
      classes: classes.map((c) => ({
        id: c.id,
        name: c.name,
        period: c.periodLabel ?? null,
      })),
      days: [...days.entries()].map(([date, items]) => ({
        date,
        items: items.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '')),
      })),
    };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private staffOnly(actor: AuthenticatedUser): void {
    if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.TEACHER)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'The teacher assistant is for school staff.',
      });
  }

  private async manageableClass(classId: string, actor: AuthenticatedUser) {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      include: {
        teachers: { select: { teacherId: true } },
        course: {
          select: { id: true, title: true, subject: true, gradeLevel: true },
        },
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
        detail: 'Only the class teachers and administrators use this.',
      });
    return klass;
  }
}
