import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { assertOrganizationAccess, isDistrictRole } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { InsightService } from '../insight/insight.service';
import { LearningService } from '../learning/learning.service';
import { TenantsService } from '../tenants/tenants.service';
import type {
  CreatePathDto,
  GeneratePathDto,
  StepInputDto,
  UpdatePathDto,
  UpdateStepDto,
} from './dto/paths.dto';
import {
  buildPathSteps,
  learningHealth,
  masteryGaps,
  pathProgress,
  pathTitle,
  recommend,
  stepHref,
  stepsFinishedBy,
  type MasteryRow,
  type RecommendationInput,
  type StepEvent,
} from './paths-rules';

type StudentRow = {
  id: string;
  organizationId: string;
  userId: string | null;
  firstName: string;
  lastName: string;
  gradeLevel: string | null;
};

/**
 * The integrated learning profile, next-step recommendations and learning paths (docs/02 sections 22 and 29).
 * Everything is computed from the tables the other slices fill; nothing is simulated.
 */
@Injectable()
export class PathsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly learning: LearningService,
    private readonly insight: InsightService,
    private readonly tenants: TenantsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Profile and recommendations
  // ---------------------------------------------------------------------------

  async profile(studentId: string, actor: AuthenticatedUser) {
    const student = await this.visibleStudent(studentId, actor);
    const [mastery, insight, practice, paths] = await Promise.all([
      this.learning.masteryFor(student.id, actor),
      this.insight.studentInsight(student.id, actor),
      this.learning.practiceStats(student.id),
      this.prisma.learningPath.findMany({
        where: { studentId: student.id, status: 'active' },
        include: { steps: { select: { status: true } } },
      }),
    ]);
    const due =
      (practice as { due?: number; dueToday?: number }).dueToday ??
      (practice as { due?: number }).due ??
      0;
    const health = learningHealth({
      mastery: mastery.average,
      attendanceRate: insight.attendance.rate,
      missing: insight.missing.length,
      practiceDue: due,
      practiceReviews30: insight.practice.reviews30Days,
      lessonsCompleted8w: insight.weekly.lessonCompletions.reduce(
        (s, w) =>
          s +
          (typeof w === 'number' ? w : ((w as { count?: number }).count ?? 0)),
        0,
      ),
      failingClasses: insight.classes.filter((c) => c.failing).length,
    });
    const rows: MasteryRow[] = mastery.standards.map((s) => ({
      standardId: s.standardId,
      code: s.code,
      description: s.description,
      level: s.level,
      trend: s.trend,
      evidenceCount: s.evidenceCount,
    }));
    const gaps = masteryGaps(rows);
    const recommendations = await this.recommendationsFor(
      student,
      rows,
      insight,
      due,
    );
    return {
      student: {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        gradeLevel: student.gradeLevel,
      },
      health,
      mastery: {
        average: mastery.average,
        counts: mastery.counts,
        strongest: mastery.strongest,
        weakest: mastery.weakest,
        measured: mastery.standards.length,
      },
      attendance: insight.attendance,
      work: {
        missing: insight.missing.length,
        lateSubmissions: insight.lateSubmissions,
        failingClasses: insight.classes
          .filter((c) => c.failing)
          .map((c) => c.name),
      },
      practice: { due, reviews30Days: insight.practice.reviews30Days },
      ai: insight.ai,
      flags: insight.flags,
      gaps,
      recommendations,
      paths: paths.map((p) => ({
        id: p.id,
        title: p.title,
        status: p.status,
        source: p.source,
        progress: pathProgress(p.steps),
      })),
    };
  }

  private async recommendationsFor(
    student: StudentRow,
    rows: MasteryRow[],
    insight: Awaited<ReturnType<InsightService['studentInsight']>>,
    practiceDue: number,
  ) {
    const gaps = masteryGaps(rows);
    const contentIndex = await this.contentIndex(
      student,
      gaps.map((g) => g.standardId),
    );
    const nextLessons = await this.nextLessons(student);
    const tutorAllowed = await this.tenants.aiAllowedForOrganization(
      student.organizationId,
    );
    const input: RecommendationInput = {
      gaps,
      contentFor: (id) => contentIndex.get(id) ?? [],
      missing: insight.missing.map((m) => ({
        assignmentId: m.assignmentId,
        title: m.title,
        href: `/assignments/${m.assignmentId}`,
      })),
      practiceDue,
      nextLessons,
      tutorAllowed,
    };
    return recommend(input);
  }

  /** Content that teaches each standard: published lessons in the student's courses, then library items naming the code. */
  private async contentIndex(student: StudentRow, standardIds: string[]) {
    const map = new Map<
      string,
      Array<{
        kind: 'lesson' | 'h5p' | 'library';
        id: string;
        title: string;
        href: string;
      }>
    >();
    if (standardIds.length === 0) return map;
    const courseIds = (
      await this.prisma.classEnrollment.findMany({
        where: {
          studentId: student.id,
          status: { in: ['ENROLLED', 'COMPLETED'] },
          class: { deletedAt: null },
        },
        select: { class: { select: { courseId: true } } },
      })
    ).map((e) => e.class.courseId);
    const [links, standards] = await Promise.all([
      this.prisma.lessonStandard.findMany({
        where: {
          standardId: { in: standardIds },
          lesson: {
            isPublished: true,
            module: { courseId: { in: courseIds } },
          },
        },
        select: {
          standardId: true,
          lesson: {
            select: {
              id: true,
              title: true,
              h5pContentId: true,
              module: { select: { courseId: true } },
            },
          },
        },
      }),
      this.prisma.standard.findMany({
        where: { id: { in: standardIds } },
        select: { id: true, code: true },
      }),
    ]);
    for (const l of links) {
      const list = map.get(l.standardId) ?? [];
      list.push({
        kind: 'lesson',
        id: l.lesson.id,
        title: l.lesson.title,
        href: `/courses/${l.lesson.module.courseId}?lesson=${l.lesson.id}`,
      });
      if (l.lesson.h5pContentId)
        list.push({
          kind: 'h5p',
          id: l.lesson.h5pContentId,
          title: `${l.lesson.title} (activity)`,
          href: `/content/${l.lesson.h5pContentId}`,
        });
      map.set(l.standardId, list);
    }
    const tenantId = await this.tenants.tenantIdOf(student.organizationId);
    for (const s of standards) {
      const items = await this.prisma.libraryItem.findMany({
        where: {
          deletedAt: null,
          status: 'published',
          standards: { contains: s.code },
          OR: [
            { visibility: 'public' },
            { visibility: 'school', organizationId: student.organizationId },
            ...(tenantId
              ? [{ visibility: 'district', organization: { tenantId } }]
              : []),
          ],
        },
        orderBy: [{ featured: 'desc' }, { ratingSum: 'desc' }],
        take: 3,
        select: { id: true, title: true },
      });
      const list = map.get(s.id) ?? [];
      for (const i of items)
        list.push({
          kind: 'library',
          id: i.id,
          title: i.title,
          href: `/library/${i.id}`,
        });
      map.set(s.id, list);
    }
    return map;
  }

  /** The first unfinished published lesson in each enrolled course. */
  private async nextLessons(student: StudentRow) {
    const enrollments = await this.prisma.classEnrollment.findMany({
      where: {
        studentId: student.id,
        status: 'ENROLLED',
        class: { deletedAt: null },
      },
      select: {
        class: {
          select: {
            course: {
              select: {
                id: true,
                title: true,
                modules: {
                  orderBy: { sortOrder: 'asc' },
                  select: {
                    lessons: {
                      where: { isPublished: true },
                      orderBy: { sortOrder: 'asc' },
                      select: { id: true, title: true },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
    const done = new Set(
      (
        await this.prisma.lessonCompletion.findMany({
          where: { studentId: student.id },
          select: { lessonId: true },
        })
      ).map((c) => c.lessonId),
    );
    const out: Array<{
      lessonId: string;
      title: string;
      courseTitle: string;
      href: string;
    }> = [];
    for (const e of enrollments) {
      const lesson = e.class.course.modules
        .flatMap((m) => m.lessons)
        .find((l) => !done.has(l.id));
      if (lesson)
        out.push({
          lessonId: lesson.id,
          title: lesson.title,
          courseTitle: e.class.course.title,
          href: `/courses/${e.class.course.id}?lesson=${lesson.id}`,
        });
    }
    return out;
  }

  // ---------------------------------------------------------------------------
  // Paths
  // ---------------------------------------------------------------------------

  async listPaths(studentId: string, actor: AuthenticatedUser) {
    await this.visibleStudent(studentId, actor);
    const rows = await this.prisma.learningPath.findMany({
      where: { studentId },
      include: {
        steps: { orderBy: { sortOrder: 'asc' } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    return Promise.all(rows.map((p) => this.toPublic(p, actor)));
  }

  async getPath(id: string, actor: AuthenticatedUser) {
    const p = await this.pathRow(id);
    await this.visibleStudent(p.studentId, actor);
    return this.toPublic(p, actor);
  }

  /** A path from the student's weakest standards and the content that teaches them. */
  async generate(
    studentId: string,
    dto: GeneratePathDto,
    actor: AuthenticatedUser,
  ) {
    const student = await this.manageableStudent(studentId, actor);
    const mastery = await this.learning.masteryFor(student.id, actor);
    let rows: MasteryRow[] = mastery.standards.map((s) => ({
      standardId: s.standardId,
      code: s.code,
      description: s.description,
      level: s.level,
      trend: s.trend,
      evidenceCount: s.evidenceCount,
    }));
    if (dto.subject) {
      const subjectIds = new Set(
        mastery.standards
          .filter(
            (s) =>
              (s.subject ?? '').toLowerCase() === dto.subject?.toLowerCase(),
          )
          .map((s) => s.standardId),
      );
      rows = rows.filter((r) => subjectIds.has(r.standardId));
    }
    const gaps = masteryGaps(rows);
    if (gaps.length === 0)
      throw new BadRequestException({
        code: 'paths.no_gaps',
        detail:
          'No standards below the gap level with evidence; nothing to build a path from.',
      });
    const index = await this.contentIndex(
      student,
      gaps.map((g) => g.standardId),
    );
    const steps = buildPathSteps(gaps, (id) => index.get(id) ?? []);
    if (steps.length === 0)
      throw new BadRequestException({
        code: 'paths.no_content',
        detail:
          'No lessons or library items teach these standards yet. Add some to the library or attach standards to lessons.',
      });
    const subject =
      dto.subject ??
      mastery.standards.find((s) => s.standardId === gaps[0].standardId)
        ?.subject ??
      null;
    const path = await this.prisma.learningPath.create({
      data: {
        id: newId(),
        organizationId: student.organizationId,
        studentId: student.id,
        createdById: actor.id,
        title: pathTitle(gaps, subject),
        goal: `Bring ${gaps.map((g) => g.code).join(', ')} up to proficient.`,
        source: 'generated',
        rationale: gaps
          .map(
            (g) =>
              `${g.code} at ${Math.round(g.level * 100)}% after ${g.evidenceCount} piece${g.evidenceCount === 1 ? '' : 's'} of evidence`,
          )
          .join('; '),
        steps: {
          create: steps.map((s, i) => ({
            id: newId(),
            sortOrder: i + 1,
            kind: s.kind,
            refId: s.refId,
            title: s.title,
            reason: s.reason,
            standardCode: s.standardCode,
          })),
        },
      },
      include: {
        steps: { orderBy: { sortOrder: 'asc' } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'paths.generate',
      entityType: 'LearningPath',
      entityId: path.id,
      details: {
        studentId: student.id,
        gaps: gaps.map((g) => g.code),
        steps: steps.length,
      },
    });
    return this.toPublic(path, actor);
  }

  async create(
    studentId: string,
    dto: CreatePathDto,
    actor: AuthenticatedUser,
  ) {
    const student = await this.manageableStudent(studentId, actor);
    await this.checkRefs(dto.steps, student);
    const path = await this.prisma.learningPath.create({
      data: {
        id: newId(),
        organizationId: student.organizationId,
        studentId: student.id,
        createdById: actor.id,
        title: dto.title,
        goal: dto.goal ?? null,
        source: 'teacher',
        steps: {
          create: dto.steps.map((s, i) => ({
            id: newId(),
            sortOrder: i + 1,
            kind: s.kind,
            refId: s.refId ?? null,
            title: s.title,
            reason: s.reason ?? null,
            standardCode: s.standardCode ?? null,
          })),
        },
      },
      include: {
        steps: { orderBy: { sortOrder: 'asc' } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'paths.create',
      entityType: 'LearningPath',
      entityId: path.id,
      details: { studentId: student.id, steps: dto.steps.length },
    });
    return this.toPublic(path, actor);
  }

  async update(id: string, dto: UpdatePathDto, actor: AuthenticatedUser) {
    const p = await this.pathRow(id);
    await this.manageableStudent(p.studentId, actor);
    const updated = await this.prisma.learningPath.update({
      where: { id },
      data: {
        ...dto,
        ...(dto.status === 'completed' ? { completedAt: new Date() } : {}),
      },
      include: {
        steps: { orderBy: { sortOrder: 'asc' } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: p.organizationId,
      action: 'paths.update',
      entityType: 'LearningPath',
      entityId: id,
      details: { fields: Object.keys(dto) },
    });
    return this.toPublic(updated, actor);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const p = await this.pathRow(id);
    await this.manageableStudent(p.studentId, actor);
    await this.prisma.learningPath.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      organizationId: p.organizationId,
      action: 'paths.delete',
      entityType: 'LearningPath',
      entityId: id,
    });
  }

  async addStep(id: string, dto: StepInputDto, actor: AuthenticatedUser) {
    const p = await this.pathRow(id);
    const student = await this.manageableStudent(p.studentId, actor);
    await this.checkRefs([dto], student);
    const last = await this.prisma.learningPathStep.aggregate({
      where: { pathId: id },
      _max: { sortOrder: true },
    });
    await this.prisma.learningPathStep.create({
      data: {
        id: newId(),
        pathId: id,
        sortOrder: (last._max.sortOrder ?? 0) + 1,
        kind: dto.kind,
        refId: dto.refId ?? null,
        title: dto.title,
        reason: dto.reason ?? null,
        standardCode: dto.standardCode ?? null,
      },
    });
    await this.reopenIfNeeded(id);
    return this.getPath(id, actor);
  }

  /** Students mark their own steps done or skipped; staff may also retitle, reorder and reset them. */
  async updateStep(
    id: string,
    stepId: string,
    dto: UpdateStepDto,
    actor: AuthenticatedUser,
  ) {
    const p = await this.pathRow(id);
    const student = await this.visibleStudent(p.studentId, actor);
    const own = student.userId === actor.id;
    const staff = !own && (await this.canManage(student, actor));
    if (!own && !staff)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'You cannot change this path.',
      });
    if (
      own &&
      (dto.position !== undefined ||
        dto.title !== undefined ||
        dto.reason !== undefined)
    )
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Students mark steps done or skipped; teachers change the steps.',
      });
    const step = await this.prisma.learningPathStep.findFirst({
      where: { id: stepId, pathId: id },
    });
    if (!step)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Step not found.',
      });
    if (dto.position !== undefined) {
      const steps = await this.prisma.learningPathStep.findMany({
        where: { pathId: id },
        orderBy: { sortOrder: 'asc' },
      });
      const others = steps.filter((s) => s.id !== stepId);
      others.splice(Math.min(dto.position, others.length + 1) - 1, 0, step);
      await Promise.all(
        others.map((s, i) =>
          this.prisma.learningPathStep.update({
            where: { id: s.id },
            data: { sortOrder: i + 1 },
          }),
        ),
      );
    }
    await this.prisma.learningPathStep.update({
      where: { id: stepId },
      data: {
        ...(dto.status !== undefined
          ? {
              status: dto.status,
              completedAt:
                dto.status === 'done' || dto.status === 'skipped'
                  ? new Date()
                  : null,
              evidence:
                dto.status === 'done'
                  ? own
                    ? 'Marked done by the student'
                    : 'Marked done by staff'
                  : dto.status === 'skipped'
                    ? 'Skipped'
                    : null,
            }
          : {}),
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.reason !== undefined ? { reason: dto.reason } : {}),
      },
    });
    await this.settle(id);
    return this.getPath(id, actor);
  }

  async removeStep(id: string, stepId: string, actor: AuthenticatedUser) {
    const p = await this.pathRow(id);
    await this.manageableStudent(p.studentId, actor);
    await this.prisma.learningPathStep.deleteMany({
      where: { id: stepId, pathId: id },
    });
    await this.settle(id);
    return this.getPath(id, actor);
  }

  /** Called by the listener: a learning event finishes matching pending steps on the student's active paths. */
  async applyEvent(studentId: string, event: StepEvent): Promise<number> {
    const paths = await this.prisma.learningPath.findMany({
      where: { studentId, status: 'active' },
      include: { steps: true },
    });
    let finished = 0;
    for (const p of paths) {
      const ids = stepsFinishedBy(event, p.steps);
      if (ids.length === 0) continue;
      await this.prisma.learningPathStep.updateMany({
        where: { id: { in: ids } },
        data: {
          status: 'done',
          completedAt: new Date(),
          evidence: `Finished by ${event.kind === 'h5p' ? 'an activity result' : event.kind === 'lesson' ? 'completing the lesson' : event.kind === 'assignment' ? 'handing in the work' : 'a practice session'}`,
        },
      });
      finished += ids.length;
      await this.settle(p.id);
    }
    return finished;
  }

  /** Teacher view: every active path in a class with its progress. */
  async classPaths(classId: string, actor: AuthenticatedUser) {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        teachers: { select: { teacherId: true } },
      },
    });
    if (!klass)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    if (!isDistrictRole(actor))
      assertOrganizationAccess(actor, klass.organizationId);
    if (
      (actor.role === 'TEACHER' || actor.role === 'ASSISTANT') &&
      !klass.teachers.some((t) => t.teacherId === actor.id)
    )
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Not your class.',
      });
    const studentIds = (
      await this.prisma.classEnrollment.findMany({
        where: { classId, status: 'ENROLLED' },
        select: { studentId: true },
      })
    ).map((e) => e.studentId);
    const paths = await this.prisma.learningPath.findMany({
      where: {
        studentId: { in: studentIds },
        status: { in: ['active', 'completed'] },
      },
      include: {
        steps: { select: { status: true } },
        student: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { updatedAt: 'desc' },
    });
    return paths.map((p) => ({
      id: p.id,
      title: p.title,
      status: p.status,
      source: p.source,
      student: p.student,
      progress: pathProgress(p.steps),
      updatedAt: p.updatedAt,
    }));
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async settle(pathId: string) {
    const p = await this.prisma.learningPath.findUnique({
      where: { id: pathId },
      include: { steps: { select: { status: true } } },
    });
    if (!p) return;
    const progress = pathProgress(p.steps);
    if (progress.complete && p.status === 'active')
      await this.prisma.learningPath.update({
        where: { id: pathId },
        data: { status: 'completed', completedAt: new Date() },
      });
    else if (!progress.complete && p.status === 'completed')
      await this.prisma.learningPath.update({
        where: { id: pathId },
        data: { status: 'active', completedAt: null },
      });
  }

  private reopenIfNeeded(pathId: string) {
    return this.settle(pathId);
  }

  private async checkRefs(steps: StepInputDto[], student: StudentRow) {
    for (const s of steps) {
      if (s.kind === 'practice' || s.kind === 'tutor') continue;
      if (!s.refId)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: `A ${s.kind} step needs a refId.`,
        });
      const found =
        s.kind === 'lesson'
          ? await this.prisma.lesson.count({
              where: {
                id: s.refId,
                module: { course: { organizationId: student.organizationId } },
              },
            })
          : s.kind === 'h5p'
            ? await this.prisma.h5PContent.count({
                where: { id: s.refId, deletedAt: null },
              })
            : s.kind === 'library'
              ? await this.prisma.libraryItem.count({
                  where: { id: s.refId, deletedAt: null },
                })
              : await this.prisma.assignment.count({
                  where: {
                    id: s.refId,
                    deletedAt: null,
                    organizationId: student.organizationId,
                  },
                });
      if (!found)
        throw new NotFoundException({
          code: 'resource.not_found',
          detail: `The ${s.kind} for step "${s.title}" was not found.`,
        });
    }
  }

  private async pathRow(id: string) {
    const p = await this.prisma.learningPath.findUnique({
      where: { id },
      include: {
        steps: { orderBy: { sortOrder: 'asc' } },
        createdBy: { select: { firstName: true, lastName: true } },
      },
    });
    if (!p)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Learning path not found.',
      });
    return p;
  }

  /** Students and guardians see their own; staff of the school see theirs (teachers: students they teach). */
  private async visibleStudent(
    studentId: string,
    actor: AuthenticatedUser,
  ): Promise<StudentRow> {
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
    if (!isDistrictRole(actor))
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
          detail: 'You do not teach this student.',
        });
    }
    return student;
  }

  private async canManage(
    student: StudentRow,
    actor: AuthenticatedUser,
  ): Promise<boolean> {
    if (actor.role === 'STUDENT' || actor.role === 'PARENT') return false;
    if (isDistrictRole(actor)) return true;
    if (actor.organizationId !== student.organizationId) return false;
    if (actor.role === 'PRINCIPAL' || actor.role === 'COUNSELOR') return true;
    const teaches = await this.prisma.classEnrollment.count({
      where: {
        studentId: student.id,
        status: { in: ['ENROLLED', 'COMPLETED'] },
        class: { teachers: { some: { teacherId: actor.id } } },
      },
    });
    return teaches > 0;
  }

  private async manageableStudent(
    studentId: string,
    actor: AuthenticatedUser,
  ): Promise<StudentRow> {
    const student = await this.visibleStudent(studentId, actor);
    if (!(await this.canManage(student, actor)))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: "Only the student's teachers and school staff build paths.",
      });
    return student;
  }

  async ownStudent(actor: AuthenticatedUser): Promise<StudentRow> {
    const student = await this.prisma.student.findFirst({
      where: { userId: actor.id, deletedAt: null },
    });
    if (!student)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'No student record is attached to your account.',
      });
    return student;
  }

  private async lessonCourse(
    lessonIds: string[],
  ): Promise<Map<string, string>> {
    if (lessonIds.length === 0) return new Map();
    const rows = await this.prisma.lesson.findMany({
      where: { id: { in: lessonIds } },
      select: { id: true, module: { select: { courseId: true } } },
    });
    return new Map(rows.map((r) => [r.id, r.module.courseId]));
  }

  private async toPublic(
    p: {
      id: string;
      studentId: string;
      organizationId: string;
      title: string;
      goal: string | null;
      source: string;
      status: string;
      rationale: string | null;
      completedAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      createdBy: { firstName: string; lastName: string } | null;
      steps: Array<{
        id: string;
        sortOrder: number;
        kind: string;
        refId: string | null;
        title: string;
        reason: string | null;
        standardCode: string | null;
        status: string;
        evidence: string | null;
        completedAt: Date | null;
      }>;
    },
    actor: AuthenticatedUser,
  ) {
    const lessonCourse = await this.lessonCourse(
      p.steps
        .filter((s) => s.kind === 'lesson' && s.refId)
        .map((s) => s.refId as string),
    );
    return {
      id: p.id,
      studentId: p.studentId,
      title: p.title,
      goal: p.goal,
      source: p.source,
      status: p.status,
      rationale: p.rationale,
      createdBy: p.createdBy
        ? `${p.createdBy.firstName} ${p.createdBy.lastName}`.trim()
        : null,
      progress: pathProgress(p.steps),
      steps: p.steps.map((s) => ({
        id: s.id,
        sortOrder: s.sortOrder,
        kind: s.kind,
        refId: s.refId,
        title: s.title,
        reason: s.reason,
        standardCode: s.standardCode,
        status: s.status,
        evidence: s.evidence,
        completedAt: s.completedAt,
        href:
          s.kind === 'lesson' && s.refId && lessonCourse.get(s.refId)
            ? `/courses/${lessonCourse.get(s.refId)}?lesson=${s.refId}`
            : stepHref(s.kind, s.refId),
      })),
      canManage: actor.role !== 'STUDENT' && actor.role !== 'PARENT',
      completedAt: p.completedAt,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
