import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ConferenceNote,
  LessonSummary,
} from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import { assertOrganizationAccess } from '../access/scope';
import { AiContentService, type PublicJob } from '../ai/ai-content.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canManage } from '../classes/classes.service';
import {
  GenerateConferenceDto,
  GenerateSummaryDto,
  UpdateSummaryDto,
} from './dto/summaries.dto';

export interface PublicSummary {
  id: string;
  lessonId: string;
  language: string;
  title: string;
  summary: string;
  keyIdeas: string[];
  questions: string[];
  tryAtHome: string[];
  status: 'draft' | 'released';
  aiGenerated: boolean;
  aiModel: string | null;
  reviewedBy: { id: string; firstName: string; lastName: string } | null;
  releasedAt: Date | null;
  updatedAt: Date;
}
export interface PublicConferenceNote {
  id: string;
  studentId: string;
  language: string;
  content: {
    opening: string;
    strengths: string[];
    concerns: string[];
    talkingPoints: string[];
    questionsForFamily: string[];
    nextSteps: string[];
  };
  aiModel: string | null;
  author: { id: string; firstName: string; lastName: string };
  createdAt: Date;
}

/**
 * Family-language lesson summaries (AI drafts a teacher reviews and releases) and conference talking points
 * for teachers (docs/13 section 7). Both are produced through the AI content jobs and labelled as AI-generated.
 */
