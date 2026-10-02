import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  Class,
  ClassEnrollment,
  ClassEnrollmentStatus,
  ClassStatus,
  ClassTeacher,
  Prisma,
  Role,
  User,
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
import { parseDate } from '../students/students.mapper';
import {
  AddTeacherDto,
  CreateClassDto,
  EnrollDto,
  ListClassesQuery,
  UpdateClassDto,
  type ClassEnrollmentStatusApi,
  type ClassStatusApi,
} from './dto/classes.dto';
import { decideEnrollment } from './enrollment-rules';

export interface PublicClass {
  id: string;
  organizationId: string;
  courseId: string;
  course: {
    id: string;
    courseCode: string;
    title: string;
    subject: string | null;
    gradeLevel: string | null;
  };
  name: string;
  section: string | null;
  term: string;
  startDate: string | null;
  endDate: string | null;
  room: string | null;
  meetingSchedule: string | null;
  maxStudents: number | null;
  status: ClassStatusApi;
  teachers: Array<{
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    isPrimary: boolean;
  }>;
  enrolledCount: number;
  waitlistedCount: number;
  canManage: boolean;
  myEnrollmentStatus?: ClassEnrollmentStatusApi | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PublicEnrollment {
  id: string;
  classId: string;
  studentId: string;
  student: {
    id: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
    gradeLevel: string | null;
    email: string | null;
  };
  status: ClassEnrollmentStatusApi;
  enrolledAt: Date;
  droppedAt: Date | null;
  currentGrade: number | null;
}

export interface EnrollResult {
  enrolled: string[];
  waitlisted: string[];
  skipped: string[];
  notFound: string[];
}

const SORTABLE = ['name', 'term', 'startDate', 'createdAt'] as const;
const TEACHING_ROLES: readonly Role[] = [
  'TEACHER',
  'PRINCIPAL',
  'ASSISTANT',
  'SUPERINTENDENT',
  'SUPER_ADMIN',
];

type ClassRow = Class & {
  course: {
    id: string;
    courseCode: string;
    title: string;
    subject: string | null;
    gradeLevel: string | null;
  };
  teachers: Array<
    ClassTeacher & {
      teacher: Pick<User, 'id' | 'firstName' | 'lastName' | 'email'>;
    }
  >;
  _count: { enrollments: number };
};

@Injectable()
export class ClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async list(
    q: ListClassesQuery,
    actor: AuthenticatedUser,
  ): Promise<PagedResponse<PublicClass>> {
    const where: Prisma.ClassWhereInput = {
      deletedAt: null,
      ...organizationScope(actor, q.organizationId),
      ...this.visibilityFor(actor),
      ...(q.term ? { term: q.term } : {}),
      ...(q.courseId ? { courseId: q.courseId } : {}),
      ...(q.teacherId
        ? { teachers: { some: { teacherId: q.teacherId } } }
        : {}),
      ...(q.status ? { status: statusToDb(q.status) } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search } },
              { course: { title: { contains: q.search } } },
              { course: { courseCode: { contains: q.search } } },
            ],
          }
        : {}),
    };
    const orderBy = q.orderBy(SORTABLE).map((o) => ({
      [o.field]: o.direction,
    })) as Prisma.ClassOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.prisma.class.findMany({
        where,
        orderBy: orderBy.length ? orderBy : [{ term: 'desc' }, { name: 'asc' }],
        skip: q.skip,
        take: q.pageSize,
        include: this.classInclude,
      }),
      this.prisma.class.count({ where }),
    ]);
    return PagedResponse.of(await this.toPublicMany(rows, actor), q, total);
  }

  /** Classes the caller teaches, attends, or (for parents) their children attend. */
  async mine(actor: AuthenticatedUser): Promise<PublicClass[]> {
    const rows = await this.prisma.class.findMany({
      where: {
        deletedAt: null,
        OR: [
          { teachers: { some: { teacherId: actor.id } } },
          {
            enrollments: {
              some: {
                status: { in: ['ENROLLED', 'WAITLISTED', 'COMPLETED'] },
                student: this.ownStudentFilter(actor),
              },
            },
          },
        ],
      },
      orderBy: [{ term: 'desc' }, { name: 'asc' }],
      take: 100,
      include: this.classInclude,
    });
    return this.toPublicMany(rows, actor);
  }

  async get(id: string, actor: AuthenticatedUser): Promise<PublicClass> {
    const row = await this.find(id, actor);
    return (await this.toPublicMany([row], actor))[0];
  }

  async forStudent(
    studentId: string,
    actor: AuthenticatedUser,
  ): Promise<
    Array<PublicClass & { enrollmentStatus: ClassEnrollmentStatusApi }>
  > {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      include: { guardians: { select: { guardianUserId: true } } },
    });
    if (!student)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Student not found.',
      });
    const own =
      student.userId === actor.id ||
      student.guardians.some((g) => g.guardianUserId === actor.id);
    if (!own) {
      if (
        ROLE_LEVEL[actor.role] < ROLE_LEVEL.TEACHER &&
        actor.role !== 'ASSISTANT'
      )
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'You can only view your own classes.',
        });
      assertOrganizationAccess(actor, student.organizationId);
    }
    const enrollments = await this.prisma.classEnrollment.findMany({
      where: { studentId, class: { deletedAt: null } },
      include: { class: { include: this.classInclude } },
      orderBy: { enrolledAt: 'desc' },
    });
    const classes = await this.toPublicMany(
      enrollments.map((e) => e.class),
      actor,
    );
    return classes.map((c, i) => ({
      ...c,
      enrollmentStatus: enrollments[
        i
      ].status.toLowerCase() as ClassEnrollmentStatusApi,
    }));
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async create(
    dto: CreateClassDto,
    actor: AuthenticatedUser,
  ): Promise<PublicClass> {
    const organizationId = resolveOrganizationId(actor, dto.organizationId);
    const course = await this.prisma.course.findFirst({
      where: { id: dto.courseId, organizationId, deletedAt: null },
      select: { id: true },
    });
    if (!course)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Course not found in this organisation.',
      });
    if (dto.teacherId) await this.assertTeacher(dto.teacherId, organizationId);
    const dates = this.datesFrom(dto);
    const id = newId();
    await this.prisma.class.create({
      data: {
        id,
        organizationId,
        courseId: dto.courseId,
        name: dto.name.trim(),
        section: dto.section,
        term: dto.term.trim(),
        ...dates,
        room: dto.room,
        meetingSchedule: dto.meetingSchedule,
        maxStudents: dto.maxStudents,
        status: statusToDb(dto.status) ?? 'SCHEDULED',
        teachers: dto.teacherId
          ? {
              create: {
                id: newId(),
                teacherId: dto.teacherId,
                isPrimary: true,
              },
            }
          : undefined,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'classes.create',
      entityType: 'Class',
      entityId: id,
      details: { courseId: dto.courseId, term: dto.term },
    });
    return this.get(id, actor);
  }

  async update(
    id: string,
    dto: UpdateClassDto,
    actor: AuthenticatedUser,
  ): Promise<PublicClass> {
    const existing = await this.findManageable(id, actor);
    if (
      existing.managedBySis &&
      (dto.name !== undefined ||
        dto.term !== undefined ||
        dto.section !== undefined ||
        dto.courseId !== undefined)
    )
      throw new ConflictException({
        code: 'record.managed',
        detail:
          "This record is managed by the school's student information system; change it there and it syncs overnight.",
      });
    if (dto.courseId && dto.courseId !== existing.courseId) {
      const course = await this.prisma.course.findFirst({
        where: {
          id: dto.courseId,
          organizationId: existing.organizationId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!course)
        throw new NotFoundException({
          code: 'resource.not_found',
          detail: 'Course not found in this organisation.',
        });
    }
    await this.prisma.class.update({
      where: { id },
      data: {
        courseId: dto.courseId,
        name: dto.name?.trim(),
        section: dto.section,
        term: dto.term?.trim(),
        ...this.datesFrom(dto),
        room: dto.room,
        meetingSchedule: dto.meetingSchedule,
        maxStudents: dto.maxStudents,
        status: statusToDb(dto.status),
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: existing.organizationId,
      action: 'classes.update',
      entityType: 'Class',
      entityId: id,
      details: { fields: Object.keys(dto) },
    });
    return this.get(id, actor);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.find(id, actor);
    if (!isAdmin(actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only administrators can delete a class.',
      });
    await this.prisma.class.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'CANCELLED' },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: existing.organizationId,
      action: 'classes.delete',
      entityType: 'Class',
      entityId: id,
    });
  }

  async addTeacher(
    id: string,
    dto: AddTeacherDto,
    actor: AuthenticatedUser,
  ): Promise<PublicClass> {
    const existing = await this.find(id, actor);
    await this.assertTeacher(dto.teacherId, existing.organizationId);
    if (dto.isPrimary)
      await this.prisma.classTeacher.updateMany({
        where: { classId: id },
        data: { isPrimary: false },
      });
    await this.prisma.classTeacher.upsert({
      where: { classId_teacherId: { classId: id, teacherId: dto.teacherId } },
      update: { isPrimary: dto.isPrimary ?? false },
      create: {
        id: newId(),
        classId: id,
        teacherId: dto.teacherId,
        isPrimary: dto.isPrimary ?? existing.teachers.length === 0,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: existing.organizationId,
      action: 'classes.teacher_added',
      entityType: 'Class',
      entityId: id,
      details: { teacherId: dto.teacherId, isPrimary: dto.isPrimary ?? false },
    });
    return this.get(id, actor);
  }

  async removeTeacher(
    id: string,
    teacherId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const existing = await this.find(id, actor);
    const result = await this.prisma.classTeacher.deleteMany({
      where: { classId: id, teacherId },
    });
    if (result.count === 0)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'That teacher is not assigned to this class.',
      });
    await this.audit.record({
      userId: actor.id,
      organizationId: existing.organizationId,
      action: 'classes.teacher_removed',
      entityType: 'Class',
      entityId: id,
      details: { teacherId },
    });
  }

  // ---------------------------------------------------------------------------
  // Roster
  // ---------------------------------------------------------------------------

  async roster(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<PublicEnrollment[]> {
    await this.findReadable(id, actor);
    const rows = await this.prisma.classEnrollment.findMany({
      where: { classId: id },
      include: { student: true },
      orderBy: [{ status: 'asc' }, { enrolledAt: 'asc' }],
    });
    return rows.map(toPublicEnrollment);
  }

  async enroll(
    id: string,
    dto: EnrollDto,
    actor: AuthenticatedUser,
  ): Promise<EnrollResult> {
    const klass = await this.findManageable(id, actor);
    if (klass.managedBySis)
      throw new ConflictException({
        code: 'record.managed',
        detail:
          "Enrolment for this class is managed by the school's student information system; schedule changes there sync overnight.",
      });
    const ids = [...new Set(dto.studentIds)];
    const students = await this.prisma.student.findMany({
      where: {
        id: { in: ids },
        organizationId: klass.organizationId,
        deletedAt: null,
      },
      select: { id: true, studentNumber: true },
    });
    const foundIds = new Set(students.map((s) => s.id));
    const result: EnrollResult = {
      enrolled: [],
      waitlisted: [],
      skipped: [],
      notFound: ids.filter((i) => !foundIds.has(i)),
    };
    const existing = await this.prisma.classEnrollment.findMany({
      where: { classId: id, studentId: { in: [...foundIds] } },
    });
    const byStudent = new Map(existing.map((e) => [e.studentId, e]));
    let enrolledCount = await this.prisma.classEnrollment.count({
      where: { classId: id, status: 'ENROLLED' },
    });

    for (const s of students) {
      const current = byStudent.get(s.id) ?? null;
      const decision = decideEnrollment({
        existingStatus: current?.status ?? null,
        enrolledCount,
        maxStudents: klass.maxStudents,
      });
      if (decision === 'skipped') {
        result.skipped.push(s.id);
        continue;
      }
      const status: ClassEnrollmentStatus =
        decision === 'enrolled' ? 'ENROLLED' : 'WAITLISTED';
      if (current)
        await this.prisma.classEnrollment.update({
          where: { id: current.id },
          data: { status, enrolledAt: new Date(), droppedAt: null },
        });
      else
        await this.prisma.classEnrollment.create({
          data: { id: newId(), classId: id, studentId: s.id, status },
        });
      if (status === 'ENROLLED') {
        enrolledCount++;
        result.enrolled.push(s.id);
      } else {
        result.waitlisted.push(s.id);
      }
      this.emitEnrollment(klass, s.id, status, actor);
    }
    await this.audit.record({
      userId: actor.id,
      organizationId: klass.organizationId,
      action: 'classes.enroll',
      entityType: 'Class',
      entityId: id,
      details: {
        enrolled: result.enrolled.length,
        waitlisted: result.waitlisted.length,
        skipped: result.skipped.length,
      },
    });
    return result;
  }

  async updateEnrollment(
    id: string,
    studentId: string,
    status: ClassEnrollmentStatusApi,
    actor: AuthenticatedUser,
  ): Promise<PublicEnrollment> {
    const klass = await this.findManageable(id, actor);
    if (klass.managedBySis)
      throw new ConflictException({
        code: 'record.managed',
        detail:
          "Enrolment for this class is managed by the school's student information system; schedule changes there sync overnight.",
      });
    const current = await this.prisma.classEnrollment.findUnique({
      where: { classId_studentId: { classId: id, studentId } },
    });
    if (!current)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'That student is not on this roster.',
      });
    const next = status.toUpperCase() as ClassEnrollmentStatus;
    if (
      next === 'ENROLLED' &&
      current.status !== 'ENROLLED' &&
      klass.maxStudents !== null
    ) {
      const enrolledCount = await this.prisma.classEnrollment.count({
        where: { classId: id, status: 'ENROLLED' },
      });
      if (enrolledCount >= klass.maxStudents)
        throw new ConflictException({
          code: 'class.full',
          detail: `The class is full (${klass.maxStudents} seats). Raise the capacity or drop a student first.`,
        });
    }
    const row = await this.prisma.classEnrollment.update({
      where: { id: current.id },
      data: { status: next, droppedAt: next === 'DROPPED' ? new Date() : null },
      include: { student: true },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: klass.organizationId,
      action: 'classes.enrollment_updated',
      entityType: 'Class',
      entityId: id,
      details: { studentId, status },
    });
    this.emitEnrollment(klass, studentId, next, actor);
    return toPublicEnrollment(row);
  }

  async drop(
    id: string,
    studentId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    await this.updateEnrollment(id, studentId, 'dropped', actor);
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private readonly classInclude = {
    course: {
      select: {
        id: true,
        courseCode: true,
        title: true,
        subject: true,
        gradeLevel: true,
      },
    },
    teachers: {
      include: {
        teacher: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { isPrimary: 'desc' as const },
    },
    _count: { select: { enrollments: true } },
  } satisfies Prisma.ClassInclude;

  /** Students and parents only see classes they (or their children) are on. */
  private visibilityFor(actor: AuthenticatedUser): Prisma.ClassWhereInput {
    if (actor.role !== 'STUDENT' && actor.role !== 'PARENT') return {};
    return {
      enrollments: {
        some: {
          status: { in: ['ENROLLED', 'WAITLISTED', 'COMPLETED'] },
          student: this.ownStudentFilter(actor),
        },
      },
    };
  }

  private ownStudentFilter(actor: AuthenticatedUser): Prisma.StudentWhereInput {
    return actor.role === 'PARENT'
      ? { guardians: { some: { guardianUserId: actor.id } } }
      : { userId: actor.id };
  }

  async find(id: string, actor: AuthenticatedUser): Promise<ClassRow> {
    const row = await this.prisma.class.findFirst({
      where: { id, deletedAt: null, ...this.visibilityFor(actor) },
      include: this.classInclude,
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    if (actor.role !== 'STUDENT' && actor.role !== 'PARENT')
      assertOrganizationAccess(actor, row.organizationId);
    return row;
  }

  /** Administrators manage any class in their organisation; teachers only classes they are assigned to. */
  /** Roster readers: whoever manages the class, plus assistants and staff of the same school (attendance, gradebook). */
  private async findReadable(id: string, actor: AuthenticatedUser) {
    const row = await this.prisma.class.findFirst({
      where: { id, deletedAt: null },
      include: { teachers: { select: { teacherId: true } } },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    const staffHere =
      actor.organizationId === row.organizationId &&
      (actor.role === 'ASSISTANT' ||
        ROLE_LEVEL[actor.role] >= ROLE_LEVEL.TEACHER);
    if (!canManage(row, actor) && !staffHere)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only school staff can view this roster.',
      });
    return row;
  }

  private async findManageable(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<ClassRow> {
    const row = await this.find(id, actor);
    if (row.managedBySis)
      throw new ConflictException({
        code: 'record.managed',
        detail:
          "Enrolment for this class is managed by the school's student information system; schedule changes there sync overnight.",
      });
    if (!canManage(row, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only an assigned teacher or an administrator can manage this class.',
      });
    return row;
  }

  private async assertTeacher(
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
        detail: 'Teacher account not found.',
      });
    if (!TEACHING_ROLES.includes(user.role))
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Only staff accounts can teach a class.',
      });
    if (user.organizationId && user.organizationId !== organizationId)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'That account belongs to another organisation.',
      });
  }

  private datesFrom(dto: Partial<CreateClassDto>): {
    startDate?: Date;
    endDate?: Date;
  } {
    const start = parseDate(dto.startDate);
    const end = parseDate(dto.endDate);
    if (start === null || end === null)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Dates must be YYYY-MM-DD.',
      });
    if (start && end && end < start)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'endDate must be on or after startDate.',
      });
    return { startDate: start, endDate: end };
  }

  private emitEnrollment(
    klass: ClassRow,
    studentId: string,
    status: ClassEnrollmentStatus,
    actor: AuthenticatedUser,
  ): void {
    this.events.emit(
      'enrollment.changed',
      domainEvent({
        eventType: 'enrollment.changed',
        entityType: 'ClassEnrollment',
        entityId: `${klass.id}:${studentId}`,
        organizationId: klass.organizationId,
        actorId: actor.id,
        data: { classId: klass.id, studentId, status: status.toLowerCase() },
      }),
    );
  }

  private async toPublicMany(
    rows: ClassRow[],
    actor: AuthenticatedUser,
  ): Promise<PublicClass[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const counts = await this.prisma.classEnrollment.groupBy({
      by: ['classId', 'status'],
      where: { classId: { in: ids } },
      _count: { _all: true },
    });
    const count = (classId: string, status: ClassEnrollmentStatus) =>
      counts.find((c) => c.classId === classId && c.status === status)?._count
        ._all ?? 0;
    const own =
      actor.role === 'STUDENT' || actor.role === 'PARENT'
        ? await this.prisma.classEnrollment.findMany({
            where: {
              classId: { in: ids },
              student: this.ownStudentFilter(actor),
            },
            select: { classId: true, status: true },
          })
        : [];
    return rows.map((r) => ({
      id: r.id,
      organizationId: r.organizationId,
      courseId: r.courseId,
      course: r.course,
      name: r.name,
      section: r.section,
      term: r.term,
      startDate: r.startDate ? r.startDate.toISOString().slice(0, 10) : null,
      endDate: r.endDate ? r.endDate.toISOString().slice(0, 10) : null,
      room: r.room,
      meetingSchedule: r.meetingSchedule,
      maxStudents: r.maxStudents,
      status: r.status.toLowerCase() as ClassStatusApi,
      teachers: r.teachers.map((t) => ({
        id: t.teacher.id,
        firstName: t.teacher.firstName,
        lastName: t.teacher.lastName,
        email: t.teacher.email,
        isPrimary: t.isPrimary,
      })),
      enrolledCount: count(r.id, 'ENROLLED'),
      waitlistedCount: count(r.id, 'WAITLISTED'),
      canManage: canManage(r, actor),
      ...(own.length || actor.role === 'STUDENT' || actor.role === 'PARENT'
        ? {
            myEnrollmentStatus:
              (own.find((o) => o.classId === r.id)?.status.toLowerCase() as
                ClassEnrollmentStatusApi | undefined) ?? null,
          }
        : {}),
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }
}

function isAdmin(actor: AuthenticatedUser): boolean {
  return ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL;
}

export function canManage(
  row: { organizationId: string; teachers: Array<{ teacherId: string }> },
  actor: AuthenticatedUser,
): boolean {
  if (isDistrictRole(actor)) return true;
  if (actor.organizationId !== row.organizationId) return false;
  if (actor.role === 'PRINCIPAL') return true;
  return row.teachers.some((t) => t.teacherId === actor.id);
}

function statusToDb(v: ClassStatusApi | undefined): ClassStatus | undefined {
  return v ? (v.toUpperCase() as ClassStatus) : undefined;
}

function toPublicEnrollment(
  e: ClassEnrollment & {
    student: {
      id: string;
      studentNumber: string;
      firstName: string;
      lastName: string;
      gradeLevel: string | null;
      email: string | null;
    };
  },
): PublicEnrollment {
  return {
    id: e.id,
    classId: e.classId,
    studentId: e.studentId,
    student: {
      id: e.student.id,
      studentNumber: e.student.studentNumber,
      firstName: e.student.firstName,
      lastName: e.student.lastName,
      gradeLevel: e.student.gradeLevel,
      email: e.student.email,
    },
    status: e.status.toLowerCase() as ClassEnrollmentStatusApi,
    enrolledAt: e.enrolledAt,
    droppedAt: e.droppedAt,
    currentGrade: e.currentGrade === null ? null : Number(e.currentGrade),
  };
}
