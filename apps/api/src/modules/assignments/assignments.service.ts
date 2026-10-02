import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  Assignment,
  AssignmentStatus,
  AssignmentSubmission,
  AssignmentType,
  Grade,
  Prisma,
  SubmissionType,
} from '../../generated/prisma/client';
import { PagedResponse } from '../../common/dto/paged-response.dto';
import { domainEvent } from '../../common/events/domain-event';
import { toCsv } from '../../common/utils/csv';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import { assertOrganizationAccess, organizationScope } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canManage } from '../classes/classes.service';
import { FilesService, type PublicFile } from '../files/files.service';
import { parseDate } from '../students/students.mapper';
import {
  CreateAssignmentDto,
  GradeSubmissionDto,
  ListAssignmentsQuery,
  SubmitDto,
  UpdateAssignmentDto,
  type AssignmentStatusApi,
  type AssignmentTypeApi,
  type SubmissionTypeApi,
} from './dto/assignments.dto';
import {
  applyLatePenalty,
  buildGradebook,
  letterGrade,
  percentageOf,
  submissionWindow,
} from './grading-rules';
import {
  RubricsService,
  parseCriteria,
  type RubricCriterion,
} from './rubrics.service';

export interface PublicAssignment {
  id: string;
  organizationId: string;
  classId: string;
  className: string;
  courseTitle: string;
  createdById: string | null;
  title: string;
  description: string | null;
  instructions: string | null;
  type: AssignmentTypeApi;
  submissionType: SubmissionTypeApi;
  category: string | null;
  maxPoints: number;
  weight: number;
  availableFrom: Date | null;
  dueAt: Date | null;
  allowLateUntil: Date | null;
  latePenaltyPercent: number | null;
  maxAttempts: number | null;
  rubricId: string | null;
  rubric: { id: string; title: string; criteria: RubricCriterion[] } | null;
  h5pContentId: string | null;
  h5pContent: {
    id: string;
    title: string;
    library: string;
    maxScore: number;
    status: string;
  } | null;
  status: AssignmentStatusApi;
  publishedAt: Date | null;
  canManage: boolean;
  submissionCount: number;
  gradedCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicSubmission {
  id: string;
  assignmentId: string;
  studentId: string;
  student: {
    id: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
  };
  attemptNumber: number;
  status: string;
  textContent: string | null;
  isLate: boolean;
  submittedAt: Date;
  files: PublicFile[];
  grade: PublicGrade | null;
}

export interface PublicGrade {
  id: string;
  assignmentId: string;
  studentId: string;
  submissionId: string | null;
  gradedById: string | null;
  score: number;
  maxPoints: number;
  percentage: number;
  letterGrade: string | null;
  feedback: string | null;
  rubricScores: Array<{
    criterionId: string;
    points: number;
    comment?: string;
  }> | null;
  latePenaltyApplied: number | null;
  gradedAt: Date;
  assignment?: {
    id: string;
    title: string;
    classId: string;
    className: string;
    dueAt: Date | null;
    category: string | null;
  };
  student?: {
    id: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
  };
}

type AssignmentRow = Assignment & {
  class: {
    id: string;
    name: string;
    organizationId: string;
    course: { title: string };
    teachers: Array<{ teacherId: string }>;
  };
  rubric: { id: string; title: string; criteria: string } | null;
  h5pContent: {
    id: string;
    title: string;
    library: string;
    maxScore: number;
    status: string;
  } | null;
  _count: { submissions: number; grades: number };
};

const SORTABLE = ['dueAt', 'title', 'createdAt', 'publishedAt'] as const;

@Injectable()
export class AssignmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FilesService,
    private readonly rubrics: RubricsService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Assignments
  // ---------------------------------------------------------------------------