@Injectable()
export class SummariesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly content: AiContentService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Lesson summaries
  // ---------------------------------------------------------------------------

  async summaries(
    lessonId: string,
    actor: AuthenticatedUser,
  ): Promise<PublicSummary[]> {
    const { staff } = await this.readableLesson(lessonId, actor);
    const rows = await this.prisma.lessonSummary.findMany({
      where: { lessonId, ...(staff ? {} : { status: 'RELEASED' }) },
      include: {
        reviewedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { language: 'asc' },
    });
    return rows.map(toSummary);
  }

  /** Starts an AI job; when it finishes the draft is stored (or replaces an unreleased draft) for the language. */
  async generateSummary(
    lessonId: string,
    dto: GenerateSummaryDto,
    actor: AuthenticatedUser,
  ): Promise<PublicJob> {
    const { lesson, course } = await this.editableLesson(lessonId, actor);
    const language = dto.language ?? 'es';
    const existing = await this.prisma.lessonSummary.findUnique({
      where: { lessonId_language: { lessonId, language } },
    });
    if (existing?.status === 'RELEASED')
      throw new ForbiddenException({
        code: 'summaries.released',
        detail:
          'This summary is released to families. Move it back to draft before generating a new one.',
      });
    const blocks = [
      {
        id: 'C1',
        label: `Lesson: ${lesson.title}`,
        text:
          (lesson.description ? `${lesson.description}\n\n` : '') +
          (lesson.content ?? '').slice(0, 8000),
      },
    ];
    if (!lesson.content && !lesson.description)
      throw new ForbiddenException({
        code: 'summaries.no_content',
        detail: 'This lesson has no text to summarise yet.',
      });
    return this.content.startText(
      'content.summary',
      {
        topic: lesson.title,
        subject: course.subject ?? '',
        gradeLevel: course.gradeLevel ?? '7',
        language,
        lessonId,
      },
      { courseId: course.id, lessonId, blocks },
      actor,
      course.organizationId,
    );
  }

  async updateSummary(
    id: string,
    dto: UpdateSummaryDto,
    actor: AuthenticatedUser,
  ): Promise<PublicSummary> {
    const row = await this.prisma.lessonSummary.findUnique({
      where: { id },
      include: { lesson: { select: { id: true } } },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Summary not found.',
      });
    await this.editableLesson(row.lessonId, actor);
    const releasing = dto.status === 'released' && row.status !== 'RELEASED';
    const updated = await this.prisma.lessonSummary.update({
      where: { id },
      data: {
        title: dto.title?.trim(),
        summary: dto.summary?.trim(),
        keyIdeas: dto.keyIdeas ? JSON.stringify(dto.keyIdeas) : undefined,
        questions: dto.questions ? JSON.stringify(dto.questions) : undefined,
        tryAtHome: dto.tryAtHome ? JSON.stringify(dto.tryAtHome) : undefined,
        status: dto.status
          ? dto.status === 'released'
            ? 'RELEASED'
            : 'DRAFT'
          : undefined,
        reviewedById: actor.id,
        releasedAt: releasing
          ? new Date()
          : dto.status === 'draft'
            ? null
            : undefined,
      },
      include: {
        reviewedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: releasing ? 'summaries.release' : 'summaries.update',
      entityType: 'LessonSummary',
      entityId: id,
      details: { language: row.language, status: dto.status },
    });
    return toSummary(updated);
  }

  async removeSummary(id: string, actor: AuthenticatedUser): Promise<void> {
    const row = await this.prisma.lessonSummary.findUnique({ where: { id } });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Summary not found.',
      });
    await this.editableLesson(row.lessonId, actor);
    await this.prisma.lessonSummary.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------
  // Conference talking points
  // ---------------------------------------------------------------------------

  async conferenceNotes(
    studentId: string,
    actor: AuthenticatedUser,
  ): Promise<PublicConferenceNote[]> {
    await this.studentForConference(studentId, actor);
    const rows = await this.prisma.conferenceNote.findMany({
      where: { studentId },
      include: {
        author: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    return rows.map(toNote);
  }

  /** Collects the student's numbers (never other students') into one DATA block and asks for talking points. */
  async generateConference(
    studentId: string,
    dto: GenerateConferenceDto,
    actor: AuthenticatedUser,
  ): Promise<PublicJob> {
    const student = await this.studentForConference(studentId, actor);
    const since = new Date(Date.now() - 30 * 86_400_000);
    const [enrollments, attendance, behavior, accommodation, missing, org] =
      await Promise.all([
        this.prisma.classEnrollment.findMany({
          where: {
            studentId,
            status: { in: ['ENROLLED', 'COMPLETED'] },
            class: { deletedAt: null },
          },
          include: { class: { select: { name: true } } },
        }),
        this.prisma.attendance.findMany({
          where: { studentId, date: { gte: since } },
          select: {
            status: true,
            code: { select: { countsAsPresent: true, category: true } },
          },
        }),
        this.prisma.behaviorRecord.findMany({
          where: {
            studentId,
            occurredAt: { gte: new Date(Date.now() - 90 * 86_400_000) },
          },
          select: { kind: true, title: true },
        }),
        this.prisma.accommodation.findUnique({
          where: { studentId },
          select: { plan: true, extendedTimePercent: true },
        }),
        this.prisma.assignment.count({
          where: {
            deletedAt: null,
            status: { in: ['PUBLISHED', 'CLOSED'] },
            dueAt: { lt: new Date() },
            class: {
              deletedAt: null,
              enrollments: {
                some: { studentId, status: { in: ['ENROLLED', 'COMPLETED'] } },
              },
            },
            submissions: { none: { studentId } },
            grades: { none: { studentId } },
            marks: { none: { studentId, mark: 'EXCUSED' } },
          },
        }),
        this.prisma.organization.findUniqueOrThrow({
          where: { id: student.organizationId },
          select: { name: true },
        }),
      ]);
    const present = attendance.filter((a) =>
      a.code
        ? a.code.countsAsPresent
        : ['PRESENT', 'TARDY', 'LATE', 'LEFT_EARLY'].includes(a.status),
    ).length;
    const lines = [
      `student first name: ${student.firstName}`,
      `grade level: ${student.gradeLevel ?? 'unknown'}`,
      ...enrollments.map(
        (e) =>
          `class ${e.class.name}: current grade ${e.currentGrade === null ? 'no grades yet' : `${Number(e.currentGrade)}%`}`,
      ),
      `attendance last 30 days: ${attendance.length ? `${present} of ${attendance.length} period records present` : 'no records'}`,
      `missing assignments right now: ${missing}`,
      `behaviour notes last 90 days: ${behavior.length === 0 ? 'none' : behavior.map((b) => `${b.kind.toLowerCase()} (${b.title})`).join('; ')}`,
      accommodation
        ? `support plan: ${accommodation.plan} with ${accommodation.extendedTimePercent}% extended time`
        : 'support plan: none recorded',
    ];
    return this.content.startText(
      'content.conference',
      {
        topic: student.firstName,
        subject: org.name,
        gradeLevel: student.gradeLevel ?? '7',
        language: dto.language ?? 'en',
        studentId,
      },
      {
        courseId: null,
        lessonId: null,
        blocks: [{ id: 'D1', label: 'DATA', text: lines.join('\n') }],
      },
      actor,
      student.organizationId,
    );
  }

  async removeConferenceNote(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const row = await this.prisma.conferenceNote.findUnique({ where: { id } });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Note not found.',
      });
    if (
      row.authorId !== actor.id &&
      ROLE_LEVEL[actor.role] < ROLE_LEVEL.PRINCIPAL
    )
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only the teacher who asked for these notes, or an administrator, can remove them.',
      });
    await this.prisma.conferenceNote.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------

  private async readableLesson(lessonId: string, actor: AuthenticatedUser) {
    const lesson = await this.prisma.lesson.findFirst({
      where: { id: lessonId },
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
    const staff = actor.role !== 'STUDENT' && actor.role !== 'PARENT';
    if (staff)
      assertOrganizationAccess(actor, lesson.module.course.organizationId);
    return { lesson, course: lesson.module.course, staff };
  }

  private async editableLesson(lessonId: string, actor: AuthenticatedUser) {
    const { lesson, course } = await this.readableLesson(lessonId, actor);
    if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.TEACHER)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Teachers and administrators manage lesson summaries.',
      });
    return { lesson, course };
  }

  private async studentForConference(
    studentId: string,
    actor: AuthenticatedUser,
  ) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
    });
    if (!student)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Student not found.',
      });
    if (actor.role === 'STUDENT' || actor.role === 'PARENT')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Conference notes are for the teacher preparing the meeting.',
      });
    assertOrganizationAccess(actor, student.organizationId);
    if (actor.role === 'TEACHER' || actor.role === 'ASSISTANT') {
      const klass = await this.prisma.class.findFirst({
        where: {
          deletedAt: null,
          enrollments: {
            some: { studentId, status: { in: ['ENROLLED', 'COMPLETED'] } },
          },
          teachers: { some: { teacherId: actor.id } },
        },
        include: { teachers: { select: { teacherId: true } } },
      });
      if (!klass || !canManage(klass, actor))
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail:
            "Only this student's teachers, counselors and administrators prepare conference notes.",
        });
    }
    return student;
  }
}

