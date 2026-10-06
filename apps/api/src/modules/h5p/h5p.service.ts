import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { H5PContent, Prisma } from '../../generated/prisma/client';
import { newId } from '../../common/utils/ids';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import {
  assertOrganizationAccess,
  isDistrictRole,
  organizationScope,
  resolveOrganizationId,
} from '../access/scope';
import { AuditService } from '../audit/audit.service';
import { AssignmentsService } from '../assignments/assignments.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  CreateH5pContentDto,
  ListH5pQueryDto,
  RecordResultDto,
  UpdateH5pContentDto,
} from './dto/h5p.dto';
import { H5P_LIBRARIES } from './h5p-libraries';
import {
  buildManifest,
  contentTypeFor,
  maxScoreOf,
  parseLibrary,
  sanitizeParameters,
  signPlayTicket,
  validateParameters,
  verifyPlayTicket,
  type PlayTicket,
} from './h5p-rules';

const TICKET_SECONDS = 15 * 60;

export interface PublicH5pContent {
  id: string;
  organizationId: string;
  title: string;
  library: string;
  contentType: string;
  status: 'draft' | 'published' | 'archived';
  source: 'ai' | 'manual';
  maxScore: number;
  subject: string | null;
  gradeLevel: string | null;
  topic: string | null;
  difficulty: string | null;
  courseId: string | null;
  lessonId: string | null;
  aiModel: string | null;
  promptVersion: string | null;
  createdBy: { id: string; firstName: string; lastName: string } | null;
  assignmentCount: number;
  resultCount: number;
  createdAt: Date;
  updatedAt: Date;
  parameters?: Record<string, unknown>;
  draft?: Record<string, unknown> | null;
  validation?: { valid: boolean; errors: string[] };
}

type Row = H5PContent & {
  createdBy: { id: string; firstName: string; lastName: string } | null;
  _count: { assignments: number; results: number };
};

const isStaff = (actor: AuthenticatedUser) =>
  ROLE_LEVEL[actor.role] >= ROLE_LEVEL.TEACHER;

