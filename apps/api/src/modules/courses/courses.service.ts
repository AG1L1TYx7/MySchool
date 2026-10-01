import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  Course,
  CourseStatus,
  Lesson,
  LessonType,
  Module,
  Prisma,
} from '../../generated/prisma/client';
import { PagedResponse } from '../../common/dto/paged-response.dto';
import { domainEvent } from '../../common/events/domain-event';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import {
  assertOrganizationAccess,
  isDistrictRole,
  organizationScope,
  resolveOrganizationId,
} from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { suggestCourseCode, uniqueCourseCode } from './course-code';
import {
  CreateCourseDto,
  CreateLessonDto,
  CreateModuleDto,
  ListCoursesQuery,
  UpdateCourseDto,
  UpdateLessonDto,
  UpdateModuleDto,
  type CourseStatusApi,
  type LessonTypeApi,
} from './dto/courses.dto';

export interface PublicCourse {
  id: string;
  organizationId: string;
  courseCode: string;
  title: string;
  description: string | null;
  subject: string | null;
  gradeLevel: string | null;
  creditHours: number | null;
  estimatedHours: number | null;
  status: CourseStatusApi;
  isPublished: boolean;
  publishedAt: Date | null;
  instructorId: string | null;
  instructor: { id: string; firstName: string; lastName: string } | null;
  createdById: string | null;
  clonedFromId: string | null;
  moduleCount: number;
  lessonCount: number;
  classCount: number;
  canEdit: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicLesson {
  id: string;
  moduleId: string;
  title: string;
  description: string | null;
  lessonType: LessonTypeApi;
  content: string | null;
  contentUrl: string | null;
  h5pContentId: string | null;
  sortOrder: number;
  durationMinutes: number | null;
  isPublished: boolean;
}

export interface PublicModule {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  sortOrder: number;
  isPublished: boolean;
  estimatedMinutes: number | null;
  lessons: PublicLesson[];
}

export interface CourseDetail extends PublicCourse {
  modules: PublicModule[];
  prerequisites: Array<{ id: string; courseCode: string; title: string }>;
}

const SORTABLE = [
  'title',
  'courseCode',
  'subject',
  'gradeLevel',
  'createdAt',
  'updatedAt',
] as const;
type CourseWithCounts = Course & {
  instructor: { id: string; firstName: string; lastName: string } | null;
  _count: { modules: number; classes: number };
};

const STAFF_LEVEL = ROLE_LEVEL.TEACHER;

@Injectable()
export class CoursesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Courses
  // ---------------------------------------------------------------------------

  async list(
    q: ListCoursesQuery,
    actor: AuthenticatedUser,
  ): Promise<PagedResponse<PublicCourse>> {
    const where: Prisma.CourseWhereInput = {
      deletedAt: null,
      ...organizationScope(actor, q.organizationId),
      ...(isStaff(actor) ? {} : { isPublished: true }),
      ...(q.subject ? { subject: q.subject } : {}),
      ...(q.gradeLevel ? { gradeLevel: q.gradeLevel } : {}),
      ...(q.status ? { status: statusToDb(q.status) } : {}),
      ...(q.instructorId ? { instructorId: q.instructorId } : {}),
      ...(q.search
        ? {
            OR: [
              { title: { contains: q.search } },
              { courseCode: { contains: q.search } },
              { subject: { contains: q.search } },
            ],
          }
        : {}),
    };
    const orderBy = q.orderBy(SORTABLE).map((o) => ({
      [o.field]: o.direction,
    })) as Prisma.CourseOrderByWithRelationInput[];
    const [rows, total, lessonCounts] = await Promise.all([
      this.prisma.course.findMany({
        where,
        orderBy: orderBy.length ? orderBy : [{ title: 'asc' }],
        skip: q.skip,
        take: q.pageSize,
        include: this.courseInclude,
      }),
      this.prisma.course.count({ where }),
      this.lessonCountsFor(where),
    ]);
    return PagedResponse.of(
      rows.map((c) => this.toPublic(c, actor, lessonCounts.get(c.id) ?? 0)),
      q,
      total,
    );
  }

