import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  Accommodation,
  BehaviorRecord,
  CounselorNote,
  Prisma,
  WellnessAlert,
} from '../../generated/prisma/client';
import { PagedResponse } from '../../common/dto/paged-response.dto';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { TenantsService } from '../tenants/tenants.service';
import { ROLE_LEVEL } from '../access/roles';
import { assertOrganizationAccess, organizationScope } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NotificationsService } from '../notifications/notifications.service';
import {
  AccommodationDto,
  AiConsentDto,
  BehaviorRecordDto,
  CaseloadDto,
  CounselorNoteDto,
  ListWellnessQuery,
  SupportSettingsDto,
  UpdateBehaviorRecordDto,
  WellnessUpdateDto,
} from './dto/support.dto';
import {
  aiAllowed,
  behaviorVisibleToFamily,
  excerptFor,
  isUnder13,
} from './support-rules';

export interface PublicAccommodation {
  studentId: string;
  plan: string;
  extendedTimePercent: number;
  readAloud: boolean;
  largeText: boolean;
  reducedMotion: boolean;
  reducedDistraction: boolean;
  notes: string | null;
  startDate: string | null;
  endDate: string | null;
  updatedAt: Date;
}
export interface MyAccommodations {
  extendedTimePercent: number;
  readAloud: boolean;
  largeText: boolean;
  reducedMotion: boolean;
  reducedDistraction: boolean;
}
const NO_ACCOMMODATIONS: MyAccommodations = {
  extendedTimePercent: 0,
  readAloud: false,
  largeText: false,
  reducedMotion: false,
  reducedDistraction: false,
};

const studentSelect = {
  id: true,
  studentNumber: true,
  firstName: true,
  lastName: true,
  gradeLevel: true,
} as const;
type StudentRef = {
  id: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  gradeLevel: string | null;
};

/**
 * Support and safety (docs/13 section 6): accommodations applied in the product, counselor caseloads and
 * private notes, the wellness queue fed by tutor escalations, behaviour records with the school's
 * parent-visibility rule, and COPPA consent for AI features.
 */
