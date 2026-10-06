import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AiJob } from '../../generated/prisma/client';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import {
  assertOrganizationAccess,
  isDistrictRole,
  resolveOrganizationId,
} from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { H5pService, type PublicH5pContent } from '../h5p/h5p.service';
import {
  AiClient,
  type ContentJobSnapshot,
  type ContentRequest,
} from './ai.client';
import { GenerateContentDto, RegenerateDto } from './dto/ai-content.dto';

export type ContentCapability =
  | 'content.quiz'
  | 'content.flashcards'
  | 'content.summary'
  | 'content.conference'
  | 'content.lesson_plan'
  | 'content.parent_email'
  | 'content.narrative'
  | 'content.differentiation'
  | 'grading.rubric'
  | 'insight.teacher';
const TEXT_CAPABILITIES: readonly ContentCapability[] = [
  'content.summary',
  'content.conference',
  'content.lesson_plan',
  'content.parent_email',
  'content.narrative',
  'content.differentiation',
  'grading.rubric',
  'insight.teacher',
];
const DRAFT_KINDS: Partial<Record<ContentCapability, string>> = {
  'content.parent_email': 'parent_email',
  'content.narrative': 'narrative',
  'content.differentiation': 'differentiation',
};

export interface PublicJob {
  id: string;
  capability: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: string | null;
  contentId: string | null;
  content?: PublicH5pContent | null;
  /** Text jobs: the id of the lesson summary or conference note the draft became. */
  resultId: string | null;
  error: { code: string; detail: string } | null;
  createdAt: Date;
  updatedAt: Date;
}

const CAPABILITY_BY_TYPE: Record<string, ContentCapability> = {
  quiz: 'content.quiz',
  flashcards: 'content.flashcards',
};

/**
 * Teacher-facing content generation: the AI service runs the job; this service owns the record, turns a finished
 * job into a reviewable H5P draft, and never shows students anything until a teacher publishes it (docs/10 section 7).
 */
@Injectable()
export class AiContentService {
  private readonly logger = new Logger(AiContentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClient,
    private readonly audit: AuditService,
    private readonly h5p: H5pService,
  ) {}