  async get(id: string, actor: AuthenticatedUser): Promise<CourseDetail> {
    const course = await this.find(id, actor);
    const staff = isStaff(actor);
    const [modules, prerequisites, lessonCount] = await Promise.all([
      this.prisma.module.findMany({
        where: { courseId: id, ...(staff ? {} : { isPublished: true }) },
        orderBy: { sortOrder: 'asc' },
        include: {
          lessons: {
            where: staff ? {} : { isPublished: true },
            orderBy: { sortOrder: 'asc' },
          },
        },
      }),
      this.prisma.coursePrerequisite.findMany({
        where: { courseId: id },
        include: {
          prerequisite: { select: { id: true, courseCode: true, title: true } },
        },
      }),
      this.prisma.lesson.count({ where: { module: { courseId: id } } }),
    ]);
    return {
      ...this.toPublic(course, actor, lessonCount),
      modules: modules.map((m) => toPublicModule(m, m.lessons)),
      prerequisites: prerequisites.map((p) => p.prerequisite),
    };
  }

  async create(
    dto: CreateCourseDto,
    actor: AuthenticatedUser,
  ): Promise<PublicCourse> {
    const organizationId = resolveOrganizationId(actor, dto.organizationId);
    const courseCode = dto.courseCode
      ? dto.courseCode
      : await uniqueCourseCode(
          suggestCourseCode(dto.title),
          async (code) => !(await this.codeTaken(organizationId, code)),
        );
    if (
      dto.courseCode &&
      (await this.codeTaken(organizationId, dto.courseCode))
    ) {
      throw new ConflictException({
        code: 'resource.conflict',
        detail: `Course code '${dto.courseCode}' is already in use.`,
      });
    }
    const instructorId =
      dto.instructorId ?? (actor.role === 'TEACHER' ? actor.id : null);
    if (instructorId) await this.assertInstructor(instructorId, organizationId);
    const course = await this.prisma.course.create({
      data: {
        id: newId(),
        organizationId,
        courseCode,
        title: dto.title.trim(),
        description: dto.description,
        subject: dto.subject,
        gradeLevel: dto.gradeLevel,
        creditHours: dto.creditHours,
        estimatedHours: dto.estimatedHours,
        instructorId,
        createdById: actor.id,
      },
      include: this.courseInclude,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'courses.create',
      entityType: 'Course',
      entityId: course.id,
    });
    this.events.emit(
      'course.created',
      domainEvent({
        eventType: 'course.created',
        entityType: 'Course',
        entityId: course.id,
        organizationId,
        actorId: actor.id,
        data: { courseCode, title: course.title },
      }),
    );
    return this.toPublic(course, actor, 0);
  }

  async update(
    id: string,
    dto: UpdateCourseDto,
    actor: AuthenticatedUser,
  ): Promise<PublicCourse> {
    const existing = await this.findEditable(id, actor);
    if (
      dto.courseCode &&
      dto.courseCode !== existing.courseCode &&
      (await this.codeTaken(existing.organizationId, dto.courseCode))
    ) {
      throw new ConflictException({
        code: 'resource.conflict',
        detail: `Course code '${dto.courseCode}' is already in use.`,
      });
    }
    if (dto.instructorId)
      await this.assertInstructor(dto.instructorId, existing.organizationId);
    const course = await this.prisma.course.update({
      where: { id },
      data: {
        courseCode: dto.courseCode,
        title: dto.title?.trim(),
        description: dto.description,
        subject: dto.subject,
        gradeLevel: dto.gradeLevel,
        creditHours: dto.creditHours,
        estimatedHours: dto.estimatedHours,
        instructorId: dto.instructorId,
        status: statusToDb(dto.status),
        ...(dto.status === 'archived' ? { isPublished: false } : {}),
      },
      include: this.courseInclude,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: existing.organizationId,
      action: 'courses.update',
      entityType: 'Course',
      entityId: id,
      details: { fields: Object.keys(dto) },
    });
    return this.toPublic(
      course,
      actor,
      await this.prisma.lesson.count({ where: { module: { courseId: id } } }),
    );
  }