@Injectable()
export class SupportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenants: TenantsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Accommodations
  // ---------------------------------------------------------------------------

  async accommodation(
    studentId: string,
    actor: AuthenticatedUser,
  ): Promise<PublicAccommodation | null> {
    await this.studentForSupport(studentId, actor, { allowFamily: true });
    const row = await this.prisma.accommodation.findUnique({
      where: { studentId },
    });
    return row ? toAccommodation(row) : null;
  }

  async setAccommodation(
    studentId: string,
    dto: AccommodationDto,
    actor: AuthenticatedUser,
  ): Promise<PublicAccommodation> {
    const student = await this.studentForSupport(studentId, actor, {
      allowFamily: false,
    });
    if (dto.startDate && dto.endDate && dto.endDate < dto.startDate)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'The plan must end after it starts.',
      });
    const data = {
      plan: dto.plan.toUpperCase() as Accommodation['plan'],
      extendedTimePercent: dto.extendedTimePercent ?? 0,
      readAloud: dto.readAloud ?? false,
      largeText: dto.largeText ?? false,
      reducedMotion: dto.reducedMotion ?? false,
      reducedDistraction: dto.reducedDistraction ?? false,
      notes: dto.notes?.trim() || null,
      startDate: dto.startDate ? new Date(`${dto.startDate}T00:00:00Z`) : null,
      endDate: dto.endDate ? new Date(`${dto.endDate}T00:00:00Z`) : null,
      updatedById: actor.id,
    };
    const row = await this.prisma.accommodation.upsert({
      where: { studentId },
      create: {
        id: newId(),
        organizationId: student.organizationId,
        studentId,
        ...data,
      },
      update: data,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'support.accommodation.set',
      entityType: 'Student',
      entityId: studentId,
      details: { plan: dto.plan },
    });
    return toAccommodation(row);
  }

  async removeAccommodation(
    studentId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const student = await this.studentForSupport(studentId, actor, {
      allowFamily: false,
    });
    await this.prisma.accommodation.deleteMany({ where: { studentId } });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'support.accommodation.remove',
      entityType: 'Student',
      entityId: studentId,
    });
  }

  /** The flags the signed-in student's own screens apply; nothing about the plan itself. */
  async myAccommodations(actor: AuthenticatedUser): Promise<MyAccommodations> {
    if (actor.role !== 'STUDENT') return NO_ACCOMMODATIONS;
    const row = await this.prisma.accommodation.findFirst({
      where: { student: { userId: actor.id, deletedAt: null } },
    });
    if (!row || !activeToday(row)) return NO_ACCOMMODATIONS;
    return {
      extendedTimePercent: row.extendedTimePercent,
      readAloud: row.readAloud,
      largeText: row.largeText,
      reducedMotion: row.reducedMotion,
      reducedDistraction: row.reducedDistraction,
    };
  }

  /** Extended time for a student, used by assignments when a submission arrives. */
  async extendedTimePercent(studentId: string): Promise<number> {
    const row = await this.prisma.accommodation.findUnique({
      where: { studentId },
      select: { extendedTimePercent: true, startDate: true, endDate: true },
    });
    return row && activeToday(row) ? row.extendedTimePercent : 0;
  }

  // ---------------------------------------------------------------------------
  // Counselor caseload and notes
  // ---------------------------------------------------------------------------

  async caseload(
    actor: AuthenticatedUser,
    counselorId?: string,
  ): Promise<
    Array<{
      student: StudentRef;
      reason: string | null;
      assignedAt: Date;
      openAlerts: number;
    }>
  > {
    const who = this.counselorFor(actor, counselorId);
    const rows = await this.prisma.counselorCaseload.findMany({
      where: { counselorId: who },
      include: { student: { select: studentSelect } },
      orderBy: { student: { lastName: 'asc' } },
    });
    const open = await this.prisma.wellnessAlert.groupBy({
      by: ['studentId'],
      where: {
        studentId: { in: rows.map((r) => r.studentId) },
        status: { not: 'RESOLVED' },
      },
      _count: { _all: true },
    });
    const counts = new Map(open.map((o) => [o.studentId, o._count._all]));
    return rows.map((r) => ({
      student: r.student,
      reason: r.reason,
      assignedAt: r.assignedAt,
      openAlerts: counts.get(r.studentId) ?? 0,
    }));
  }

  async addToCaseload(
    dto: CaseloadDto,
    actor: AuthenticatedUser,
    counselorId?: string,
  ): Promise<void> {
    const who = this.counselorFor(actor, counselorId);
    const student = await this.prisma.student.findFirst({
      where: { id: dto.studentId, deletedAt: null },
    });
    if (!student)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Student not found.',
      });
    assertOrganizationAccess(actor, student.organizationId);
    await this.prisma.counselorCaseload.upsert({
      where: {
        counselorId_studentId: { counselorId: who, studentId: dto.studentId },
      },
      create: {
        id: newId(),
        counselorId: who,
        studentId: dto.studentId,
        reason: dto.reason,
      },
      update: { reason: dto.reason },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'support.caseload.add',
      entityType: 'Student',
      entityId: dto.studentId,
      details: { counselorId: who },
    });
  }

  async removeFromCaseload(
    studentId: string,
    actor: AuthenticatedUser,
    counselorId?: string,
  ): Promise<void> {
    const who = this.counselorFor(actor, counselorId);
    await this.prisma.counselorCaseload.deleteMany({
      where: { counselorId: who, studentId },
    });
  }

  async notes(
    studentId: string,
    actor: AuthenticatedUser,
  ): Promise<
    Array<{
      id: string;
      body: string;
      author: { id: string; firstName: string; lastName: string };
      createdAt: Date;
      updatedAt: Date;
      canEdit: boolean;
    }>
  > {
    const student = await this.counselorStudent(studentId, actor);
    const rows = await this.prisma.counselorNote.findMany({
      where: { studentId: student.id },
      include: {
        author: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((n) => ({
      id: n.id,
      body: n.body,
      author: n.author,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
      canEdit: n.authorId === actor.id,
    }));
  }

  async addNote(
    studentId: string,
    dto: CounselorNoteDto,
    actor: AuthenticatedUser,
  ): Promise<CounselorNote> {
    const student = await this.counselorStudent(studentId, actor);
    const row = await this.prisma.counselorNote.create({
      data: {
        id: newId(),
        studentId: student.id,
        authorId: actor.id,
        body: dto.body.trim(),
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'support.note.create',
      entityType: 'Student',
      entityId: studentId,
    });
    return row;
  }

  async updateNote(
    id: string,
    dto: CounselorNoteDto,
    actor: AuthenticatedUser,
  ): Promise<CounselorNote> {
    const note = await this.ownNote(id, actor);
    return this.prisma.counselorNote.update({
      where: { id: note.id },
      data: { body: dto.body.trim() },
    });
  }

  async removeNote(id: string, actor: AuthenticatedUser): Promise<void> {
    const note = await this.ownNote(id, actor);
    await this.prisma.counselorNote.delete({ where: { id: note.id } });
  }

  // ---------------------------------------------------------------------------
  // Wellness queue
  // ---------------------------------------------------------------------------

  /** Called by the tutor when the safety classifier escalates; tells counselors and the principal at once. */
  async raiseAlert(input: {
    organizationId: string | null;
    userId: string;
    conversationId: string;
    messageId: string;
    categories: string[];
    text: string;
  }): Promise<WellnessAlert | null> {
    if (!input.organizationId) return null;
    const student = await this.prisma.student.findFirst({
      where: { userId: input.userId, deletedAt: null },
      select: { id: true, firstName: true, lastName: true },
    });
    const alert = await this.prisma.wellnessAlert.create({
      data: {
        id: newId(),
        organizationId: input.organizationId,
        studentId: student?.id ?? null,
        userId: input.userId,
        conversationId: input.conversationId,
        messageId: input.messageId,
        categories: input.categories.join(',').slice(0, 200),
        excerpt: excerptFor(input.text),
      },
    });
    const responders = await this.prisma.user.findMany({
      where: {
        organizationId: input.organizationId,
        role: { in: ['COUNSELOR', 'PRINCIPAL'] },
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });
    await this.notifications.notify(
      responders.map((r) => r.id),
      {
        category: 'SYSTEM',
        title: 'Wellness alert: a student may need support',
        body: `${student ? `${student.firstName} ${student.lastName}` : 'A student'} said something to the AI tutor that needs a trusted adult (${input.categories.join(', ') || 'safety'}).`,
        link: '/wellness',
        entityType: 'WellnessAlert',
        entityId: alert.id,
        forceEmail: true,
      },
    );
    await this.audit.record({
      userId: input.userId,
      organizationId: input.organizationId,
      action: 'wellness.alert.raised',
      entityType: 'WellnessAlert',
      entityId: alert.id,
      details: { categories: input.categories, responders: responders.length },
    });
    return alert;
  }

  async alerts(
    q: ListWellnessQuery,
    actor: AuthenticatedUser,
  ): Promise<PagedResponse<PublicAlert>> {
    const where: Prisma.WellnessAlertWhereInput = {
      ...organizationScope(actor, q.organizationId),
      ...(q.status
        ? { status: q.status.toUpperCase() as WellnessAlert['status'] }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.wellnessAlert.findMany({
        where,
        include: {
          student: { select: studentSelect },
          assignedTo: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.wellnessAlert.count({ where }),
    ]);
    return PagedResponse.of(rows.map(toAlert), q, total);
  }

  async updateAlert(
    id: string,
    dto: WellnessUpdateDto,
    actor: AuthenticatedUser,
  ): Promise<PublicAlert> {
    const alert = await this.prisma.wellnessAlert.findUnique({ where: { id } });
    if (!alert)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Alert not found.',
      });
    assertOrganizationAccess(actor, alert.organizationId);
    if (dto.assignedToId) {
      const who = await this.prisma.user.findFirst({
        where: {
          id: dto.assignedToId,
          organizationId: alert.organizationId,
          role: { in: ['COUNSELOR', 'PRINCIPAL'] },
        },
      });
      if (!who)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'Assign alerts to a counselor or principal of this school.',
        });
    }
    const status = dto.status
      ? (dto.status.toUpperCase() as WellnessAlert['status'])
      : undefined;
    const row = await this.prisma.wellnessAlert.update({
      where: { id },
      data: {
        status,
        assignedToId:
          dto.assignedToId === undefined ? undefined : dto.assignedToId,
        resolution: dto.resolution?.trim() || undefined,
        resolvedAt:
          status === 'RESOLVED' ? new Date() : status ? null : undefined,
      },
      include: {
        student: { select: studentSelect },
        assignedTo: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: alert.organizationId,
      action: 'wellness.alert.update',
      entityType: 'WellnessAlert',
      entityId: id,
      details: { status: dto.status, assignedToId: dto.assignedToId },
    });
    return toAlert(row);
  }

  // ---------------------------------------------------------------------------
  // Behaviour records
  // ---------------------------------------------------------------------------

  async behavior(
    studentId: string,
    actor: AuthenticatedUser,
  ): Promise<PublicBehavior[]> {
    const { student, family } = await this.studentForBehavior(studentId, actor);
    const rows = await this.prisma.behaviorRecord.findMany({
      where: { studentId: student.id },
      include: {
        reportedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { occurredAt: 'desc' },
    });
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: student.organizationId },
      select: { behaviorVisibility: true },
    });
    const visible = family
      ? rows.filter((r) => behaviorVisibleToFamily(r, org.behaviorVisibility))
      : rows;
    return visible.map((r) =>
      toBehavior(
        r,
        org.behaviorVisibility,
        !family &&
          (r.reportedById === actor.id ||
            ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL),
      ),
    );
  }

  async addBehavior(
    studentId: string,
    dto: BehaviorRecordDto,
    actor: AuthenticatedUser,
  ): Promise<PublicBehavior> {
    const { student } = await this.studentForBehavior(studentId, actor, true);
    const row = await this.prisma.behaviorRecord.create({
      data: {
        id: newId(),
        organizationId: student.organizationId,
        studentId: student.id,
        reportedById: actor.id,
        kind: dto.kind.toUpperCase() as BehaviorRecord['kind'],
        title: dto.title.trim(),
        description: dto.description?.trim() || null,
        occurredAt: new Date(dto.occurredAt),
        location: dto.location?.trim() || null,
        actionTaken: dto.actionTaken?.trim() || null,
        parentVisible: dto.parentVisible ?? null,
      },
      include: {
        reportedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: student.organizationId },
      select: { behaviorVisibility: true },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'support.behavior.create',
      entityType: 'BehaviorRecord',
      entityId: row.id,
      details: { studentId, kind: dto.kind },
    });
    if (behaviorVisibleToFamily(row, org.behaviorVisibility)) {
      const guardians = await this.prisma.studentGuardian.findMany({
        where: { studentId: student.id, receivesNotifications: true },
        select: { guardianUserId: true },
      });
      await this.notifications.notify(
        guardians.map((g) => g.guardianUserId),
        {
          category: 'SYSTEM',
          title: `${row.kind === 'POSITIVE' ? 'Good news' : 'Behaviour note'}: ${row.title}`,
          body: `${student.firstName}: ${row.description ?? row.title}`.slice(
            0,
            300,
          ),
          link: `/students/${student.id}`,
          entityType: 'BehaviorRecord',
          entityId: row.id,
        },
      );
    }
    return toBehavior(row, org.behaviorVisibility, true);
  }

  async updateBehavior(
    id: string,
    dto: UpdateBehaviorRecordDto,
    actor: AuthenticatedUser,
  ): Promise<PublicBehavior> {
    const existing = await this.editableBehavior(id, actor);
    const row = await this.prisma.behaviorRecord.update({
      where: { id },
      data: {
        kind: dto.kind
          ? (dto.kind.toUpperCase() as BehaviorRecord['kind'])
          : undefined,
        title: dto.title?.trim(),
        description:
          dto.description === undefined
            ? undefined
            : dto.description.trim() || null,
        occurredAt: dto.occurredAt ? new Date(dto.occurredAt) : undefined,
        location:
          dto.location === undefined ? undefined : dto.location.trim() || null,
        actionTaken:
          dto.actionTaken === undefined
            ? undefined
            : dto.actionTaken.trim() || null,
        parentVisible:
          dto.parentVisible === undefined ? undefined : dto.parentVisible,
      },
      include: {
        reportedBy: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: existing.organizationId },
      select: { behaviorVisibility: true },
    });
    return toBehavior(row, org.behaviorVisibility, true);
  }

  async removeBehavior(id: string, actor: AuthenticatedUser): Promise<void> {
    const existing = await this.editableBehavior(id, actor);
    await this.prisma.behaviorRecord.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      organizationId: existing.organizationId,
      action: 'support.behavior.delete',
      entityType: 'BehaviorRecord',
      entityId: id,
    });
  }

  // ---------------------------------------------------------------------------
  // AI consent (COPPA)
  // ---------------------------------------------------------------------------

  async aiConsent(
    studentId: string,
    actor: AuthenticatedUser,
  ): Promise<PublicConsent> {
    const student = await this.studentForSupport(studentId, actor, {
      allowFamily: true,
    });
    return this.consentFor(student);
  }

  async setAiConsent(
    studentId: string,
    dto: AiConsentDto,
    actor: AuthenticatedUser,
  ): Promise<PublicConsent> {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
      include: { guardians: { select: { guardianUserId: true } } },
    });
    if (!student)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Student not found.',
      });
    const guardian = student.guardians.some(
      (g) => g.guardianUserId === actor.id,
    );
    const admin = ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL;
    if (!guardian && !admin)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          "Only the student's parent or guardian, or a school administrator, records AI consent.",
      });
    if (admin) assertOrganizationAccess(actor, student.organizationId);
    const status = dto.status.toUpperCase() as 'GRANTED' | 'DECLINED';
    const data = {
      status,
      decidedBy: guardian ? 'parent' : 'school',
      decidedById: actor.id,
      note: dto.note?.trim() || null,
      decidedAt: new Date(),
    };
    await this.prisma.aiConsent.upsert({
      where: { studentId },
      create: {
        id: newId(),
        organizationId: student.organizationId,
        studentId,
        ...data,
      },
      update: data,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'support.ai_consent.set',
      entityType: 'Student',
      entityId: studentId,
      details: { status: dto.status, by: data.decidedBy },
    });
    return this.consentFor(student);
  }

  /** Students must have consent before AI features; everyone else passes. */
  async assertAiAllowedFor(actor: AuthenticatedUser): Promise<void> {
    if (
      actor.organizationId &&
      !(await this.tenants.aiAllowedForOrganization(actor.organizationId))
    )
      throw new ForbiddenException({
        code: 'ai.disabled_by_district',
        detail: 'AI features are switched off for this school by the district.',
      });
    if (actor.role !== 'STUDENT') return;
    const student = await this.prisma.student.findFirst({
      where: { userId: actor.id, deletedAt: null },
      select: { id: true, organizationId: true, dateOfBirth: true },
    });
    if (!student) return;
    const consent = await this.consentFor(student);
    if (!consent.allowed)
      throw new ForbiddenException({
        code: 'ai.consent_required',
        detail:
          consent.reason === 'parent_declined'
            ? 'A parent or guardian has turned off AI features for this account.'
            : 'AI features need a parent or guardian to say yes first. Ask your school office.',
      });
  }

  private async consentFor(student: {
    id: string;
    organizationId: string;
    dateOfBirth: Date | null;
  }): Promise<PublicConsent> {
    const [org, row] = await Promise.all([
      this.prisma.organization.findUniqueOrThrow({
        where: { id: student.organizationId },
        select: { aiConsentDefault: true },
      }),
      this.prisma.aiConsent.findUnique({ where: { studentId: student.id } }),
    ]);
    const decision = aiAllowed({
      dateOfBirth: student.dateOfBirth,
      schoolDefault: org.aiConsentDefault,
      consent: row?.status ?? null,
    });
    return {
      studentId: student.id,
      under13: isUnder13(student.dateOfBirth),
      schoolDefault: org.aiConsentDefault.toLowerCase(),
      status: row ? row.status.toLowerCase() : 'pending',
      decidedBy: row?.decidedBy ?? null,
      decidedAt: row?.decidedAt ?? null,
      note: row?.note ?? null,
      allowed: decision.allowed,
      reason: decision.reason,
    };
  }

  // ---------------------------------------------------------------------------
  // Organisation settings
  // ---------------------------------------------------------------------------

  async settings(
    organizationId: string,
    actor: AuthenticatedUser,
  ): Promise<{
    behaviorVisibility: string;
    aiConsentDefault: string;
    studentMessaging: boolean;
  }> {
    assertOrganizationAccess(actor, organizationId);
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: {
        behaviorVisibility: true,
        aiConsentDefault: true,
        studentMessaging: true,
      },
    });
    if (!org)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Organisation not found.',
      });
    return org;
  }

  async setSettings(
    organizationId: string,
    dto: SupportSettingsDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: {
        behaviorVisibility: dto.behaviorVisibility,
        aiConsentDefault: dto.aiConsentDefault,
        studentMessaging: dto.studentMessaging,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'support.settings.update',
      entityType: 'Organization',
      entityId: organizationId,
      details: { ...dto },
    });
    return this.settings(organizationId, actor);
  }

  // ---------------------------------------------------------------------------

  /**
   * Accommodations and consent are for the student's own teachers, counselors and administrators, and
   * (when allowed) the student's family. Other teachers in the school do not see them.
   */
  private async studentForSupport(
    studentId: string,
    actor: AuthenticatedUser,
    opts: { allowFamily: boolean },
  ) {
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
      if (opts.allowFamily && family) return student;
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Not available for your account.',
      });
    }
    assertOrganizationAccess(actor, student.organizationId);
    if (actor.role === 'TEACHER' || actor.role === 'ASSISTANT') {
      const teaches = await this.prisma.classEnrollment.count({
        where: {
          studentId,
          status: { in: ['ENROLLED', 'COMPLETED'] },
          class: {
            deletedAt: null,
            teachers: { some: { teacherId: actor.id } },
          },
        },
      });
      if (!teaches)
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail:
            "Only this student's own teachers, counselors and administrators can see this.",
        });
    }
    return student;
  }

  private async studentForBehavior(
    studentId: string,
    actor: AuthenticatedUser,
    write = false,
  ) {
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
      if (write || !family)
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'Not available for your account.',
        });
      return { student, family: true };
    }
    assertOrganizationAccess(actor, student.organizationId);
    return { student, family: false };
  }

  private async editableBehavior(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<BehaviorRecord> {
    const row = await this.prisma.behaviorRecord.findUnique({ where: { id } });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Record not found.',
      });
    assertOrganizationAccess(actor, row.organizationId);
    if (
      row.reportedById !== actor.id &&
      ROLE_LEVEL[actor.role] < ROLE_LEVEL.PRINCIPAL
    )
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only the person who recorded this, or an administrator, can change it.',
      });
    return row;
  }

  private counselorFor(actor: AuthenticatedUser, counselorId?: string): string {
    if (actor.role === 'COUNSELOR') return actor.id;
    if (ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL && counselorId)
      return counselorId;
    throw new ForbiddenException({
      code: 'authz.forbidden',
      detail:
        'Counselors manage caseloads; administrators may pass a counselorId.',
    });
  }

  private async counselorStudent(studentId: string, actor: AuthenticatedUser) {
    if (actor.role !== 'COUNSELOR')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Counselor notes are private to counselors.',
      });
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, deletedAt: null },
    });
    if (!student)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Student not found.',
      });
    assertOrganizationAccess(actor, student.organizationId);
    return student;
  }

  private async ownNote(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<CounselorNote> {
    if (actor.role !== 'COUNSELOR')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Counselor notes are private to counselors.',
      });
    const note = await this.prisma.counselorNote.findUnique({ where: { id } });
    if (!note || note.authorId !== actor.id)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Note not found.',
      });
    return note;
  }
}

