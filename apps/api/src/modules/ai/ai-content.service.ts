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

export type ContentCapability = 'content.quiz' | 'content.flashcards';

export interface PublicJob {
  id: string;
  capability: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: string | null;
  contentId: string | null;
  content?: PublicH5pContent | null;
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
    const content = job.resultContentId
      ? await this.h5p.get(job.resultContentId, actor).catch(() => null)
      : null;
    return toPublicJob(job, content);
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
}

function toPublicJob(job: AiJob, content: PublicH5pContent | null): PublicJob {
  return {
    id: job.id,
    capability: job.capability,
    status: job.status.toLowerCase() as PublicJob['status'],
    progress: job.progress,
    contentId: job.resultContentId,
    content,
    error: job.errorCode
      ? { code: job.errorCode, detail: job.errorDetail ?? '' }
      : null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}