function list(json: string): string[] {
  try {
    const v = JSON.parse(json) as unknown;
    return Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string')
      : [];
  } catch {
    return [];
  }
}
export function toSummary(
  s: LessonSummary & {
    reviewedBy: { id: string; firstName: string; lastName: string } | null;
  },
): PublicSummary {
  return {
    id: s.id,
    lessonId: s.lessonId,
    language: s.language,
    title: s.title,
    summary: s.summary,
    keyIdeas: list(s.keyIdeas),
    questions: list(s.questions),
    tryAtHome: list(s.tryAtHome),
    status: s.status === 'RELEASED' ? 'released' : 'draft',
    aiGenerated: !!s.aiModel,
    aiModel: s.aiModel,
    reviewedBy: s.reviewedBy,
    releasedAt: s.releasedAt,
    updatedAt: s.updatedAt,
  };
}
function toNote(
  n: ConferenceNote & {
    author: { id: string; firstName: string; lastName: string };
  },
): PublicConferenceNote {
  let content: PublicConferenceNote['content'] = {
    opening: '',
    strengths: [],
    concerns: [],
    talkingPoints: [],
    questionsForFamily: [],
    nextSteps: [],
  };
  try {
    content = {
      ...content,
      ...(JSON.parse(n.content) as Partial<PublicConferenceNote['content']>),
    };
  } catch {
    /* keep the empty shape */
  }
  return {
    id: n.id,
    studentId: n.studentId,
    language: n.language,
    content,
    aiModel: n.aiModel,
    author: n.author,
    createdAt: n.createdAt,
  };
}