  async setPublished(
    id: string,
    published: boolean,
    actor: AuthenticatedUser,
  ): Promise<PublicCourse> {
    const existing = await this.findEditable(id, actor);
    if (published) {
      const lessons = await this.prisma.lesson.count({
        where: {
          module: { courseId: id, isPublished: true },
          isPublished: true,
        },
      });
      if (lessons === 0)
        throw new BadRequestException({
          code: 'course.empty',
          detail:
            'Add at least one published lesson before publishing the course.',
        });
    }
    const course = await this.prisma.course.update({
      where: { id },
      data: published
        ? {
            isPublished: true,
            status: 'ACTIVE',
            publishedAt: existing.publishedAt ?? new Date(),
          }
        : {
            isPublished: false,
            status: existing.status === 'ACTIVE' ? 'DRAFT' : existing.status,
          },
      include: this.courseInclude,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: existing.organizationId,
      action: published ? 'courses.publish' : 'courses.unpublish',
      entityType: 'Course',
      entityId: id,
    });
    return this.toPublic(
      course,
      actor,
      await this.prisma.lesson.count({ where: { module: { courseId: id } } }),
    );
  }

  async clone(id: string, actor: AuthenticatedUser): Promise<PublicCourse> {
    const source = await this.find(id, actor);
    if (!isStaff(actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only staff can clone courses.',
      });
    const modules = await this.prisma.module.findMany({
      where: { courseId: id },
      orderBy: { sortOrder: 'asc' },
      include: { lessons: { orderBy: { sortOrder: 'asc' } } },
    });
    const prerequisites = await this.prisma.coursePrerequisite.findMany({
      where: { courseId: id },
    });
    const courseCode = await uniqueCourseCode(
      `${source.courseCode}-COPY`,
      async (code) => !(await this.codeTaken(source.organizationId, code)),
    );
    const copyId = newId();
    await this.prisma.$transaction(async (tx) => {
      await tx.course.create({
        data: {
          id: copyId,
          organizationId: source.organizationId,
          courseCode,
          title: `${source.title} (copy)`,
          description: source.description,
          subject: source.subject,
          gradeLevel: source.gradeLevel,
          creditHours: source.creditHours,
          estimatedHours: source.estimatedHours,
          status: 'DRAFT',
          isPublished: false,
          instructorId:
            actor.role === 'TEACHER' ? actor.id : source.instructorId,
          createdById: actor.id,
          clonedFromId: source.id,
        },
      });
      for (const m of modules) {
        const moduleId = newId();
        await tx.module.create({
          data: {
            id: moduleId,
            courseId: copyId,
            title: m.title,
            description: m.description,
            sortOrder: m.sortOrder,
            isPublished: m.isPublished,
            estimatedMinutes: m.estimatedMinutes,
          },
        });
        if (m.lessons.length) {
          await tx.lesson.createMany({
            data: m.lessons.map((l) => ({
              id: newId(),
              moduleId,
              title: l.title,
              description: l.description,
              lessonType: l.lessonType,
              content: l.content,
              contentUrl: l.contentUrl,
              h5pContentId: l.h5pContentId,
              sortOrder: l.sortOrder,
              durationMinutes: l.durationMinutes,
              isPublished: l.isPublished,
            })),
          });
        }
      }
      if (prerequisites.length) {
        await tx.coursePrerequisite.createMany({
          data: prerequisites.map((p) => ({
            id: newId(),
            courseId: copyId,
            prerequisiteCourseId: p.prerequisiteCourseId,
          })),
        });
      }
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: source.organizationId,
      action: 'courses.clone',
      entityType: 'Course',
      entityId: copyId,
      details: { clonedFromId: id },
    });
    const copy = await this.prisma.course.findUniqueOrThrow({
      where: { id: copyId },
      include: this.courseInclude,
    });
    return this.toPublic(
      copy,
      actor,
      modules.reduce((n, m) => n + m.lessons.length, 0),
    );
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.findEditable(id, actor);
    const liveClasses = await this.prisma.class.count({
      where: {
        courseId: id,
        deletedAt: null,
        status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
      },
    });
    if (liveClasses > 0)
      throw new ConflictException({
        code: 'course.in_use',
        detail: `This course has ${liveClasses} scheduled or running class(es). Complete or cancel them first.`,
      });
    await this.prisma.course.update({
      where: { id },
      data: { deletedAt: new Date(), isPublished: false, status: 'ARCHIVED' },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: existing.organizationId,
      action: 'courses.delete',
      entityType: 'Course',
      entityId: id,
    });
  }