export interface PublicAlert {
  id: string;
  student: StudentRef | null;
  categories: string[];
  excerpt: string;
  status: string;
  assignedTo: { id: string; firstName: string; lastName: string } | null;
  resolution: string | null;
  conversationId: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}
export interface PublicBehavior {
  id: string;
  studentId: string;
  kind: string;
  title: string;
  description: string | null;
  occurredAt: Date;
  location: string | null;
  actionTaken: string | null;
  parentVisible: boolean | null;
  visibleToFamily: boolean;
  reportedBy: { id: string; firstName: string; lastName: string };
  createdAt: Date;
  canEdit: boolean;
}
export interface PublicConsent {
  studentId: string;
  under13: boolean;
  schoolDefault: string;
  status: string;
  decidedBy: string | null;
  decidedAt: Date | null;
  note: string | null;
  allowed: boolean;
  reason: string;
}

function activeToday(row: {
  startDate: Date | null;
  endDate: Date | null;
}): boolean {
  const today = new Date().toISOString().slice(0, 10);
  if (row.startDate && row.startDate.toISOString().slice(0, 10) > today)
    return false;
  if (row.endDate && row.endDate.toISOString().slice(0, 10) < today)
    return false;
  return true;
}
function toAccommodation(a: Accommodation): PublicAccommodation {
  return {
    studentId: a.studentId,
    plan: a.plan.toLowerCase(),
    extendedTimePercent: a.extendedTimePercent,
    readAloud: a.readAloud,
    largeText: a.largeText,
    reducedMotion: a.reducedMotion,
    reducedDistraction: a.reducedDistraction,
    notes: a.notes,
    startDate: a.startDate ? a.startDate.toISOString().slice(0, 10) : null,
    endDate: a.endDate ? a.endDate.toISOString().slice(0, 10) : null,
    updatedAt: a.updatedAt,
  };
}
function toAlert(
  a: WellnessAlert & {
    student: StudentRef | null;
    assignedTo: { id: string; firstName: string; lastName: string } | null;
  },
): PublicAlert {
  return {
    id: a.id,
    student: a.student,
    categories: a.categories.split(',').filter(Boolean),
    excerpt: a.excerpt,
    status: a.status.toLowerCase(),
    assignedTo: a.assignedTo,
    resolution: a.resolution,
    conversationId: a.conversationId,
    createdAt: a.createdAt,
    resolvedAt: a.resolvedAt,
  };
}
function toBehavior(
  r: BehaviorRecord & {
    reportedBy: { id: string; firstName: string; lastName: string };
  },
  rule: string,
  canEdit: boolean,
): PublicBehavior {
  return {
    id: r.id,
    studentId: r.studentId,
    kind: r.kind.toLowerCase(),
    title: r.title,
    description: r.description,
    occurredAt: r.occurredAt,
    location: r.location,
    actionTaken: r.actionTaken,
    parentVisible: r.parentVisible,
    visibleToFamily: behaviorVisibleToFamily(r, rule),
    reportedBy: r.reportedBy,
    createdAt: r.createdAt,
    canEdit,
  };
}