  async list(
    q: ListAssignmentsQuery,
    actor: AuthenticatedUser,
  ): Promise<
    PagedResponse<
      PublicAssignment & {
        mySubmission?: {
          status: string;
          attemptNumber: number;
          submittedAt: Date;
        } | null;
        myGrade?: {
          score: number;
          maxPoints: number;
          percentage: number;
        } | null;
      }
    >
  > {
    const where: Prisma.AssignmentWhereInput = {
      deletedAt: null,
      ...organizationScope(actor),
      ...this.visibility(actor),
      ...(q.classId ? { classId: q.classId } : {}),
      ...(q.type ? { type: q.type.toUpperCase() as AssignmentType } : {}),
      ...(q.status
        ? { status: q.status.toUpperCase() as AssignmentStatus }
        : {}),
      ...(q.dueBefore || q.dueAfter
        ? {
            dueAt: {
              ...(q.dueBefore ? { lte: new Date(q.dueBefore) } : {}),
              ...(q.dueAfter ? { gte: new Date(q.dueAfter) } : {}),
            },
          }
        : {}),
      ...(q.search ? { title: { contains: q.search } } : {}),
    };
    const orderBy = q.orderBy(SORTABLE).map((o) => ({
      [o.field]: o.direction,
    })) as Prisma.AssignmentOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.prisma.assignment.findMany({
        where,
        orderBy: orderBy.length
          ? orderBy
          : [{ dueAt: 'asc' }, { createdAt: 'desc' }],
        skip: q.skip,
        take: q.pageSize,
        include: this.include,
      }),
      this.prisma.assignment.count({ where }),
    ]);
    const data = rows.map((r) => toPublic(r, actor));
    if (isLearnerSide(actor) && rows.length) {
      const studentIds = await this.ownStudentIds(actor);
      const ids = rows.map((r) => r.id);
      const [subs, grades] = await Promise.all([
        this.prisma.assignmentSubmission.findMany({
          where: { assignmentId: { in: ids }, studentId: { in: studentIds } },
          orderBy: { attemptNumber: 'desc' },
        }),
        this.prisma.grade.findMany({
          where: { assignmentId: { in: ids }, studentId: { in: studentIds } },
        }),
      ]);
      for (const a of data) {
        const s = subs.find((x) => x.assignmentId === a.id);
        const g = grades.find((x) => x.assignmentId === a.id);
        Object.assign(a, {
          mySubmission: s
            ? {
                status: s.status.toLowerCase(),
                attemptNumber: s.attemptNumber,
                submittedAt: s.submittedAt,
              }
            : null,
          myGrade: g
            ? {
                score: Number(g.score),
                maxPoints: Number(g.maxPoints),
                percentage: Number(g.percentage),
              }
            : null,
        });
      }
    }
    return PagedResponse.of(data, q, total);
  }

  async get(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<PublicAssignment & { mySubmissions?: PublicSubmission[] }> {
    const row = await this.find(id, actor);
    const result: PublicAssignment & { mySubmissions?: PublicSubmission[] } =
      toPublic(row, actor);
    if (isLearnerSide(actor)) {
      const studentIds = await this.ownStudentIds(actor);
      const subs = await this.prisma.assignmentSubmission.findMany({
        where: { assignmentId: id, studentId: { in: studentIds } },
        orderBy: { attemptNumber: 'desc' },
        include: this.submissionInclude,
      });
      result.mySubmissions = subs.map(toPublicSubmission);
    }
    return result;
  }

  async create(
    dto: CreateAssignmentDto,
    actor: AuthenticatedUser,
  ): Promise<PublicAssignment> {
    const klass = await this.manageableClass(dto.classId, actor);
    if (dto.rubricId) await this.rubrics.find(dto.rubricId, actor);
    if (dto.h5pContentId) await this.assertContent(dto.h5pContentId, actor);
    const dates = this.datesFrom(dto);
    const row = await this.prisma.assignment.create({
      data: {
        id: newId(),
        organizationId: klass.organizationId,
        classId: klass.id,
        createdById: actor.id,
        title: dto.title.trim(),
        description: dto.description,
        instructions: dto.instructions,
        type:
          (dto.type?.toUpperCase() as AssignmentType | undefined) ?? 'HOMEWORK',
        submissionType:
          (dto.submissionType?.toUpperCase() as SubmissionType | undefined) ??
          'ONLINE',
        category: dto.category,
        maxPoints: dto.maxPoints ?? 100,
        weight: dto.weight ?? 1,
        ...dates,
        latePenaltyPercent: dto.latePenaltyPercent,
        maxAttempts: dto.maxAttempts,
        rubricId: dto.rubricId,
        h5pContentId: dto.h5pContentId,
      },
      include: this.include,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: klass.organizationId,
      action: 'assignments.create',
      entityType: 'Assignment',
      entityId: row.id,
      details: { classId: klass.id },
    });
    this.events.emit(
      'assignment.created',
      domainEvent({
        eventType: 'assignment.created',
        entityType: 'Assignment',
        entityId: row.id,
        organizationId: klass.organizationId,
        actorId: actor.id,
        data: { classId: klass.id, title: row.title },
      }),
    );
    return toPublic(row, actor);
  }

  async update(
    id: string,
    dto: UpdateAssignmentDto,
    actor: AuthenticatedUser,
  ): Promise<PublicAssignment> {
    const existing = await this.findManageable(id, actor);
    if (dto.classId && dto.classId !== existing.classId)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'An assignment cannot move to another class.',
      });
    if (dto.rubricId) await this.rubrics.find(dto.rubricId, actor);
    if (dto.h5pContentId) await this.assertContent(dto.h5pContentId, actor);
    const row = await this.prisma.assignment.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        description: dto.description,
        instructions: dto.instructions,
        type: dto.type ? (dto.type.toUpperCase() as AssignmentType) : undefined,
        submissionType: dto.submissionType
          ? (dto.submissionType.toUpperCase() as SubmissionType)
          : undefined,
        category: dto.category,
        maxPoints: dto.maxPoints,
        weight: dto.weight,
        ...this.datesFrom(dto),
        latePenaltyPercent: dto.latePenaltyPercent,
        maxAttempts: dto.maxAttempts,
        rubricId: dto.rubricId,
        h5pContentId: dto.h5pContentId,
      },
      include: this.include,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: existing.organizationId,
      action: 'assignments.update',
      entityType: 'Assignment',
      entityId: id,
      details: { fields: Object.keys(dto) },
    });
    return toPublic(row, actor);
  }

  async setStatus(
    id: string,
    status: 'PUBLISHED' | 'CLOSED',
    actor: AuthenticatedUser,
  ): Promise<PublicAssignment> {
    const existing = await this.findManageable(id, actor);
    const row = await this.prisma.assignment.update({
      where: { id },
      data: {
        status,
        publishedAt:
          status === 'PUBLISHED'
            ? (existing.publishedAt ?? new Date())
            : existing.publishedAt,
      },
      include: this.include,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: existing.organizationId,
      action:
        status === 'PUBLISHED' ? 'assignments.publish' : 'assignments.close',
      entityType: 'Assignment',
      entityId: id,
    });
    return toPublic(row, actor);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.findManageable(id, actor);
    if (existing._count.grades > 0)
      throw new ConflictException({
        code: 'assignment.graded',
        detail: 'This assignment has grades. Close it instead of deleting it.',
      });
    await this.prisma.assignment.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'CLOSED' },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: existing.organizationId,
      action: 'assignments.delete',
      entityType: 'Assignment',
      entityId: id,
    });
  }

  // ---------------------------------------------------------------------------
  // Submissions and grading
  // ---------------------------------------------------------------------------

  /** Teacher view: every enrolled student with their latest submission and grade. */
  async submissions(
    assignmentId: string,
    actor: AuthenticatedUser,
  ): Promise<
    Array<{
      student: PublicSubmission['student'];
      submission: PublicSubmission | null;
      grade: PublicGrade | null;
    }>
  > {
    const assignment = await this.findManageable(assignmentId, actor);
    const [enrolled, subs, grades] = await Promise.all([
      this.prisma.classEnrollment.findMany({
        where: {
          classId: assignment.classId,
          status: { in: ['ENROLLED', 'COMPLETED'] },
        },
        include: {
          student: {
            select: {
              id: true,
              studentNumber: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { student: { lastName: 'asc' } },
      }),
      this.prisma.assignmentSubmission.findMany({
        where: { assignmentId },
        orderBy: { attemptNumber: 'desc' },
        include: this.submissionInclude,
      }),
      this.prisma.grade.findMany({ where: { assignmentId } }),
    ]);
    return enrolled.map((e) => {
      const latest = subs.find((s) => s.studentId === e.studentId);
      const grade = grades.find((g) => g.studentId === e.studentId);
      return {
        student: e.student,
        submission: latest ? toPublicSubmission(latest) : null,
        grade: grade ? toPublicGrade(grade) : null,
      };
    });
  }

  async submit(
    assignmentId: string,
    dto: SubmitDto,
    actor: AuthenticatedUser,
  ): Promise<PublicSubmission> {
    if (actor.role !== 'STUDENT')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only students submit work.',
      });
    const student = await this.prisma.student.findFirst({
      where: { userId: actor.id, deletedAt: null },
      select: { id: true },
    });
    if (!student)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Your account is not linked to a student record.',
      });
    const assignment = await this.prisma.assignment.findFirst({
      where: {
        id: assignmentId,
        deletedAt: null,
        class: {
          enrollments: {
            some: {
              studentId: student.id,
              status: { in: ['ENROLLED', 'COMPLETED'] },
            },
          },
        },
      },
      include: this.include,
    });
    if (!assignment)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Assignment not found.',
      });
    if (
      assignment.submissionType !== 'ONLINE' &&
      assignment.submissionType !== 'EXTERNAL'
    ) {
      throw new BadRequestException({
        code: 'assignment.no_online_submission',
        detail: 'This assignment is not submitted online.',
      });
    }
    const now = new Date();
    const window = submissionWindow({
      now,
      status: assignment.status,
      availableFrom: assignment.availableFrom,
      dueAt: assignment.dueAt,
      allowLateUntil: assignment.allowLateUntil,
    });
    if (!window.accepted)
      throw new BadRequestException({
        code: 'assignment.not_accepting',
        detail: window.reason ?? 'Submissions are not accepted.',
      });
    if (!dto.textContent?.trim() && !dto.fileIds?.length)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Add some text or attach at least one file.',
      });
    const fileIds = [...new Set(dto.fileIds ?? [])];
    await this.files.assertOwnedFiles(fileIds, actor);
    const attempts = await this.prisma.assignmentSubmission.count({
      where: { assignmentId, studentId: student.id },
    });
    if (assignment.maxAttempts && attempts >= assignment.maxAttempts)
      throw new BadRequestException({
        code: 'assignment.attempts_exhausted',
        detail: `You have used all ${assignment.maxAttempts} attempts.`,
      });

    const row = await this.prisma.assignmentSubmission.create({
      data: {
        id: newId(),
        assignmentId,
        studentId: student.id,
        attemptNumber: attempts + 1,
        status: window.late ? 'LATE' : 'SUBMITTED',
        textContent: dto.textContent?.trim() || null,
        isLate: window.late,
        submittedAt: now,
        files: { create: fileIds.map((fileId) => ({ id: newId(), fileId })) },
      },
      include: this.submissionInclude,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: assignment.organizationId,
      action: 'submissions.create',
      entityType: 'AssignmentSubmission',
      entityId: row.id,
      details: {
        assignmentId,
        attemptNumber: row.attemptNumber,
        late: window.late,
      },
    });
    this.events.emit(
      'assignment.submitted',
      domainEvent({
        eventType: 'assignment.submitted',
        entityType: 'AssignmentSubmission',
        entityId: row.id,
        organizationId: assignment.organizationId,
        actorId: actor.id,
        data: {
          assignmentId,
          studentId: student.id,
          attemptNumber: row.attemptNumber,
          late: window.late,
        },
      }),
    );
    return toPublicSubmission(row);
  }

  async getSubmission(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<PublicSubmission> {
    const row = await this.prisma.assignmentSubmission.findUnique({
      where: { id },
      include: {
        ...this.submissionInclude,
        assignment: { include: this.include },
        student: {
          select: {
            id: true,
            studentNumber: true,
            firstName: true,
            lastName: true,
            userId: true,
            guardians: { select: { guardianUserId: true } },
          },
        },
      },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Submission not found.',
      });
    const own =
      row.student.userId === actor.id ||
      row.student.guardians.some((g) => g.guardianUserId === actor.id);
    if (!own && !canManage(row.assignment.class, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'You cannot view this submission.',
      });
    return toPublicSubmission(row);
  }

  async grade(
    submissionId: string,
    dto: GradeSubmissionDto,
    actor: AuthenticatedUser,
  ): Promise<PublicGrade> {
    const submission = await this.prisma.assignmentSubmission.findUnique({
      where: { id: submissionId },
      include: { assignment: { include: this.include } },
    });
    if (!submission)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Submission not found.',
      });
    if (!canManage(submission.assignment.class, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only an assigned teacher or an administrator can grade this class.',
      });
    const maxPoints = Number(submission.assignment.maxPoints);
    if (dto.score > maxPoints)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: `Score cannot exceed ${maxPoints} points.`,
      });
    if (dto.rubricScores?.length && submission.assignment.rubric) {
      const criteria = parseCriteria(submission.assignment.rubric.criteria);
      for (const rs of dto.rubricScores) {
        const c = criteria.find((x) => x.id === rs.criterionId);
        if (!c)
          throw new BadRequestException({
            code: 'request.invalid',
            detail: `Unknown rubric criterion '${rs.criterionId}'.`,
          });
        if (rs.points > c.maxPoints)
          throw new BadRequestException({
            code: 'request.invalid',
            detail: `Criterion '${c.title}' allows at most ${c.maxPoints} points.`,
          });
      }
    }
    const penalised = applyLatePenalty(
      dto.score,
      maxPoints,
      submission.isLate && !dto.waiveLatePenalty,
      submission.assignment.latePenaltyPercent,
    );
    const percentage = percentageOf(penalised.score, maxPoints);
    const data = {
      submissionId,
      gradedById: actor.id,
      score: penalised.score,
      maxPoints,
      percentage,
      letterGrade: letterGrade(percentage),
      feedback: dto.feedback,
      rubricScores: dto.rubricScores ? JSON.stringify(dto.rubricScores) : null,
      latePenaltyApplied: penalised.penaltyApplied,
      gradedAt: new Date(),
    };
    const grade = await this.prisma.grade.upsert({
      where: {
        assignmentId_studentId: {
          assignmentId: submission.assignmentId,
          studentId: submission.studentId,
        },
      },
      create: {
        id: newId(),
        assignmentId: submission.assignmentId,
        studentId: submission.studentId,
        ...data,
      },
      update: data,
    });
    await this.prisma.assignmentSubmission.update({
      where: { id: submissionId },
      data: { status: 'GRADED' },
    });
    await this.refreshCurrentGrade(
      submission.assignment.classId,
      submission.studentId,
    );
    await this.audit.record({
      userId: actor.id,
      organizationId: submission.assignment.organizationId,
      action: 'grades.post',
      entityType: 'Grade',
      entityId: grade.id,
      details: {
        assignmentId: submission.assignmentId,
        studentId: submission.studentId,
        score: penalised.score,
      },
    });
    this.events.emit(
      'grade.posted',
      domainEvent({
        eventType: 'grade.posted',
        entityType: 'Grade',
        entityId: grade.id,
        organizationId: submission.assignment.organizationId,
        actorId: actor.id,
        data: {
          assignmentId: submission.assignmentId,
          studentId: submission.studentId,
          score: penalised.score,
          maxPoints,
          percentage,
        },
      }),
    );
    return toPublicGrade(grade);
  }

  /** The interactive content must exist, be playable in this organisation, and be published before students meet it. */
  private async assertContent(
    h5pContentId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const content = await this.prisma.h5PContent.findFirst({
      where: { id: h5pContentId, deletedAt: null },
      select: { organizationId: true, status: true },
    });
    if (!content)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Interactive content not found.',
      });
    assertOrganizationAccess(actor, content.organizationId);
    if (content.status === 'ARCHIVED')
      throw new BadRequestException({
        code: 'h5p.archived',
        detail: 'That content is archived.',
      });
  }

  /**
   * A result from interactive content becomes a submission and an auto-posted grade (docs/07 slice 6).
   * Scores scale onto the assignment points; late rules and attempt limits apply exactly as for typed work.
   */
  async recordExternalResult(
    assignmentId: string,
    h5pContentId: string,
    result: {
      score: number;
      maxScore: number;
      detail?: Record<string, unknown>;
    },
    actor: AuthenticatedUser,
  ): Promise<{ submission: PublicSubmission; grade: PublicGrade }> {
    const student = await this.prisma.student.findFirst({
      where: { userId: actor.id, deletedAt: null },
      select: { id: true },
    });
    if (!student)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Your account is not linked to a student record.',
      });
    const assignment = await this.prisma.assignment.findFirst({
      where: {
        id: assignmentId,
        deletedAt: null,
        h5pContentId,
        class: {
          enrollments: {
            some: {
              studentId: student.id,
              status: { in: ['ENROLLED', 'COMPLETED'] },
            },
          },
        },
      },
      include: this.include,
    });
    if (!assignment)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Assignment not found or it does not use this content.',
      });
    const now = new Date();
    const window = submissionWindow({
      now,
      status: assignment.status,
      availableFrom: assignment.availableFrom,
      dueAt: assignment.dueAt,
      allowLateUntil: assignment.allowLateUntil,
    });
    if (!window.accepted)
      throw new BadRequestException({
        code: 'assignment.not_accepting',
        detail: window.reason ?? 'Submissions are not accepted.',
      });
    const attempts = await this.prisma.assignmentSubmission.count({
      where: { assignmentId, studentId: student.id },
    });
    if (assignment.maxAttempts && attempts >= assignment.maxAttempts)
      throw new BadRequestException({
        code: 'assignment.attempts_exhausted',
        detail: `You have used all ${assignment.maxAttempts} attempts.`,
      });
    const maxPoints = Number(assignment.maxPoints);
    const raw =
      maxScore(result) > 0
        ? Math.round(
            (Math.min(result.score, result.maxScore) / result.maxScore) *
              maxPoints *
              100,
          ) / 100
        : 0;
    const penalised = applyLatePenalty(
      raw,
      maxPoints,
      window.late,
      assignment.latePenaltyPercent,
    );
    const percentage = percentageOf(penalised.score, maxPoints);
    const submission = await this.prisma.assignmentSubmission.create({
      data: {
        id: newId(),
        assignmentId,
        studentId: student.id,
        attemptNumber: attempts + 1,
        status: 'GRADED',
        textContent: `Interactive content result: ${result.score} of ${result.maxScore}`,
        isLate: window.late,
        submittedAt: now,
      },
      include: this.submissionInclude,
    });
    const data = {
      submissionId: submission.id,
      gradedById: null,
      score: penalised.score,
      maxPoints,
      percentage,
      letterGrade: letterGrade(percentage),
      feedback: 'Auto-graded from the interactive activity.',
      rubricScores: null,
      latePenaltyApplied: penalised.penaltyApplied,
      gradedAt: now,
    };
    const grade = await this.prisma.grade.upsert({
      where: {
        assignmentId_studentId: { assignmentId, studentId: student.id },
      },
      create: { id: newId(), assignmentId, studentId: student.id, ...data },
      update: data,
    });
    await this.refreshCurrentGrade(assignment.classId, student.id);
    await this.audit.record({
      userId: actor.id,
      organizationId: assignment.organizationId,
      action: 'grades.post',
      entityType: 'Grade',
      entityId: grade.id,
      details: {
        assignmentId,
        studentId: student.id,
        score: penalised.score,
        auto: true,
        h5pContentId,
      },
    });
    this.events.emit(
      'assignment.submitted',
      domainEvent({
        eventType: 'assignment.submitted',
        entityType: 'AssignmentSubmission',
        entityId: submission.id,
        organizationId: assignment.organizationId,
        actorId: actor.id,
        data: {
          assignmentId,
          studentId: student.id,
          attemptNumber: submission.attemptNumber,
          late: window.late,
          interactive: true,
        },
      }),
    );
    this.events.emit(
      'grade.posted',
      domainEvent({
        eventType: 'grade.posted',
        entityType: 'Grade',
        entityId: grade.id,
        organizationId: assignment.organizationId,
        actorId: actor.id,
        data: {
          assignmentId,
          studentId: student.id,
          score: penalised.score,
          maxPoints,
          percentage,
          auto: true,
        },
      }),
    );
    return {
      submission: toPublicSubmission(submission),
      grade: toPublicGrade(grade),
    };
  }

  // ---------------------------------------------------------------------------
  // Grades and gradebook
  // ---------------------------------------------------------------------------

  async listGrades(
    q: {
      studentId?: string;
      classId?: string;
      assignmentId?: string;
      page: number;
      pageSize: number;
      skip: number;
    },
    actor: AuthenticatedUser,
  ): Promise<PagedResponse<PublicGrade>> {
    const where: Prisma.GradeWhereInput = {};
    const assignmentWhere: Prisma.AssignmentWhereInput = {};
    if (isLearnerSide(actor)) {
      const own = await this.ownStudentIds(actor);
      where.studentId = q.studentId
        ? own.includes(q.studentId)
          ? q.studentId
          : { in: [] }
        : { in: own };
    } else {
      Object.assign(assignmentWhere, organizationScope(actor));
      if (q.studentId) where.studentId = q.studentId;
    }
    if (q.classId) assignmentWhere.classId = q.classId;
    if (q.assignmentId) where.assignmentId = q.assignmentId;
    if (Object.keys(assignmentWhere).length) where.assignment = assignmentWhere;
    const [rows, total] = await Promise.all([
      this.prisma.grade.findMany({
        where,
        orderBy: { gradedAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
        include: {
          assignment: {
            select: {
              id: true,
              title: true,
              classId: true,
              dueAt: true,
              category: true,
              class: { select: { name: true } },
            },
          },
          student: {
            select: {
              id: true,
              studentNumber: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      this.prisma.grade.count({ where }),
    ]);
    return PagedResponse.of(
      rows.map((g) => ({
        ...toPublicGrade(g),
        assignment: {
          id: g.assignment.id,
          title: g.assignment.title,
          classId: g.assignment.classId,
          className: g.assignment.class.name,
          dueAt: g.assignment.dueAt,
          category: g.assignment.category,
        },
        student: g.student,
      })),
      q,
      total,
    );
  }

  async gradebook(classId: string, actor: AuthenticatedUser) {
    const klass = await this.manageableClass(classId, actor, true);
    const [enrolled, assignments, grades] = await Promise.all([
      this.prisma.classEnrollment.findMany({
        where: { classId, status: { in: ['ENROLLED', 'COMPLETED'] } },
        include: {
          student: {
            select: {
              id: true,
              studentNumber: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { student: { lastName: 'asc' } },
      }),
      this.prisma.assignment.findMany({
        where: {
          classId,
          deletedAt: null,
          status: { in: ['PUBLISHED', 'CLOSED'] },
        },
        orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.grade.findMany({
        where: { assignment: { classId, deletedAt: null } },
      }),
    ]);
    const book = buildGradebook(
      enrolled.map((e) => e.student),
      assignments.map((a) => ({
        id: a.id,
        title: a.title,
        category: a.category,
        maxPoints: Number(a.maxPoints),
        weight: Number(a.weight),
        dueAt: a.dueAt,
        status: a.status.toLowerCase(),
      })),
      grades.map((g) => ({
        assignmentId: g.assignmentId,
        studentId: g.studentId,
        score: Number(g.score),
        maxPoints: Number(g.maxPoints),
      })),
    );
    return { classId, className: klass.name, ...book };
  }

  async gradebookCsv(
    classId: string,
    actor: AuthenticatedUser,
  ): Promise<string> {
    const book = await this.gradebook(classId, actor);
    const header = [
      'studentNumber',
      'lastName',
      'firstName',
      ...book.assignments.map((a) => `${a.title} (${a.maxPoints})`),
      'weightedScore',
      'weightedMax',
      'percentage',
      'letter',
    ];
    const rows = book.rows.map((r) => [
      r.student.studentNumber,
      r.student.lastName,
      r.student.firstName,
      ...book.assignments.map((a) => r.cells[a.id]?.score ?? ''),
      r.weightedScore,
      r.weightedMax,
      r.percentage ?? '',
      r.letter ?? '',
    ]);
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'grades.export',
      entityType: 'Class',
      entityId: classId,
    });
    return toCsv([header, ...rows]);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private readonly include = {
    class: {
      select: {
        id: true,
        name: true,
        organizationId: true,
        course: { select: { title: true } },
        teachers: { select: { teacherId: true } },
      },
    },
    rubric: { select: { id: true, title: true, criteria: true } },
    h5pContent: {
      select: {
        id: true,
        title: true,
        library: true,
        maxScore: true,
        status: true,
      },
    },
    _count: { select: { submissions: true, grades: true } },
  } satisfies Prisma.AssignmentInclude;

  private readonly submissionInclude = {
    student: {
      select: {
        id: true,
        studentNumber: true,
        firstName: true,
        lastName: true,
      },
    },
    files: { include: { file: true } },
    grade: true,
  } satisfies Prisma.AssignmentSubmissionInclude;

  /** Students and parents only see published work in classes they (or their children) attend. */
  private visibility(actor: AuthenticatedUser): Prisma.AssignmentWhereInput {
    if (!isLearnerSide(actor)) return {};
    const student: Prisma.StudentWhereInput =
      actor.role === 'PARENT'
        ? { guardians: { some: { guardianUserId: actor.id } } }
        : { userId: actor.id };
    return {
      status: { in: ['PUBLISHED', 'CLOSED'] },
      class: {
        enrollments: {
          some: { status: { in: ['ENROLLED', 'COMPLETED'] }, student },
        },
      },
    };
  }

  private async ownStudentIds(actor: AuthenticatedUser): Promise<string[]> {
    const rows = await this.prisma.student.findMany({
      where:
        actor.role === 'PARENT'
          ? { guardians: { some: { guardianUserId: actor.id } } }
          : { userId: actor.id },
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  private async find(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<AssignmentRow> {
    const row = await this.prisma.assignment.findFirst({
      where: { id, deletedAt: null, ...this.visibility(actor) },
      include: this.include,
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Assignment not found.',
      });
    if (!isLearnerSide(actor))
      assertOrganizationAccess(actor, row.organizationId);
    return row;
  }

  private async findManageable(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<AssignmentRow> {
    const row = await this.find(id, actor);
    if (!canManage(row.class, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only an assigned teacher or an administrator can change this assignment.',
      });
    return row;
  }

  private async manageableClass(
    classId: string,
    actor: AuthenticatedUser,
    viewOnly = false,
  ) {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      include: { teachers: { select: { teacherId: true } } },
    });
    if (!klass)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    assertOrganizationAccess(actor, klass.organizationId);
    const allowed =
      canManage(klass, actor) ||
      (viewOnly && ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL);
    if (!allowed)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only an assigned teacher or an administrator can work with this class.',
      });
    return klass;
  }

  private datesFrom(dto: Partial<CreateAssignmentDto>): {
    availableFrom?: Date;
    dueAt?: Date;
    allowLateUntil?: Date;
  } {
    const out: { availableFrom?: Date; dueAt?: Date; allowLateUntil?: Date } =
      {};
    for (const key of ['availableFrom', 'dueAt', 'allowLateUntil'] as const) {
      const raw = dto[key];
      if (raw === undefined) continue;
      const d = new Date(raw);
      if (Number.isNaN(d.getTime()))
        throw new BadRequestException({
          code: 'request.invalid',
          detail: `${key} must be an ISO date-time.`,
        });
      out[key] = d;
    }
    if (out.dueAt && out.allowLateUntil && out.allowLateUntil < out.dueAt)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'allowLateUntil must be after dueAt.',
      });
    void parseDate;
    return out;
  }

  /** Keeps ClassEnrollments.currentGrade in step with the gradebook for one student. */
  private async refreshCurrentGrade(
    classId: string,
    studentId: string,
  ): Promise<void> {
    const [assignments, grades] = await Promise.all([
      this.prisma.assignment.findMany({
        where: {
          classId,
          deletedAt: null,
          status: { in: ['PUBLISHED', 'CLOSED'] },
        },
        select: { id: true, maxPoints: true, weight: true },
      }),
      this.prisma.grade.findMany({
        where: { studentId, assignment: { classId, deletedAt: null } },
        select: { assignmentId: true, score: true, maxPoints: true },
      }),
    ]);
    const book = buildGradebook(
      [{ id: studentId, studentNumber: '', firstName: '', lastName: '' }],
      assignments.map((a) => ({
        id: a.id,
        title: '',
        category: null,
        maxPoints: Number(a.maxPoints),
        weight: Number(a.weight),
        dueAt: null,
        status: 'published',
      })),
      grades.map((g) => ({
        assignmentId: g.assignmentId,
        studentId,
        score: Number(g.score),
        maxPoints: Number(g.maxPoints),
      })),
    );
    await this.prisma.classEnrollment.updateMany({
      where: { classId, studentId },
      data: { currentGrade: book.rows[0]?.percentage ?? null },
    });
  }
}

function isLearnerSide(actor: AuthenticatedUser): boolean {
  return actor.role === 'STUDENT' || actor.role === 'PARENT';
}

function toPublic(
  a: AssignmentRow,
  actor: AuthenticatedUser,
): PublicAssignment {
  return {
    id: a.id,
    organizationId: a.organizationId,
    classId: a.classId,
    className: a.class.name,
    courseTitle: a.class.course.title,
    createdById: a.createdById,
    title: a.title,
    description: a.description,
    instructions: a.instructions,
    type: a.type.toLowerCase() as AssignmentTypeApi,
    submissionType: a.submissionType.toLowerCase() as SubmissionTypeApi,
    category: a.category,
    maxPoints: Number(a.maxPoints),
    weight: Number(a.weight),
    availableFrom: a.availableFrom,
    dueAt: a.dueAt,
    allowLateUntil: a.allowLateUntil,
    latePenaltyPercent: a.latePenaltyPercent,
    maxAttempts: a.maxAttempts,
    rubricId: a.rubricId,
    h5pContent: a.h5pContent
      ? { ...a.h5pContent, status: a.h5pContent.status.toLowerCase() }
      : null,
    rubric: a.rubric
      ? {
          id: a.rubric.id,
          title: a.rubric.title,
          criteria: parseCriteria(a.rubric.criteria),
        }
      : null,
    h5pContentId: a.h5pContentId,
    status: a.status.toLowerCase() as AssignmentStatusApi,
    publishedAt: a.publishedAt,
    canManage: canManage(a.class, actor),
    submissionCount: a._count.submissions,
    gradedCount: a._count.grades,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

type SubmissionRow = AssignmentSubmission & {
  student: {
    id: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
  };
  files: Array<{
    file: {
      id: string;
      organizationId: string | null;
      uploaderId: string;
      originalName: string;
      mimeType: string;
      sizeBytes: number;
      sha256: string;
      category: string;
      createdAt: Date;
    };
  }>;
  grade: Grade | null;
};

function toPublicSubmission(s: SubmissionRow): PublicSubmission {
  return {
    id: s.id,
    assignmentId: s.assignmentId,
    studentId: s.studentId,
    student: {
      id: s.student.id,
      studentNumber: s.student.studentNumber,
      firstName: s.student.firstName,
      lastName: s.student.lastName,
    },
    attemptNumber: s.attemptNumber,
    status: s.status.toLowerCase(),
    textContent: s.textContent,
    isLate: s.isLate,
    submittedAt: s.submittedAt,
    files: s.files.map((f) => ({
      ...f.file,
      downloadUrl: `/api/v1/files/${f.file.id}/download`,
    })),
    grade: s.grade ? toPublicGrade(s.grade) : null,
  };
}

function toPublicGrade(g: Grade): PublicGrade {
  let rubricScores: PublicGrade['rubricScores'] = null;
  if (g.rubricScores) {
    try {
      rubricScores = JSON.parse(g.rubricScores) as PublicGrade['rubricScores'];
    } catch {
      rubricScores = null;
    }
  }
  return {
    id: g.id,
    assignmentId: g.assignmentId,
    studentId: g.studentId,
    submissionId: g.submissionId,
    gradedById: g.gradedById,
    score: Number(g.score),
    maxPoints: Number(g.maxPoints),
    percentage: Number(g.percentage),
    letterGrade: g.letterGrade,
    feedback: g.feedback,
    rubricScores,
    latePenaltyApplied: g.latePenaltyApplied,
    gradedAt: g.gradedAt,
  };
}

function maxScore(result: { maxScore: number }): number {
  return Number.isFinite(result.maxScore) ? result.maxScore : 0;
}