  async setPrerequisites(
    id: string,
    courseIds: string[],
    actor: AuthenticatedUser,
  ): Promise<Array<{ id: string; courseCode: string; title: string }>> {
    const course = await this.findEditable(id, actor);
    const unique = [...new Set(courseIds)].filter((c) => c !== id);
    const found = await this.prisma.course.findMany({
      where: {
        id: { in: unique },
        organizationId: course.organizationId,
        deletedAt: null,
      },
      select: { id: true, courseCode: true, title: true },
    });
    if (found.length !== unique.length)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail:
          'One or more prerequisite courses were not found in this organisation.',
      });
    await this.prisma.$transaction([
      this.prisma.coursePrerequisite.deleteMany({ where: { courseId: id } }),
      this.prisma.coursePrerequisite.createMany({
        data: found.map((f) => ({
          id: newId(),
          courseId: id,
          prerequisiteCourseId: f.id,
        })),
      }),
    ]);
    await this.audit.record({
      userId: actor.id,
      organizationId: course.organizationId,
      action: 'courses.prerequisites_set',
      entityType: 'Course',
      entityId: id,
      details: { courseIds: found.map((f) => f.id) },
    });
    return found;
  }

  // ---------------------------------------------------------------------------
  // Modules and lessons
  // ---------------------------------------------------------------------------

  async modules(
    courseId: string,
    actor: AuthenticatedUser,
  ): Promise<PublicModule[]> {
    return (await this.get(courseId, actor)).modules;
  }

  async createModule(
    courseId: string,
    dto: CreateModuleDto,
    actor: AuthenticatedUser,
  ): Promise<PublicModule> {
    const course = await this.findEditable(courseId, actor);
    const last = await this.prisma.module.aggregate({
      where: { courseId },
      _max: { sortOrder: true },
    });
    const mod = await this.prisma.module.create({
      data: {
        id: newId(),
        courseId,
        title: dto.title.trim(),
        description: dto.description,
        estimatedMinutes: dto.estimatedMinutes,
        isPublished: dto.isPublished ?? true,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: course.organizationId,
      action: 'modules.create',
      entityType: 'Module',
      entityId: mod.id,
      details: { courseId },
    });
    return toPublicModule(mod, []);
  }

  async updateModule(
    moduleId: string,
    dto: UpdateModuleDto,
    actor: AuthenticatedUser,
  ): Promise<PublicModule> {
    const { module, course } = await this.findModuleEditable(moduleId, actor);
    const updated = await this.prisma.module.update({
      where: { id: module.id },
      data: {
        title: dto.title?.trim(),
        description: dto.description,
        estimatedMinutes: dto.estimatedMinutes,
        isPublished: dto.isPublished,
      },
      include: { lessons: { orderBy: { sortOrder: 'asc' } } },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: course.organizationId,
      action: 'modules.update',
      entityType: 'Module',
      entityId: moduleId,
    });
    return toPublicModule(updated, updated.lessons);
  }

  async removeModule(
    moduleId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const { course } = await this.findModuleEditable(moduleId, actor);
    await this.prisma.module.delete({ where: { id: moduleId } });
    await this.audit.record({
      userId: actor.id,
      organizationId: course.organizationId,
      action: 'modules.delete',
      entityType: 'Module',
      entityId: moduleId,
    });
  }

  async reorderModules(
    courseId: string,
    ids: string[],
    actor: AuthenticatedUser,
  ): Promise<PublicModule[]> {
    await this.findEditable(courseId, actor);
    const current = await this.prisma.module.findMany({
      where: { courseId },
      select: { id: true },
    });
    assertSameSet(
      current.map((m) => m.id),
      ids,
      'modules',
    );
    await this.prisma.$transaction(
      ids.map((id, i) =>
        this.prisma.module.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
    return this.modules(courseId, actor);
  }

  async createLesson(
    moduleId: string,
    dto: CreateLessonDto,
    actor: AuthenticatedUser,
  ): Promise<PublicLesson> {
    const { course } = await this.findModuleEditable(moduleId, actor);
    const last = await this.prisma.lesson.aggregate({
      where: { moduleId },
      _max: { sortOrder: true },
    });
    const lesson = await this.prisma.lesson.create({
      data: {
        id: newId(),
        moduleId,
        title: dto.title.trim(),
        description: dto.description,
        lessonType: lessonTypeToDb(dto.lessonType) ?? 'TEXT',
        content: dto.content,
        contentUrl: dto.contentUrl,
        durationMinutes: dto.durationMinutes,
        isPublished: dto.isPublished ?? true,
        sortOrder: (last._max.sortOrder ?? -1) + 1,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: course.organizationId,
      action: 'lessons.create',
      entityType: 'Lesson',
      entityId: lesson.id,
      details: { moduleId },
    });
    return toPublicLesson(lesson);
  }

  async updateLesson(
    lessonId: string,
    dto: UpdateLessonDto,
    actor: AuthenticatedUser,
  ): Promise<PublicLesson> {
    const { course } = await this.findLessonEditable(lessonId, actor);
    const lesson = await this.prisma.lesson.update({
      where: { id: lessonId },
      data: {
        title: dto.title?.trim(),
        description: dto.description,
        lessonType: lessonTypeToDb(dto.lessonType),
        content: dto.content,
        contentUrl: dto.contentUrl,
        durationMinutes: dto.durationMinutes,
        isPublished: dto.isPublished,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: course.organizationId,
      action: 'lessons.update',
      entityType: 'Lesson',
      entityId: lessonId,
    });
    return toPublicLesson(lesson);
  }

  async removeLesson(
    lessonId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const { course } = await this.findLessonEditable(lessonId, actor);
    await this.prisma.lesson.delete({ where: { id: lessonId } });
    await this.audit.record({
      userId: actor.id,
      organizationId: course.organizationId,
      action: 'lessons.delete',
      entityType: 'Lesson',
      entityId: lessonId,
    });
  }

  async reorderLessons(
    moduleId: string,
    ids: string[],
    actor: AuthenticatedUser,
  ): Promise<PublicLesson[]> {
    await this.findModuleEditable(moduleId, actor);
    const current = await this.prisma.lesson.findMany({
      where: { moduleId },
      select: { id: true },
    });
    assertSameSet(
      current.map((l) => l.id),
      ids,
      'lessons',
    );
    await this.prisma.$transaction(
      ids.map((id, i) =>
        this.prisma.lesson.update({ where: { id }, data: { sortOrder: i } }),
      ),
    );
    const lessons = await this.prisma.lesson.findMany({
      where: { moduleId },
      orderBy: { sortOrder: 'asc' },
    });
    return lessons.map(toPublicLesson);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private readonly courseInclude = {
    instructor: { select: { id: true, firstName: true, lastName: true } },
    _count: { select: { modules: true, classes: true } },
  } satisfies Prisma.CourseInclude;

  /** A course the actor may see: staff in its organisation, or anyone in the organisation when published. */
  async find(id: string, actor: AuthenticatedUser): Promise<CourseWithCounts> {
    const course = await this.prisma.course.findFirst({
      where: { id, deletedAt: null },
      include: this.courseInclude,
    });
    if (!course)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Course not found.',
      });
    assertOrganizationAccess(actor, course.organizationId);
    if (!isStaff(actor) && !course.isPublished)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Course not found.',
      });
    return course;
  }

  private async findEditable(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<CourseWithCounts> {
    const course = await this.find(id, actor);
    if (!canEdit(course, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only the course instructor, its creator or an administrator can change this course.',
      });
    return course;
  }

  private async findModuleEditable(
    moduleId: string,
    actor: AuthenticatedUser,
  ): Promise<{ module: Module; course: CourseWithCounts }> {
    const module = await this.prisma.module.findUnique({
      where: { id: moduleId },
    });
    if (!module)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Module not found.',
      });
    return { module, course: await this.findEditable(module.courseId, actor) };
  }

  private async findLessonEditable(
    lessonId: string,
    actor: AuthenticatedUser,
  ): Promise<{ lesson: Lesson; course: CourseWithCounts }> {
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { module: { select: { courseId: true } } },
    });
    if (!lesson)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Lesson not found.',
      });
    return {
      lesson,
      course: await this.findEditable(lesson.module.courseId, actor),
    };
  }

  private async codeTaken(
    organizationId: string,
    courseCode: string,
  ): Promise<boolean> {
    return (
      (await this.prisma.course.count({
        where: { organizationId, courseCode },
      })) > 0
    );
  }

  private async assertInstructor(
    userId: string,
    organizationId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: { role: true, organizationId: true },
    });
    if (!user)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Instructor account not found.',
      });
    if (ROLE_LEVEL[user.role] < STAFF_LEVEL)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'The instructor must be a teacher or above.',
      });
    if (user.organizationId && user.organizationId !== organizationId)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'The instructor belongs to another organisation.',
      });
  }

  private async lessonCountsFor(
    where: Prisma.CourseWhereInput,
  ): Promise<Map<string, number>> {
    const grouped = await this.prisma.lesson.groupBy({
      by: ['moduleId'],
      where: { module: { course: where } },
      _count: { _all: true },
    });
    if (grouped.length === 0) return new Map();
    const modules = await this.prisma.module.findMany({
      where: { id: { in: grouped.map((g) => g.moduleId) } },
      select: { id: true, courseId: true },
    });
    const byModule = new Map(modules.map((m) => [m.id, m.courseId]));
    const out = new Map<string, number>();
    for (const g of grouped) {
      const courseId = byModule.get(g.moduleId);
      if (courseId) out.set(courseId, (out.get(courseId) ?? 0) + g._count._all);
    }
    return out;
  }

  toPublic(
    c: CourseWithCounts,
    actor: AuthenticatedUser,
    lessonCount: number,
  ): PublicCourse {
    return {
      id: c.id,
      organizationId: c.organizationId,
      courseCode: c.courseCode,
      title: c.title,
      description: c.description,
      subject: c.subject,
      gradeLevel: c.gradeLevel,
      creditHours: c.creditHours === null ? null : Number(c.creditHours),
      estimatedHours: c.estimatedHours,
      status: c.status.toLowerCase() as CourseStatusApi,
      isPublished: c.isPublished,
      publishedAt: c.publishedAt,
      instructorId: c.instructorId,
      instructor: c.instructor,
      createdById: c.createdById,
      clonedFromId: c.clonedFromId,
      moduleCount: c._count.modules,
      lessonCount,
      classCount: c._count.classes,
      canEdit: canEdit(c, actor),
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }
}

