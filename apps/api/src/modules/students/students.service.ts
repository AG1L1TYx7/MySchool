import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  EnrollmentStatus,
  LearningStyle,
  Prisma,
  Role,
  Student,
} from '../../generated/prisma/client';
import { randomInt } from 'node:crypto';
import { PagedResponse } from '../../common/dto/paged-response.dto';
import { domainEvent } from '../../common/events/domain-event';
import { toCsv } from '../../common/utils/csv';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import {
  assertOrganizationAccess,
  organizationScope,
  resolveOrganizationId,
} from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { UsersService } from '../users/users.service';
import {
  AddGuardianDto,
  CreateStudentDto,
  ImportStudentsDto,
  ListStudentsQuery,
  UpdateGuardianDto,
  UpdateStudentDto,
} from './dto/students.dto';
import {
  IMPORT_TEMPLATE_HEADERS,
  StudentsImportService,
  type ImportError,
  type ImportRow,
} from './students-import.service';
import {
  dateOnly,
  enrollmentStatusToDb,
  learningStyleToDb,
  parseDate,
  relationshipToDb,
  toPublicGuardian,
  toPublicStudent,
  type PublicGuardian,
  type PublicStudent,
} from './students.mapper';

/** Scalar columns shared by create, update and import. */
interface StudentFields {
  email?: string;
  phone?: string;
  dateOfBirth?: Date;
  gender?: string;
  gradeLevel?: string;
  enrollmentStatus?: EnrollmentStatus;
  enrollmentDate?: Date;
  preferredLearningStyle?: LearningStyle;
  accessibilityNeeds?: string;
  goals?: string;
  notes?: string;
  address?: string;
}

const SORTABLE = [
  'lastName',
  'firstName',
  'studentNumber',
  'gradeLevel',
  'enrollmentDate',
  'createdAt',
] as const;

export interface ImportResult {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  guardiansLinked: number;
  invitationsSent: number;
  errors: ImportError[];
}