  async generate(
    capability: ContentCapability,
    dto: GenerateContentDto,
    actor: AuthenticatedUser,
  ): Promise<PublicJob> {
    const organizationId = resolveOrganizationId(actor, dto.organizationId);
    const blocks: ContentRequest['context']['blocks'] = [];
    let courseId = dto.courseId ?? null;
    if (dto.lessonId) {
      const lesson = await this.prisma.lesson.findFirst({
        where: {
          id: dto.lessonId,
          module: { course: { organizationId, deletedAt: null } },
        },
        include: {
          module: {
            select: {
              courseId: true,
              title: true,
              course: {
                select: { title: true, subject: true, gradeLevel: true },
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
      courseId = courseId ?? lesson.module.courseId;
      if (lesson.content)
        blocks.push({
          id: 'C1',
          label: `Lesson: ${lesson.title}`,
          text: lesson.content.slice(0, 8000),
        });
      dto.subject = dto.subject ?? lesson.module.course.subject ?? undefined;
      dto.gradeLevel =
        dto.gradeLevel ?? lesson.module.course.gradeLevel ?? undefined;
    }
    const request: ContentRequest = {
      traceId: newId(),
      capability,
      organizationId,
      actor: {
        userId: actor.id,
        role: actor.role.toLowerCase(),
        ageBand: 'adult',
      },
      request: {
        topic: dto.topic.trim(),
        subject: dto.subject ?? '',
        gradeLevel: dto.gradeLevel ?? '7',
        count: dto.count ?? 10,
        difficulty: dto.difficulty ?? 'mixed',
        questionTypes: dto.questionTypes ?? ['multiple_choice', 'true_false'],
        language: 'en',
        standard: dto.standard ?? null,
      },
      context: { courseId, lessonId: dto.lessonId ?? null, blocks },
    };
    return this.start(request, actor);
  }

  /** A new draft from the teacher's feedback and the previous draft; the original content stays untouched. */
  async regenerate(
    contentId: string,
    dto: RegenerateDto,
    actor: AuthenticatedUser,
  ): Promise<PublicJob> {
    const content = await this.h5p.get(contentId, actor);
    const capability = CAPABILITY_BY_TYPE[content.contentType];
    if (!capability || !content.draft)
      throw new ForbiddenException({
        code: 'ai.not_regenerable',
        detail: 'Only AI-generated quizzes and flashcards can be regenerated.',
      });
    const request: ContentRequest = {
      traceId: newId(),
      capability,
      organizationId: content.organizationId,
      actor: {
        userId: actor.id,
        role: actor.role.toLowerCase(),
        ageBand: 'adult',
      },
      request: {
        topic: content.topic ?? content.title,
        subject: content.subject ?? '',
        gradeLevel: content.gradeLevel ?? '7',
        count: Math.min(30, Math.max(3, content.maxScore)),
        difficulty: content.difficulty ?? 'mixed',
        questionTypes: ['multiple_choice', 'true_false', 'fill_blank'],
        language: 'en',
        standard: null,
        feedback: dto.feedback.trim(),
        previousDraft: content.draft,
      },
      context: {
        courseId: content.courseId,
        lessonId: content.lessonId,
        blocks: [],
      },
    };
    return this.start(request, actor);
  }

  async get(id: string, actor: AuthenticatedUser): Promise<PublicJob> {
    let job = await this.prisma.aiJob.findUnique({ where: { id } });
    if (
      !job ||
      (job.userId !== actor.id &&
        !(
          ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL &&
          (isDistrictRole(actor) || job.organizationId === actor.organizationId)
        ))
    ) {
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Job not found.',
      });
    }
    if (job.status === 'QUEUED' || job.status === 'RUNNING')
      job = await this.refresh(job, actor);
    const content =
      job.resultContentId &&
      !TEXT_CAPABILITIES.includes(job.capability as ContentCapability)
        ? await this.h5p.get(job.resultContentId, actor).catch(() => null)
        : null;
    return toPublicJob(job, content);
  }

  /**
   * A text job (family lesson summary, conference talking points): same pipeline as quizzes, but the
   * finished draft becomes a lesson summary or a conference note instead of H5P content.
   */
  async startText(
    capability: Exclude<
      ContentCapability,
      'content.quiz' | 'content.flashcards'
    >,
    spec: {
      topic: string;
      subject: string;
      gradeLevel: string;
      language: string;
      lessonId?: string;
      studentId?: string;
      classId?: string;
      courseId?: string;
      submissionId?: string;
      assignmentId?: string;
      insightId?: string;
      durationMinutes?: number;
      purpose?: string;
      tone?: string;
      standard?: string | null;
    },
    context: ContentRequest['context'],
    actor: AuthenticatedUser,
    organizationId: string | null,
  ): Promise<PublicJob> {
    const request: ContentRequest = {
      traceId: newId(),
      capability,
      organizationId,
      actor: {
        userId: actor.id,
        role: actor.role.toLowerCase(),
        ageBand: 'adult',
      },
      request: {
        topic: spec.topic,
        subject: spec.subject,
        gradeLevel: spec.gradeLevel,
        language: spec.language,
        standard: spec.standard ?? null,
        lessonId: spec.lessonId,
        studentId: spec.studentId,
        classId: spec.classId,
        courseId: spec.courseId,
        submissionId: spec.submissionId,
        assignmentId: spec.assignmentId,
        insightId: spec.insightId,
        durationMinutes: spec.durationMinutes,
        purpose: spec.purpose,
        tone: spec.tone,
      },
      context,
    };
    return this.start(request, actor);
  }

  private async start(
    request: ContentRequest,
    actor: AuthenticatedUser,
  ): Promise<PublicJob> {
    if (request.organizationId)
      assertOrganizationAccess(actor, request.organizationId);
    const accepted = await this.ai.contentGenerate(request);
    const job = await this.prisma.aiJob.create({
      data: {
        id: newId(),
        organizationId: request.organizationId,
        userId: actor.id,
        capability: request.capability,
        status: accepted.status === 'done' ? 'RUNNING' : 'QUEUED',
        aiJobId: accepted.jobId,
        traceId: request.traceId,
        request: JSON.stringify(request.request),
        progress: 'Queued',
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: request.organizationId,
      action: 'ai.content.generate',
      entityType: 'AiJob',
      entityId: job.id,
      details: {
        capability: request.capability,
        topic: request.request.topic,
        traceId: request.traceId,
      },
    });
    return this.get(job.id, actor);
  }

  /** Polls the AI service and, when the job finished, persists the draft as H5P content exactly once. */
  private async refresh(job: AiJob, actor: AuthenticatedUser): Promise<AiJob> {
    let snapshot: ContentJobSnapshot | null;
    try {
      snapshot = job.aiJobId ? await this.ai.job(job.aiJobId) : null;
    } catch (err) {
      this.logger.warn(
        `Job ${job.id}: AI service unreachable (${err instanceof Error ? err.message : String(err)})`,
      );
      return job;
    }
    if (!snapshot) {
      return this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorCode: 'ai.job_lost',
          errorDetail: 'The AI service no longer has this job. Generate again.',
        },
      });
    }
    if (snapshot.status === 'queued' || snapshot.status === 'running') {
      return this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: snapshot.status === 'running' ? 'RUNNING' : 'QUEUED',
          progress: snapshot.progress ?? null,
        },
      });
    }
    if (snapshot.status === 'failed' || !snapshot.result) {
      return this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          progress: snapshot.progress ?? null,
          errorCode: snapshot.error?.code ?? 'ai.error',
          errorDetail: snapshot.error?.detail ?? 'Generation failed.',
        },
      });
    }
    const spec = JSON.parse(job.request) as ContentRequest['request'];
    const r = snapshot.result;
    if (
      TEXT_CAPABILITIES.includes(job.capability as ContentCapability) ||
      !r.h5p
    ) {
      const resultId = await this.persistText(job, spec, r);
      return this.prisma.aiJob.update({
        where: { id: job.id },
        data: {
          status: 'DONE',
          progress: r.cached ? 'Served from cache' : 'Done',
          resultContentId: resultId,
        },
      });
    }
    const content = await this.h5p.create(
      {
        title: r.h5p.title,
        library: r.h5p.library,
        parameters: r.h5p.params,
        subject: spec.subject || undefined,
        gradeLevel: spec.gradeLevel || undefined,
        topic: spec.topic,
        organizationId: job.organizationId ?? undefined,
      },
      actor,
      {
        source: 'AI',
        draft: JSON.stringify(r.draft),
        aiModel: `${r.model.provider}:${r.model.name}`,
        promptVersion: r.promptVersion,
        aiJobId: job.id,
        difficulty: spec.difficulty ?? null,
      },
    );
    return this.prisma.aiJob.update({
      where: { id: job.id },
      data: {
        status: 'DONE',
        progress: r.cached ? 'Served from cache' : 'Done',
        resultContentId: content.id,
      },
    });
  }

  /** Stores a finished text draft where it belongs; the AI label and model travel with it. */
  private async persistText(
    job: AiJob,
    spec: ContentRequest['request'],
    r: NonNullable<ContentJobSnapshot['result']>,
  ): Promise<string | null> {
    const draft = r.draft;
    const str = (k: string) => (typeof draft[k] === 'string' ? draft[k] : '');
    const arr = (k: string) =>
      Array.isArray(draft[k])
        ? (draft[k] as unknown[]).filter(
            (x): x is string => typeof x === 'string',
          )
        : [];
    const model = `${r.model.provider}:${r.model.name}`;
    if (job.capability === 'content.summary' && spec.lessonId) {
      const data = {
        title: str('title') || spec.topic,
        summary: str('summary'),
        keyIdeas: JSON.stringify(arr('keyIdeas')),
        questions: JSON.stringify(arr('questionsToAsk')),
        tryAtHome: JSON.stringify(arr('tryAtHome')),
        aiModel: model,
        promptVersion: r.promptVersion,
        aiJobId: job.id,
        status: 'DRAFT' as const,
        reviewedById: null,
        releasedAt: null,
      };
      const row = await this.prisma.lessonSummary.upsert({
        where: {
          lessonId_language: {
            lessonId: spec.lessonId,
            language: spec.language,
          },
        },
        create: {
          id: newId(),
          lessonId: spec.lessonId,
          language: spec.language,
          ...data,
        },
        update: data,
      });
      return row.id;
    }
    if (job.capability === 'content.conference' && spec.studentId) {
      const row = await this.prisma.conferenceNote.create({
        data: {
          id: newId(),
          studentId: spec.studentId,
          authorId: job.userId,
          language: spec.language,
          content: JSON.stringify(draft),
          aiModel: model,
          promptVersion: r.promptVersion,
          aiJobId: job.id,
        },
      });
      return row.id;
    }
    if (job.capability === 'content.lesson_plan') {
      const row = await this.prisma.lessonPlan.create({
        data: {
          id: newId(),
          organizationId: job.organizationId ?? '',
          authorId: job.userId,
          classId: spec.classId ?? null,
          courseId: spec.courseId ?? null,
          lessonId: spec.lessonId ?? null,
          title: str('title') || spec.topic,
          topic: spec.topic,
          durationMinutes: spec.durationMinutes ?? 45,
          gradeLevel: spec.gradeLevel || null,
          subject: spec.subject || null,
          standardCodes: spec.standard ?? null,
          content: JSON.stringify(draft),
          aiModel: model,
          promptVersion: r.promptVersion,
          aiJobId: job.id,
        },
      });
      return row.id;
    }
    const kind = DRAFT_KINDS[job.capability as ContentCapability];
    if (kind) {
      const row = await this.prisma.teacherDraft.create({
        data: {
          id: newId(),
          organizationId: job.organizationId ?? '',
          authorId: job.userId,
          kind,
          studentId: spec.studentId ?? null,
          lessonId: spec.lessonId ?? null,
          classId: spec.classId ?? null,
          language: spec.language,
          title: str('subject') || str('title') || spec.topic,
          content: JSON.stringify(draft),
          aiModel: model,
          promptVersion: r.promptVersion,
          aiJobId: job.id,
        },
      });
      return row.id;
    }
    if (job.capability === 'insight.teacher' && spec.insightId) {
      const row = await this.prisma.classInsight.update({
        where: { id: spec.insightId },
        data: {
          narrative: JSON.stringify(draft),
          aiModel: model,
          promptVersion: r.promptVersion,
          aiJobId: job.id,
        },
      });
      return row.id;
    }
    if (job.capability === 'grading.rubric' && spec.submissionId) {
      const submission = await this.prisma.assignmentSubmission.findUnique({
        where: { id: spec.submissionId },
        select: { assignmentId: true, studentId: true },
      });
      if (!submission) return null;
      const criteria = Array.isArray(draft.criteria)
        ? (draft.criteria as Array<{ confidence?: number }>)
        : [];
      const overall = (draft.overall ?? {}) as {
        score?: number;
        maxPoints?: number;
      };
      const confidence = criteria.length
        ? Math.min(...criteria.map((c) => Number(c.confidence ?? 0)))
        : 0;
      const data = {
        assignmentId: submission.assignmentId,
        studentId: submission.studentId,
        requestedById: job.userId,
        content: JSON.stringify(draft),
        score: Number(overall.score ?? 0),
        maxPoints: Number(overall.maxPoints ?? 0),
        confidence: Math.round(confidence * 100) / 100,
        needsHumanReview: draft.needsHumanReview !== false,
        flag: typeof draft.flag === 'string' ? draft.flag : null,
        status: 'PENDING' as const,
        reviewedById: null,
        reviewedAt: null,
        aiModel: model,
        promptVersion: r.promptVersion,
        aiJobId: job.id,
      };
      const row = await this.prisma.gradingSuggestion.upsert({
        where: { submissionId: spec.submissionId },
        create: { id: newId(), submissionId: spec.submissionId, ...data },
        update: data,
      });
      return row.id;
    }
    return null;
  }
}

function toPublicJob(job: AiJob, content: PublicH5pContent | null): PublicJob {
  return {
    id: job.id,
    capability: job.capability,
    status: job.status.toLowerCase() as PublicJob['status'],
    progress: job.progress,
    contentId: content ? job.resultContentId : null,
    content,
    resultId: job.resultContentId,
    error: job.errorCode
      ? { code: job.errorCode, detail: job.errorDetail ?? '' }
      : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