export function isStaff(actor: AuthenticatedUser): boolean {
  return ROLE_LEVEL[actor.role] >= STAFF_LEVEL;
}

/** Administrators edit any course in their organisation; teachers only those they instruct or created. */
export function canEdit(
  course: Pick<Course, 'organizationId' | 'instructorId' | 'createdById'>,
  actor: AuthenticatedUser,
): boolean {
  if (isDistrictRole(actor)) return true;
  if (actor.organizationId !== course.organizationId) return false;
  if (actor.role === 'PRINCIPAL') return true;
  if (actor.role === 'TEACHER')
    return course.instructorId === actor.id || course.createdById === actor.id;
  return false;
}

function assertSameSet(
  current: string[],
  requested: string[],
  what: string,
): void {
  const a = [...current].sort().join(',');
  const b = [...new Set(requested)].sort().join(',');
  if (a !== b)
    throw new BadRequestException({
      code: 'request.invalid',
      detail: `The order must list every current ${what} exactly once.`,
    });
}

function statusToDb(v: CourseStatusApi | undefined): CourseStatus | undefined {
  return v ? (v.toUpperCase() as CourseStatus) : undefined;
}
function lessonTypeToDb(v: LessonTypeApi | undefined): LessonType | undefined {
  return v ? (v.toUpperCase() as LessonType) : undefined;
}
function toPublicLesson(l: Lesson): PublicLesson {
  return {
    id: l.id,
    moduleId: l.moduleId,
    title: l.title,
    description: l.description,
    lessonType: l.lessonType.toLowerCase() as LessonTypeApi,
    content: l.content,
    contentUrl: l.contentUrl,
    h5pContentId: l.h5pContentId,
    sortOrder: l.sortOrder,
    durationMinutes: l.durationMinutes,
    isPublished: l.isPublished,
  };
}
function toPublicModule(m: Module, lessons: Lesson[]): PublicModule {
  return {
    id: m.id,
    courseId: m.courseId,
    title: m.title,
    description: m.description,
    sortOrder: m.sortOrder,
    isPublished: m.isPublished,
    estimatedMinutes: m.estimatedMinutes,
    lessons: lessons.map(toPublicLesson),
  };
}