@Injectable()
export class H5pService {
  private readonly include = {
    createdBy: { select: { id: true, firstName: true, lastName: true } },
    _count: { select: { assignments: true, results: true } },
  } satisfies Prisma.H5PContentInclude;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly assignments: AssignmentsService,
  ) {}

  libraries() {
    return H5P_LIBRARIES.map((l) => ({
      machineName: l.machineName,
      majorVersion: l.major,
      minorVersion: l.minor,
      patchVersion: l.patch,
      title: l.title,
      runnable: l.runnable,
    }));
  }

  async list(
    q: ListH5pQueryDto,
    actor: AuthenticatedUser,
  ): Promise<PublicH5pContent[]> {
    const where: Prisma.H5PContentWhereInput = {
      deletedAt: null,
      ...organizationScope(actor, q.organizationId),
    };
    if (q.status)
      where.status = q.status.toUpperCase() as
        'DRAFT' | 'PUBLISHED' | 'ARCHIVED';
    if (q.contentType) where.contentType = q.contentType;
    if (q.search)
      where.OR = [
        { title: { contains: q.search } },
        { topic: { contains: q.search } },
      ];
    if (!isStaff(actor)) where.status = 'PUBLISHED';
    const rows = await this.prisma.h5PContent.findMany({
      where,
      include: this.include,
      orderBy: { updatedAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => toPublic(r));
  }

  async get(id: string, actor: AuthenticatedUser): Promise<PublicH5pContent> {
    const row = await this.find(id, actor);
    return toPublic(row, true);
  }

  /** Teacher-authored or AI-generated content enters as a draft; a teacher publishes it after review. */
  async create(
    dto: CreateH5pContentDto,
    actor: AuthenticatedUser,
    extra: Partial<
      Pick<
        H5PContent,
        | 'source'
        | 'draft'
        | 'aiModel'
        | 'promptVersion'
        | 'aiJobId'
        | 'difficulty'
      >
    > = {},
  ): Promise<PublicH5pContent> {
    const organizationId = resolveOrganizationId(actor, dto.organizationId);
    const parameters = sanitizeParameters(dto.parameters);
    const errors = validateParameters(dto.library, parameters);
    if (errors.length)
      throw new BadRequestException({
        code: 'h5p.invalid',
        detail: `Content is not playable: ${errors.join('; ')}`,
        errors,
      });
    const row = await this.prisma.h5PContent.create({
      data: {
        id: newId(),
        organizationId,
        createdById: actor.id,
        title: dto.title.trim(),
        library: dto.library.trim(),
        contentType: contentTypeFor(dto.library),
        parameters: JSON.stringify(parameters),
        maxScore: maxScoreOf(dto.library, parameters),
        subject: dto.subject ?? null,
        gradeLevel: dto.gradeLevel ?? null,
        topic: dto.topic ?? null,
        courseId: dto.courseId ?? null,
        lessonId: dto.lessonId ?? null,
        source: extra.source ?? 'MANUAL',
        draft: extra.draft ?? null,
        aiModel: extra.aiModel ?? null,
        promptVersion: extra.promptVersion ?? null,
        aiJobId: extra.aiJobId ?? null,
        difficulty: extra.difficulty ?? null,
      },
      include: this.include,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'h5p.content.create',
      entityType: 'H5PContent',
      entityId: row.id,
      details: { library: row.library, source: row.source },
    });
    return toPublic(row, true);
  }

  async update(
    id: string,
    dto: UpdateH5pContentDto,
    actor: AuthenticatedUser,
  ): Promise<PublicH5pContent> {
    const row = await this.find(id, actor, true);
    const data: Prisma.H5PContentUpdateInput = {};
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.subject !== undefined) data.subject = dto.subject;
    if (dto.gradeLevel !== undefined) data.gradeLevel = dto.gradeLevel;
    if (dto.topic !== undefined) data.topic = dto.topic;
    if (dto.parameters !== undefined) {
      const parameters = sanitizeParameters(dto.parameters);
      const errors = validateParameters(row.library, parameters);
      if (errors.length)
        throw new BadRequestException({
          code: 'h5p.invalid',
          detail: `Content is not playable: ${errors.join('; ')}`,
          errors,
        });
      data.parameters = JSON.stringify(parameters);
      data.maxScore = maxScoreOf(row.library, parameters);
    }
    const updated = await this.prisma.h5PContent.update({
      where: { id },
      data,
      include: this.include,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: 'h5p.content.update',
      entityType: 'H5PContent',
      entityId: id,
      details: { fields: Object.keys(data) },
    });
    return toPublic(updated, true);
  }

  async setStatus(
    id: string,
    status: 'DRAFT' | 'PUBLISHED' | 'ARCHIVED',
    actor: AuthenticatedUser,
  ): Promise<PublicH5pContent> {
    const row = await this.find(id, actor, true);
    if (status === 'PUBLISHED') {
      const errors = validateParameters(
        row.library,
        JSON.parse(row.parameters),
      );
      if (errors.length)
        throw new BadRequestException({
          code: 'h5p.invalid',
          detail: `Fix these before publishing: ${errors.join('; ')}`,
          errors,
        });
    }
    const updated = await this.prisma.h5PContent.update({
      where: { id },
      data: { status },
      include: this.include,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: `h5p.content.${status.toLowerCase()}`,
      entityType: 'H5PContent',
      entityId: id,
    });
    return toPublic(updated, true);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const row = await this.find(id, actor, true);
    const attached = await this.prisma.assignment.count({
      where: { h5pContentId: id, deletedAt: null },
    });
    if (attached > 0)
      throw new BadRequestException({
        code: 'h5p.in_use',
        detail: `This content is attached to ${attached} assignment${attached === 1 ? '' : 's'}. Detach it first.`,
      });
    await this.prisma.h5PContent.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: 'h5p.content.delete',
      entityType: 'H5PContent',
      entityId: id,
    });
  }

  // ---------------------------------------------------------------------------
  // Playing
  // ---------------------------------------------------------------------------

  /** Authorised call: mints a short-lived ticket the browser player uses to fetch the package without a bearer token. */
  async play(id: string, actor: AuthenticatedUser, assignmentId?: string) {
    const row = await this.find(id, actor);
    if (!isStaff(actor) && row.status !== 'PUBLISHED')
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Content not found.',
      });
    if (assignmentId) {
      const assignment = await this.prisma.assignment.findFirst({
        where: { id: assignmentId, h5pContentId: id, deletedAt: null },
        select: { id: true },
      });
      if (!assignment)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'That assignment does not use this content.',
        });
    }
    const ticket: PlayTicket = {
      contentId: id,
      userId: actor.id,
      assignmentId: assignmentId ?? null,
      exp: Math.floor(Date.now() / 1000) + TICKET_SECONDS,
    };
    const token = signPlayTicket(ticket, this.config.get('JWT_SECRET'));
    return {
      ticket: token,
      h5pJsonPath: `/api/v1/h5p/play/${token}`,
      title: row.title,
      library: row.library,
      maxScore: row.maxScore,
      expiresAt: new Date(ticket.exp * 1000),
    };
  }

  async manifest(token: string): Promise<Record<string, unknown>> {
    const row = await this.fromTicket(token);
    return buildManifest(row.title, row.library);
  }

  async contentJson(token: string): Promise<Record<string, unknown>> {
    const row = await this.fromTicket(token);
    return JSON.parse(row.parameters) as Record<string, unknown>;
  }

  private async fromTicket(token: string): Promise<H5PContent> {
    const ticket = verifyPlayTicket(token, this.config.get('JWT_SECRET'));
    if (!ticket)
      throw new UnauthorizedException({
        code: 'h5p.ticket_invalid',
        detail: 'The play ticket is invalid or has expired. Reload the page.',
      });
    const row = await this.prisma.h5PContent.findFirst({
      where: { id: ticket.contentId, deletedAt: null },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Content not found.',
      });
    return row;
  }

  // ---------------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------------

  async recordResult(
    id: string,
    dto: RecordResultDto,
    actor: AuthenticatedUser,
  ) {
    const row = await this.find(id, actor);
    if (dto.score > dto.maxScore)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Score cannot exceed the maximum.',
      });
    if (actor.role === 'PARENT')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Parents can view results but not record them.',
      });
    const student =
      actor.role === 'STUDENT'
        ? await this.prisma.student.findFirst({
            where: { userId: actor.id, deletedAt: null },
            select: { id: true },
          })
        : null;
    let posted: Awaited<
      ReturnType<AssignmentsService['recordExternalResult']>
    > | null = null;
    if (dto.assignmentId) {
      if (actor.role !== 'STUDENT')
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'Only students post results to an assignment.',
        });
      posted = await this.assignments.recordExternalResult(
        dto.assignmentId,
        id,
        { score: dto.score, maxScore: dto.maxScore, detail: dto.detail },
        actor,
      );
    }
    const result = await this.prisma.h5PContentResult.create({
      data: {
        id: newId(),
        contentId: id,
        userId: actor.id,
        studentId: student?.id ?? null,
        assignmentId: dto.assignmentId ?? null,
        score: dto.score,
        maxScore: dto.maxScore,
        completed: dto.completed ?? true,
        timeSpentSeconds: dto.timeSpentSeconds ?? null,
        detail: dto.detail ? JSON.stringify(dto.detail).slice(0, 20_000) : null,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: 'h5p.result.record',
      entityType: 'H5PContentResult',
      entityId: result.id,
      details: {
        contentId: id,
        score: dto.score,
        maxScore: dto.maxScore,
        assignmentId: dto.assignmentId ?? null,
      },
    });
    return {
      id: result.id,
      score: Number(result.score),
      maxScore: Number(result.maxScore),
      percentage:
        Number(result.maxScore) > 0
          ? Math.round(
              (Number(result.score) / Number(result.maxScore)) * 10000,
            ) / 100
          : 0,
      completed: result.completed,
      createdAt: result.createdAt,
      submission: posted?.submission ?? null,
      grade: posted?.grade ?? null,
    };
  }

  async results(id: string, actor: AuthenticatedUser) {
    const row = await this.find(id, actor);
    const where: Prisma.H5PContentResultWhereInput = { contentId: row.id };
    if (!isStaff(actor)) where.userId = actor.id;
    const rows = await this.prisma.h5PContentResult.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        user: { select: { id: true, firstName: true, lastName: true } },
        student: { select: { id: true, studentNumber: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      user: r.user,
      student: r.student,
      assignmentId: r.assignmentId,
      score: Number(r.score),
      maxScore: Number(r.maxScore),
      percentage:
        Number(r.maxScore) > 0
          ? Math.round((Number(r.score) / Number(r.maxScore)) * 10000) / 100
          : 0,
      completed: r.completed,
      timeSpentSeconds: r.timeSpentSeconds,
      createdAt: r.createdAt,
    }));
  }

  // ---------------------------------------------------------------------------

  private async find(
    id: string,
    actor: AuthenticatedUser,
    mustEdit = false,
  ): Promise<Row> {
    const row = await this.prisma.h5PContent.findFirst({
      where: { id, deletedAt: null },
      include: this.include,
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Content not found.',
      });
    if (!isDistrictRole(actor))
      assertOrganizationAccess(actor, row.organizationId);
    if (mustEdit && !isStaff(actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only staff edit interactive content.',
      });
    if (!isStaff(actor) && row.status !== 'PUBLISHED')
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Content not found.',
      });
    return row;
  }
}

export function toPublic(r: Row, full = false): PublicH5pContent {
  const out: PublicH5pContent = {
    id: r.id,
    organizationId: r.organizationId,
    title: r.title,
    library: r.library,
    contentType: r.contentType,
    status: r.status.toLowerCase() as PublicH5pContent['status'],
    source: r.source.toLowerCase() as PublicH5pContent['source'],
    maxScore: r.maxScore,
    subject: r.subject,
    gradeLevel: r.gradeLevel,
    topic: r.topic,
    difficulty: r.difficulty,
    courseId: r.courseId,
    lessonId: r.lessonId,
    aiModel: r.aiModel,
    promptVersion: r.promptVersion,
    createdBy: r.createdBy,
    assignmentCount: r._count.assignments,
    resultCount: r._count.results,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
  if (full) {
    const parameters = JSON.parse(r.parameters) as Record<string, unknown>;
    out.parameters = parameters;
    out.draft = r.draft
      ? (JSON.parse(r.draft) as Record<string, unknown>)
      : null;
    const errors = validateParameters(r.library, parameters);
    out.validation = { valid: errors.length === 0, errors };
  }
  return out;
}

export { parseLibrary };