@Injectable()
export class StudentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly importer: StudentsImportService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  async list(
    q: ListStudentsQuery,
    actor: AuthenticatedUser,
  ): Promise<PagedResponse<PublicStudent>> {
    const where = this.whereFor(q, actor);
    const orderBy = q.orderBy(SORTABLE).map((o) => ({
      [o.field]: o.direction,
    })) as Prisma.StudentOrderByWithRelationInput[];
    const [rows, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        orderBy: orderBy.length
          ? orderBy
          : [{ lastName: 'asc' }, { firstName: 'asc' }],
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.student.count({ where }),
    ]);
    return PagedResponse.of(rows.map(toPublicStudent), q, total);
  }

  /** Students and parents: the records that belong to the caller. */
  async mine(actor: AuthenticatedUser): Promise<PublicStudent[]> {
    const rows = await this.prisma.student.findMany({
      where: {
        deletedAt: null,
        OR: [
          { userId: actor.id },
          { guardians: { some: { guardianUserId: actor.id } } },
        ],
      },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
    return rows.map(toPublicStudent);
  }

  async get(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<PublicStudent & { canSupport: boolean }> {
    const student = await this.find(id, actor);
    return {
      ...toPublicStudent(student),
      canSupport: await this.canSupport(student, actor),
    };
  }

  /** Who may open the support plan and consent: the student's own teachers, counselors, administrators and family. */
  private async canSupport(
    student: {
      id: string;
      userId: string | null;
      guardians?: Array<{ guardianUserId: string }>;
    },
    actor: AuthenticatedUser,
  ): Promise<boolean> {
    if (actor.role === 'TEACHER' || actor.role === 'ASSISTANT') {
      const teaches = await this.prisma.classEnrollment.count({
        where: {
          studentId: student.id,
          status: { in: ['ENROLLED', 'COMPLETED'] },
          class: {
            deletedAt: null,
            teachers: { some: { teacherId: actor.id } },
          },
        },
      });
      return teaches > 0;
    }
    return true;
  }

  async exportCsv(
    q: ListStudentsQuery,
    actor: AuthenticatedUser,
  ): Promise<string> {
    const rows = await this.prisma.student.findMany({
      where: this.whereFor(q, actor),
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 50_000,
      include: {
        guardians: {
          where: { isPrimary: true },
          take: 1,
          include: { guardian: true },
        },
      },
    });
    const header = [...IMPORT_TEMPLATE_HEADERS];
    const data = rows.map((s) => {
      const g = s.guardians[0];
      return [
        s.studentNumber,
        s.firstName,
        s.lastName,
        s.email,
        s.phone,
        dateOnly(s.dateOfBirth),
        s.gender,
        s.gradeLevel,
        s.enrollmentStatus.toLowerCase(),
        dateOnly(s.enrollmentDate),
        s.preferredLearningStyle?.toLowerCase() ?? null,
        g?.guardian.email ?? null,
        g?.guardian.firstName ?? null,
        g?.guardian.lastName ?? null,
        g?.relationship.toLowerCase() ?? null,
      ];
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'students.export',
      entityType: 'Student',
      details: { count: rows.length },
    });
    return toCsv([header, ...data]);
  }

  importTemplate(): string {
    return toCsv([
      [...IMPORT_TEMPLATE_HEADERS],
      [
        'S-1001',
        'Ada',
        'Lovelace',
        'ada@school.edu',
        '',
        '2012-12-10',
        'female',
        '7',
        'active',
        '2026-09-01',
        'visual',
        'parent@example.com',
        'Anne',
        'Lovelace',
        'mother',
      ],
    ]);
  }

  // ---------------------------------------------------------------------------
  // Commands
  // ---------------------------------------------------------------------------

  async create(
    dto: CreateStudentDto,
    actor: AuthenticatedUser,
  ): Promise<{ student: PublicStudent; invitationSent: boolean }> {
    const organizationId = resolveOrganizationId(actor, dto.organizationId);
    const studentNumber =
      dto.studentNumber ?? (await this.nextStudentNumber(organizationId));
    await this.assertNumberFree(organizationId, studentNumber);

    let userId = dto.userId ?? null;
    let invitationSent = false;
    if (userId) await this.assertLinkableStudentUser(userId, organizationId);
    if (!userId && dto.createAccount) {
      if (!dto.email)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'An email is required to create a sign-in account.',
        });
      const created = await this.users.create(
        {
          email: dto.email,
          firstName: dto.firstName,
          lastName: dto.lastName,
          role: 'student',
          organizationId,
        },
        actor,
      );
      userId = created.user.id;
      invitationSent = created.invitationSent;
    }

    const student = await this.prisma.student.create({
      data: {
        id: newId(),
        organizationId,
        userId,
        studentNumber,
        ...this.fieldsFrom(dto),
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'students.create',
      entityType: 'Student',
      entityId: student.id,
    });
    this.events.emit(
      'student.enrolled',
      domainEvent({
        eventType: 'student.enrolled',
        entityType: 'Student',
        entityId: student.id,
        organizationId,
        actorId: actor.id,
        data: { studentNumber },
      }),
    );
    return { student: toPublicStudent(student), invitationSent };
  }

  async update(
    id: string,
    dto: UpdateStudentDto,
    actor: AuthenticatedUser,
  ): Promise<PublicStudent> {
    const existing = await this.find(id, actor);
    if (
      existing.managedBySis &&
      (dto.firstName !== undefined ||
        dto.lastName !== undefined ||
        dto.studentNumber !== undefined ||
        dto.gradeLevel !== undefined ||
        dto.email !== undefined)
    )
      throw new ConflictException({
        code: 'record.managed',
        detail:
          "This record is managed by the school's student information system; change it there and it syncs overnight.",
      });
    if (dto.studentNumber && dto.studentNumber !== existing.studentNumber)
      await this.assertNumberFree(existing.organizationId, dto.studentNumber);
    if (dto.userId && dto.userId !== existing.userId)
      await this.assertLinkableStudentUser(dto.userId, existing.organizationId);
    const student = await this.prisma.student.update({
      where: { id },
      data: {
        ...this.fieldsFrom(dto),
        studentNumber: dto.studentNumber,
        userId: dto.userId,
        firstName: dto.firstName?.trim(),
        lastName: dto.lastName?.trim(),
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: existing.organizationId,
      action: 'students.update',
      entityType: 'Student',
      entityId: id,
      details: { fields: Object.keys(dto) },
    });
    this.events.emit(
      'student.updated',
      domainEvent({
        eventType: 'student.updated',
        entityType: 'Student',
        entityId: id,
        organizationId: existing.organizationId,
        actorId: actor.id,
        data: { fields: Object.keys(dto) },
      }),
    );
    return toPublicStudent(student);
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.find(id, actor);
    await this.prisma.student.update({
      where: { id },
      data: { deletedAt: new Date(), enrollmentStatus: 'WITHDRAWN' },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: existing.organizationId,
      action: 'students.delete',
      entityType: 'Student',
      entityId: id,
    });
  }

  // ---------------------------------------------------------------------------
  // Guardians
  // ---------------------------------------------------------------------------

  async guardians(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<PublicGuardian[]> {
    await this.find(id, actor, true);
    const rows = await this.prisma.studentGuardian.findMany({
      where: { studentId: id },
      include: { guardian: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toPublicGuardian);
  }

  async addGuardian(
    id: string,
    dto: AddGuardianDto,
    actor: AuthenticatedUser,
  ): Promise<{ guardian: PublicGuardian; invitationSent: boolean }> {
    const student = await this.find(id, actor);
    const linked = await this.resolveGuardianUser(dto, student, actor);
    const existing = await this.prisma.studentGuardian.findUnique({
      where: {
        studentId_guardianUserId: {
          studentId: id,
          guardianUserId: linked.userId,
        },
      },
    });
    if (existing)
      throw new ConflictException({
        code: 'resource.conflict',
        detail: 'This guardian is already linked to the student.',
      });
    if (dto.isPrimary)
      await this.prisma.studentGuardian.updateMany({
        where: { studentId: id },
        data: { isPrimary: false },
      });
    const row = await this.prisma.studentGuardian.create({
      data: {
        id: newId(),
        studentId: id,
        guardianUserId: linked.userId,
        relationship: relationshipToDb(dto.relationship) ?? 'GUARDIAN',
        isPrimary: dto.isPrimary ?? false,
        receivesNotifications: dto.receivesNotifications ?? true,
        canViewGrades: dto.canViewGrades ?? true,
        canViewAttendance: dto.canViewAttendance ?? true,
      },
      include: { guardian: true },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'students.guardian_added',
      entityType: 'Student',
      entityId: id,
      details: { guardianUserId: linked.userId },
    });
    return {
      guardian: toPublicGuardian(row),
      invitationSent: linked.invitationSent,
    };
  }

  async updateGuardian(
    id: string,
    guardianId: string,
    dto: UpdateGuardianDto,
    actor: AuthenticatedUser,
  ): Promise<PublicGuardian> {
    const student = await this.find(id, actor);
    const link = await this.prisma.studentGuardian.findFirst({
      where: { id: guardianId, studentId: id },
    });
    if (!link)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Guardian link not found.',
      });
    if (dto.isPrimary)
      await this.prisma.studentGuardian.updateMany({
        where: { studentId: id, id: { not: guardianId } },
        data: { isPrimary: false },
      });
    const row = await this.prisma.studentGuardian.update({
      where: { id: guardianId },
      data: { ...dto, relationship: relationshipToDb(dto.relationship) },
      include: { guardian: true },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'students.guardian_updated',
      entityType: 'Student',
      entityId: id,
      details: { guardianId, ...dto },
    });
    return toPublicGuardian(row);
  }

  async removeGuardian(
    id: string,
    guardianId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const student = await this.find(id, actor);
    const result = await this.prisma.studentGuardian.deleteMany({
      where: { id: guardianId, studentId: id },
    });
    if (result.count === 0)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Guardian link not found.',
      });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'students.guardian_removed',
      entityType: 'Student',
      entityId: id,
      details: { guardianId },
    });
  }

  // ---------------------------------------------------------------------------
  // Bulk import
  // ---------------------------------------------------------------------------

  async import(
    dto: ImportStudentsDto,
    actor: AuthenticatedUser,
  ): Promise<ImportResult> {
    const organizationId = resolveOrganizationId(actor, dto.organizationId);
    const parsed = this.importer.parse(dto.csv);
    const result: ImportResult = {
      dryRun: dto.dryRun ?? false,
      total: parsed.rows.length + parsed.errors.length,
      created: 0,
      updated: 0,
      guardiansLinked: 0,
      invitationsSent: 0,
      errors: [...parsed.errors],
    };

    const numbers = parsed.rows.map((r) => r.studentNumber);
    const existing = await this.prisma.student.findMany({
      where: { organizationId, studentNumber: { in: numbers } },
      select: { id: true, studentNumber: true, deletedAt: true },
    });
    const byNumber = new Map(
      existing.map((s) => [s.studentNumber.toLowerCase(), s]),
    );

    for (const row of parsed.rows) {
      const found = byNumber.get(row.studentNumber.toLowerCase());
      if (dto.dryRun) {
        if (found) result.updated++;
        else result.created++;
        if (row.guardianEmail) result.guardiansLinked++;
        continue;
      }
      try {
        const student = found
          ? await this.applyImportUpdate(found.id, row)
          : await this.applyImportCreate(organizationId, row);
        if (found) result.updated++;
        else result.created++;
        if (row.guardianEmail) {
          const linked = await this.linkImportedGuardian(student, row, actor);
          if (linked.linked) result.guardiansLinked++;
          if (linked.invitationSent) result.invitationsSent++;
        }
      } catch (err) {
        result.errors.push({
          line: row.line,
          message:
            err instanceof Error ? err.message : 'Failed to save this row.',
        });
      }
    }
    result.errors.sort((a, b) => a.line - b.line);
    if (!dto.dryRun) {
      await this.audit.record({
        userId: actor.id,
        organizationId,
        action: 'students.import',
        entityType: 'Student',
        details: {
          created: result.created,
          updated: result.updated,
          errors: result.errors.length,
        },
      });
    }
    return result;
  }

  private importData(
    row: ImportRow,
  ): StudentFields & { firstName: string; lastName: string } {
    return {
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      dateOfBirth: row.dateOfBirth,
      gender: row.gender,
      gradeLevel: row.gradeLevel,
      enrollmentStatus: enrollmentStatusToDb(row.enrollmentStatus),
      enrollmentDate: row.enrollmentDate,
      preferredLearningStyle: learningStyleToDb(row.preferredLearningStyle),
    };
  }

  private applyImportCreate(
    organizationId: string,
    row: ImportRow,
  ): Promise<Student> {
    const data = this.importData(row);
    return this.prisma.student.create({
      data: {
        id: newId(),
        studentNumber: row.studentNumber,
        organization: { connect: { id: organizationId } },
        ...data,
        firstName: row.firstName,
        lastName: row.lastName,
      },
    });
  }

  private applyImportUpdate(id: string, row: ImportRow): Promise<Student> {
    return this.prisma.student.update({
      where: { id },
      data: { ...this.importData(row), deletedAt: null },
    });
  }

  private async linkImportedGuardian(
    student: Student,
    row: ImportRow,
    actor: AuthenticatedUser,
  ): Promise<{ linked: boolean; invitationSent: boolean }> {
    const linked = await this.resolveGuardianUser(
      {
        email: row.guardianEmail,
        firstName: row.guardianFirstName,
        lastName: row.guardianLastName,
      },
      student,
      actor,
    );
    const exists = await this.prisma.studentGuardian.findUnique({
      where: {
        studentId_guardianUserId: {
          studentId: student.id,
          guardianUserId: linked.userId,
        },
      },
      select: { id: true },
    });
    if (exists) return { linked: false, invitationSent: linked.invitationSent };
    const hasPrimary = await this.prisma.studentGuardian.count({
      where: { studentId: student.id, isPrimary: true },
    });
    await this.prisma.studentGuardian.create({
      data: {
        id: newId(),
        studentId: student.id,
        guardianUserId: linked.userId,
        relationship: relationshipToDb(row.guardianRelationship) ?? 'GUARDIAN',
        isPrimary: hasPrimary === 0,
      },
    });
    return { linked: true, invitationSent: linked.invitationSent };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private whereFor(
    q: ListStudentsQuery,
    actor: AuthenticatedUser,
  ): Prisma.StudentWhereInput {
    return {
      deletedAt: null,
      ...organizationScope(actor, q.organizationId),
      ...(q.gradeLevel ? { gradeLevel: q.gradeLevel } : {}),
      ...(q.status ? { enrollmentStatus: enrollmentStatusToDb(q.status) } : {}),
      ...(q.search
        ? {
            OR: [
              { firstName: { contains: q.search } },
              { lastName: { contains: q.search } },
              { studentNumber: { contains: q.search } },
              { email: { contains: q.search } },
            ],
          }
        : {}),
    };
  }

  /** Finds a student the actor may see: staff within their organisation, or the student/guardian themselves when `allowOwn`. */
  private async find(
    id: string,
    actor: AuthenticatedUser,
    allowOwn = false,
  ): Promise<Student> {
    const student = await this.prisma.student.findFirst({
      where: { id, deletedAt: null },
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
    if (allowOwn && own) return student;
    if (actor.role === 'STUDENT' || actor.role === 'PARENT') {
      if (own) return student;
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'You can only view your own record.',
      });
    }
    assertOrganizationAccess(actor, student.organizationId);
    return student;
  }

  private fieldsFrom(dto: Partial<CreateStudentDto>): StudentFields {
    const dob = parseDate(dto.dateOfBirth);
    const enrolled = parseDate(dto.enrollmentDate);
    if (dob === null || enrolled === null)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Dates must be YYYY-MM-DD.',
      });
    return {
      email: dto.email,
      phone: dto.phone,
      dateOfBirth: dob,
      gender: dto.gender,
      gradeLevel: dto.gradeLevel,
      enrollmentStatus: enrollmentStatusToDb(dto.enrollmentStatus),
      enrollmentDate: enrolled,
      preferredLearningStyle: learningStyleToDb(dto.preferredLearningStyle),
      accessibilityNeeds: dto.accessibilityNeeds,
      goals: dto.goals,
      notes: dto.notes,
      address: dto.address,
    };
  }

  private async assertNumberFree(
    organizationId: string,
    studentNumber: string,
  ): Promise<void> {
    const clash = await this.prisma.student.findUnique({
      where: {
        organizationId_studentNumber: { organizationId, studentNumber },
      },
      select: { id: true },
    });
    if (clash)
      throw new ConflictException({
        code: 'resource.conflict',
        detail: `Student number '${studentNumber}' is already in use.`,
      });
  }

  private async assertLinkableStudentUser(
    userId: string,
    organizationId: string,
  ): Promise<void> {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        role: true,
        organizationId: true,
        student: { select: { id: true } },
      },
    });
    if (!user)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'User account not found.',
      });
    if (user.role !== 'STUDENT')
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Only accounts with the student role can be linked.',
      });
    if (user.organizationId && user.organizationId !== organizationId)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'That account belongs to another organisation.',
      });
    if (user.student)
      throw new ConflictException({
        code: 'resource.conflict',
        detail: 'That account is already linked to a student record.',
      });
  }

  private async nextStudentNumber(organizationId: string): Promise<string> {
    const year = new Date().getUTCFullYear();
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = `S${year}-${randomInt(0, 1_000_000).toString().padStart(6, '0')}`;
      const clash = await this.prisma.student.findUnique({
        where: {
          organizationId_studentNumber: {
            organizationId,
            studentNumber: candidate,
          },
        },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    throw new ConflictException({
      code: 'resource.conflict',
      detail: 'Could not allocate a student number; supply one.',
    });
  }

  /** Existing user by id or email, otherwise a new parent account with an invitation. */
  private async resolveGuardianUser(
    dto: {
      guardianUserId?: string;
      email?: string;
      firstName?: string;
      lastName?: string;
    },
    student: Student,
    actor: AuthenticatedUser,
  ): Promise<{ userId: string; invitationSent: boolean }> {
    const user = await this.prisma.user.findFirst({
      where: dto.guardianUserId
        ? { id: dto.guardianUserId, deletedAt: null }
        : { email: dto.email, deletedAt: null },
      select: { id: true, role: true, organizationId: true },
    });
    if (user) {
      const allowed: Role[] = [
        'PARENT',
        'TEACHER',
        'PRINCIPAL',
        'SUPERINTENDENT',
        'SUPER_ADMIN',
        'ASSISTANT',
      ];
      if (!allowed.includes(user.role))
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'A student account cannot be a guardian.',
        });
      if (user.organizationId && user.organizationId !== student.organizationId)
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'That account belongs to another organisation.',
        });
      return { userId: user.id, invitationSent: false };
    }
    if (!dto.email)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Guardian account not found.',
      });
    const created = await this.users.create(
      {
        email: dto.email,
        firstName: dto.firstName?.trim() || 'Parent',
        lastName: dto.lastName?.trim() || student.lastName,
        role: 'parent',
        organizationId: student.organizationId,
      },
      actor,
    );
    return { userId: created.user.id, invitationSent: created.invitationSent };
  }
}
