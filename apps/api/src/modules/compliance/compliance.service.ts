import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { strToU8, zipSync } from 'fflate';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import { assertOrganizationAccess, isDistrictRole } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { NotificationsService } from '../notifications/notifications.service';
import {
  CreateDeletionRequestDto,
  CreateIncidentDto,
  DecideDeletionDto,
  RetentionDto,
  UpdateIncidentDto,
} from './dto/compliance.dto';
import {
  appendTimeline,
  canExecuteDeletion,
  canMoveIncident,
  cutoffFor,
  clampRetention,
  DATA_MAP,
  DELETION_PLAN,
  exportManifest,
  incidentDeadlines,
  parseRetention,
  RETENTION_BOUNDS,
  RETENTION_KEYS,
  scheduleFor,
  type IncidentSeverity,
  type IncidentStatus,
  type RetentionPolicy,
  type TimelineEntry,
} from './compliance-rules';

const ADMIN_ROLES = ['PRINCIPAL', 'SUPERINTENDENT', 'SUPER_ADMIN'] as const;

/**
 * Compliance (docs/13 section 10, docs/17 and docs/18): the data map with live counts, retention settings and
 * the nightly job that applies them, deletion requests with a grace period and an administrator's decision,
 * the FERPA records export, and security incidents with their notification clock.
 */
@Injectable()
export class ComplianceService {
  private readonly logger = new Logger(ComplianceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Data map and retention
  // ---------------------------------------------------------------------------

  async dataMap(organizationId: string, actor: AuthenticatedUser) {
    this.adminOf(organizationId, actor);
    const policy = await this.policyFor(organizationId);
    const entries = [];
    for (const entry of DATA_MAP) {
      const rows = await this.countFor(entry.model, organizationId);
      entries.push({
        ...entry,
        rows,
        retentionDays: entry.retention ? policy[entry.retention] : null,
      });
    }
    return {
      organizationId,
      generatedAt: new Date(),
      retention: policy,
      bounds: RETENTION_BOUNDS,
      entries,
    };
  }

  private async countFor(
    model: string,
    organizationId: string,
  ): Promise<number> {
    const byOrg = { organizationId };
    const byStudent = { student: { organizationId } };
    const byUser = { user: { organizationId } };
    switch (model) {
      case 'user':
        return this.prisma.user.count({ where: { ...byOrg, deletedAt: null } });
      case 'student':
        return this.prisma.student.count({ where: byOrg });
      case 'studentGuardian':
        return this.prisma.studentGuardian.count({ where: byStudent });
      case 'classEnrollment':
        return this.prisma.classEnrollment.count({ where: byStudent });
      case 'assignmentSubmission':
        return this.prisma.assignmentSubmission.count({ where: byStudent });
      case 'grade':
        return this.prisma.grade.count({ where: byStudent });
      case 'attendance':
        return this.prisma.attendance.count({ where: byStudent });
      case 'reportCard':
        return this.prisma.reportCard.count({ where: byOrg });
      case 'accommodation':
        return this.prisma.accommodation.count({ where: byOrg });
      case 'behaviorRecord':
        return this.prisma.behaviorRecord.count({ where: byOrg });
      case 'counselorNote':
        return this.prisma.counselorNote.count({ where: byStudent });
      case 'aiConversation':
        return this.prisma.aiConversation.count({
          where: { ...byOrg, deletedAt: null },
        });
      case 'aiConsent':
        return this.prisma.aiConsent.count({ where: byOrg });
      case 'message':
        return this.prisma.message.count({
          where: { sender: { organizationId } },
        });
      case 'notification':
        return this.prisma.notification.count({
          where: { recipient: { organizationId } },
        });
      case 'pushDevice':
        return this.prisma.pushDevice.count({ where: byUser });
      case 'pushLog':
        return this.prisma.pushLog.count({ where: byUser });
      case 'xapiStatement':
        return this.prisma.xapiStatement.count({ where: byOrg });
      case 'srsCard':
        return this.prisma.srsCard.count({ where: byOrg });
      case 'masteryLevel':
        return this.prisma.masteryLevel.count({ where: byStudent });
      case 'rewardTransaction':
        return this.prisma.rewardTransaction.count({ where: byStudent });
      case 'auditLog':
        return this.prisma.auditLog.count({ where: byOrg });
      case 'fileUpload':
        return this.prisma.fileUpload.count({ where: byOrg });
      default:
        return 0;
    }
  }

  async retention(organizationId: string, actor: AuthenticatedUser) {
    this.adminOf(organizationId, actor);
    return {
      retention: await this.policyFor(organizationId),
      bounds: RETENTION_BOUNDS,
    };
  }

  async setRetention(
    organizationId: string,
    dto: RetentionDto,
    actor: AuthenticatedUser,
  ) {
    this.adminOf(organizationId, actor);
    const current = await this.policyFor(organizationId);
    const next: RetentionPolicy = { ...current };
    for (const key of RETENTION_KEYS) {
      const v = dto[key];
      if (typeof v === 'number') next[key] = clampRetention(key, v);
    }
    await this.prisma.organization.update({
      where: { id: organizationId },
      data: { retentionPolicy: JSON.stringify(next) },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'compliance.retention.update',
      entityType: 'Organization',
      entityId: organizationId,
      details: { before: current, after: next },
    });
    return { retention: next, bounds: RETENTION_BOUNDS };
  }

  private async policyFor(organizationId: string): Promise<RetentionPolicy> {
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: { retentionPolicy: true },
    });
    if (!org)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Organisation not found.',
      });
    return parseRetention(org.retentionPolicy);
  }

  /** Runs the school's retention policy now and says what went. */
  async runRetention(organizationId: string, actor: AuthenticatedUser) {
    this.adminOf(organizationId, actor);
    const result = await this.applyRetentionFor(organizationId, new Date());
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'compliance.retention.run',
      entityType: 'Organization',
      entityId: organizationId,
      details: result,
    });
    return result;
  }

  /** Nightly at 03:40: every school's retention policy. */
  @Cron('40 3 * * *')
  async applyRetention(): Promise<number> {
    const orgs = await this.prisma.organization.findMany({
      where: { deletedAt: null },
      select: { id: true },
    });
    let n = 0;
    for (const o of orgs) {
      try {
        const result = await this.applyRetentionFor(o.id, new Date());
        await this.audit.record({
          userId: null,
          organizationId: o.id,
          action: 'compliance.retention.run',
          entityType: 'Organization',
          entityId: o.id,
          details: result,
        });
        n += 1;
      } catch (err) {
        this.logger.warn(
          `Retention failed for ${o.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return n;
  }

  private async applyRetentionFor(organizationId: string, now: Date) {
    const policy = await this.policyFor(organizationId);
    const removed: Record<string, number> = {};
    const ai = cutoffFor(policy.aiConversations, now);
    if (ai)
      removed.aiConversations = (
        await this.prisma.aiConversation.deleteMany({
          where: { organizationId, updatedAt: { lt: ai } },
        })
      ).count;
    const notif = cutoffFor(policy.notifications, now);
    if (notif)
      removed.notifications = (
        await this.prisma.notification.deleteMany({
          where: { recipient: { organizationId }, createdAt: { lt: notif } },
        })
      ).count;
    const audit = cutoffFor(policy.auditLogs, now);
    if (audit)
      removed.auditLogs = (
        await this.prisma.auditLog.deleteMany({
          where: { organizationId, timestamp: { lt: audit } },
        })
      ).count;
    const learning = cutoffFor(policy.learningRecords, now);
    if (learning)
      removed.learningRecords = (
        await this.prisma.xapiStatement.deleteMany({
          where: { organizationId, timestamp: { lt: learning } },
        })
      ).count;
    const push = cutoffFor(policy.pushLogs, now);
    if (push)
      removed.pushLogs = (
        await this.prisma.pushLog.deleteMany({
          where: { user: { organizationId }, createdAt: { lt: push } },
        })
      ).count;
    const withdrawn = cutoffFor(policy.withdrawnStudents, now);
    if (withdrawn) {
      const gone = await this.prisma.student.findMany({
        where: {
          organizationId,
          enrollmentStatus: 'WITHDRAWN',
          legalHold: false,
          deletedAt: { not: null, lt: withdrawn },
        },
        select: { id: true },
      });
      let count = 0;
      for (const s of gone) {
        await this.eraseStudent(s.id);
        count += 1;
      }
      removed.withdrawnStudents = count;
    }
    return { organizationId, ranAt: now, policy, removed };
  }

  // ---------------------------------------------------------------------------
  // Deletion requests
  // ---------------------------------------------------------------------------

  async requestDeletion(
    studentId: string,
    dto: CreateDeletionRequestDto,
    actor: AuthenticatedUser,
  ) {
    const student = await this.visibleStudent(studentId, actor, {
      familyOnly: true,
    });
    const open = await this.prisma.deletionRequest.findFirst({
      where: { studentId, status: { in: ['pending', 'approved'] } },
      select: { id: true },
    });
    if (open)
      throw new BadRequestException({
        code: 'compliance.request_exists',
        detail: 'A deletion request for this student is already open.',
      });
    const row = await this.prisma.deletionRequest.create({
      data: {
        id: newId(),
        organizationId: student.organizationId,
        studentId,
        studentName: `${student.firstName} ${student.lastName}`,
        studentNumber: student.studentNumber,
        requestedById: actor.id,
        reason: dto.reason?.trim() || null,
      },
    });
    const admins = await this.prisma.user.findMany({
      where: {
        organizationId: student.organizationId,
        role: { in: [...ADMIN_ROLES] },
        deletedAt: null,
      },
      select: { id: true },
    });
    await this.notifications.notify(
      admins.map((a) => a.id),
      {
        category: 'SYSTEM',
        title: `Deletion request for ${row.studentName}`,
        body: "A family member or administrator asked for this student's records to be erased. Review it under Compliance.",
        link: '/compliance?tab=deletion',
        entityType: 'DeletionRequest',
        entityId: row.id,
      },
    );
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'compliance.deletion.request',
      entityType: 'Student',
      entityId: studentId,
      details: { requestId: row.id },
    });
    return this.toRequest(row);
  }

  async deletionRequests(organizationId: string, actor: AuthenticatedUser) {
    this.adminOf(organizationId, actor);
    const rows = await this.prisma.deletionRequest.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return rows.map((r) => this.toRequest(r));
  }

  async myDeletionRequests(studentId: string, actor: AuthenticatedUser) {
    await this.visibleStudent(studentId, actor, { familyOnly: true });
    const rows = await this.prisma.deletionRequest.findMany({
      where: { studentId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return rows.map((r) => this.toRequest(r));
  }

  async decideDeletion(
    id: string,
    dto: DecideDeletionDto,
    actor: AuthenticatedUser,
  ) {
    const row = await this.requestFor(id, actor);
    if (row.status !== 'pending')
      throw new BadRequestException({
        code: 'compliance.already_decided',
        detail: 'This request has already been decided.',
      });
    const now = new Date();
    const updated = await this.prisma.deletionRequest.update({
      where: { id },
      data:
        dto.decision === 'approve'
          ? {
              status: 'approved',
              decidedById: actor.id,
              decidedAt: now,
              scheduledFor: scheduleFor(now),
              summary: dto.note ?? null,
            }
          : {
              status: 'rejected',
              decidedById: actor.id,
              decidedAt: now,
              summary: dto.note ?? null,
            },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: `compliance.deletion.${dto.decision}`,
      entityType: 'DeletionRequest',
      entityId: id,
      details: { studentId: row.studentId, scheduledFor: updated.scheduledFor },
    });
    await this.notifications.notify([row.requestedById], {
      category: 'SYSTEM',
      title:
        dto.decision === 'approve'
          ? `Deletion approved for ${row.studentName}`
          : `Deletion request for ${row.studentName} was declined`,
      body:
        dto.decision === 'approve'
          ? `The records will be erased on ${updated.scheduledFor?.toISOString().slice(0, 10)} unless the request is withdrawn.`
          : (dto.note ?? null),
      link: '/family',
      entityType: 'DeletionRequest',
      entityId: id,
    });
    return this.toRequest(updated);
  }

  /** Erases now instead of waiting for the grace period; still refused under a legal hold. */
  async executeDeletion(id: string, actor: AuthenticatedUser) {
    const row = await this.requestFor(id, actor);
    if (row.status !== 'approved' || !row.studentId)
      throw new BadRequestException({
        code: 'compliance.not_approved',
        detail: 'Only an approved request can be carried out.',
      });
    const student = await this.prisma.student.findUnique({
      where: { id: row.studentId },
      select: { legalHold: true },
    });
    if (!student)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Student not found.',
      });
    if (student.legalHold)
      throw new ForbiddenException({
        code: 'compliance.legal_hold',
        detail: 'This student is under a legal hold; lift it first.',
      });
    return this.complete(row.id, row.studentId, row.organizationId, actor.id);
  }

  /** Nightly at 03:50: approved requests whose grace period has passed. */
  @Cron('50 3 * * *')
  async executeDue(): Promise<number> {
    const now = new Date();
    const due = await this.prisma.deletionRequest.findMany({
      where: { status: 'approved', scheduledFor: { lte: now } },
      include: { student: { select: { legalHold: true } } },
    });
    let n = 0;
    for (const r of due) {
      if (
        !r.studentId ||
        !canExecuteDeletion(
          {
            status: r.status,
            scheduledFor: r.scheduledFor,
            legalHold: r.student?.legalHold ?? false,
          },
          now,
        )
      )
        continue;
      try {
        await this.complete(r.id, r.studentId, r.organizationId, null);
        n += 1;
      } catch (err) {
        this.logger.warn(
          `Deletion ${r.id} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return n;
  }

  private async complete(
    requestId: string,
    studentId: string,
    organizationId: string,
    actorId: string | null,
  ) {
    const summary = await this.eraseStudent(studentId);
    const updated = await this.prisma.deletionRequest.update({
      where: { id: requestId },
      data: {
        status: 'completed',
        completedAt: new Date(),
        summary: JSON.stringify(summary),
      },
    });
    await this.audit.record({
      userId: actorId,
      organizationId,
      action: 'compliance.deletion.complete',
      entityType: 'DeletionRequest',
      entityId: requestId,
      details: summary,
    });
    return this.toRequest(updated);
  }

  /** Hard delete: the student row (everything cascades) and the sign-in account when it was only a student's. */
  private async eraseStudent(
    studentId: string,
  ): Promise<Record<string, number>> {
    const student = await this.prisma.student.findUnique({
      where: { id: studentId },
      select: { id: true, userId: true },
    });
    if (!student) return {};
    const [
      enrollments,
      submissions,
      grades,
      attendance,
      reportCards,
      support,
      ai,
      learning,
      motivation,
      family,
    ] = await Promise.all([
      this.prisma.classEnrollment.count({ where: { studentId } }),
      this.prisma.assignmentSubmission.count({ where: { studentId } }),
      this.prisma.grade.count({ where: { studentId } }),
      this.prisma.attendance.count({ where: { studentId } }),
      this.prisma.reportCard.count({ where: { studentId } }),
      this.prisma.behaviorRecord.count({ where: { studentId } }),
      student.userId
        ? this.prisma.aiConversation.count({
            where: { userId: student.userId },
          })
        : Promise.resolve(0),
      this.prisma.xapiStatement.count({ where: { studentId } }),
      this.prisma.rewardTransaction.count({ where: { studentId } }),
      this.prisma.studentGuardian.count({ where: { studentId } }),
    ]);
    await this.prisma.student.delete({ where: { id: studentId } });
    if (student.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: student.userId },
        select: { role: true },
      });
      if (user?.role === 'STUDENT')
        await this.prisma.user.delete({ where: { id: student.userId } });
    }
    return {
      profile: 1,
      enrollments,
      submissions,
      grades,
      attendance,
      reportCards,
      support,
      ai,
      learning,
      motivation,
      family,
    };
  }

  async setLegalHold(
    studentId: string,
    legalHold: boolean,
    actor: AuthenticatedUser,
  ) {
    const student = await this.prisma.student.findFirst({
      where: { id: studentId },
      select: { id: true, organizationId: true },
    });
    if (!student)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Student not found.',
      });
    this.adminOf(student.organizationId, actor);
    await this.prisma.student.update({
      where: { id: studentId },
      data: { legalHold },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: legalHold
        ? 'compliance.legal_hold.set'
        : 'compliance.legal_hold.lift',
      entityType: 'Student',
      entityId: studentId,
      details: {},
    });
    return { studentId, legalHold };
  }

  deletionPlan() {
    return { graceDays: 30, removes: DELETION_PLAN };
  }

  private async requestFor(id: string, actor: AuthenticatedUser) {
    const row = await this.prisma.deletionRequest.findUnique({ where: { id } });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Deletion request not found.',
      });
    this.adminOf(row.organizationId, actor);
    return row;
  }

  private toRequest(r: {
    id: string;
    organizationId: string;
    studentId: string | null;
    studentName: string;
    studentNumber: string;
    requestedById: string;
    reason: string | null;
    status: string;
    scheduledFor: Date | null;
    decidedAt: Date | null;
    completedAt: Date | null;
    summary: string | null;
    createdAt: Date;
  }) {
    let summary: unknown = r.summary;
    try {
      if (r.summary && r.summary.startsWith('{'))
        summary = JSON.parse(r.summary);
    } catch {
      /* a note, not JSON */
    }
    return {
      id: r.id,
      organizationId: r.organizationId,
      studentId: r.studentId,
      studentName: r.studentName,
      studentNumber: r.studentNumber,
      requestedById: r.requestedById,
      reason: r.reason,
      status: r.status,
      scheduledFor: r.scheduledFor,
      decidedAt: r.decidedAt,
      completedAt: r.completedAt,
      summary,
      createdAt: r.createdAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Records export (FERPA)
  // ---------------------------------------------------------------------------

  async recordsExport(
    studentId: string,
    actor: AuthenticatedUser,
  ): Promise<{ fileName: string; zip: Uint8Array }> {
    const student = await this.visibleStudent(studentId, actor, {
      familyOnly: false,
    });
    const [
      guardians,
      enrollments,
      submissions,
      grades,
      attendance,
      reportCards,
      accommodation,
      behaviour,
      conversations,
      statements,
      mastery,
      rewards,
      badges,
    ] = await Promise.all([
      this.prisma.studentGuardian.findMany({
        where: { studentId },
        include: {
          guardian: {
            select: { firstName: true, lastName: true, email: true },
          },
        },
      }),
      this.prisma.classEnrollment.findMany({
        where: { studentId },
        include: {
          class: {
            select: {
              name: true,
              term: true,
              course: { select: { title: true, courseCode: true } },
            },
          },
        },
      }),
      this.prisma.assignmentSubmission.findMany({
        where: { studentId },
        include: {
          assignment: {
            select: { title: true, class: { select: { name: true } } },
          },
          files: {
            include: {
              file: { select: { originalName: true, sizeBytes: true } },
            },
          },
        },
        orderBy: { submittedAt: 'asc' },
      }),
      this.prisma.grade.findMany({
        where: { studentId },
        include: {
          assignment: {
            select: { title: true, class: { select: { name: true } } },
          },
        },
        orderBy: { gradedAt: 'asc' },
      }),
      this.prisma.attendance.findMany({
        where: { studentId },
        include: { class: { select: { name: true } } },
        orderBy: { date: 'asc' },
      }),
      this.prisma.reportCard.findMany({
        where: { studentId, status: 'PUBLISHED' },
        include: {
          gradingPeriod: {
            select: {
              name: true,
              term: {
                select: {
                  name: true,
                  academicYear: { select: { name: true } },
                },
              },
            },
          },
          lines: true,
        },
      }),
      this.prisma.accommodation.findFirst({ where: { studentId } }),
      this.prisma.behaviorRecord.findMany({
        where: {
          studentId,
          ...(actor.role === 'PARENT' || actor.role === 'STUDENT'
            ? { parentVisible: true }
            : {}),
        },
        orderBy: { occurredAt: 'asc' },
      }),
      student.userId
        ? this.prisma.aiConversation.findMany({
            where: { userId: student.userId, deletedAt: null },
            include: {
              messages: {
                orderBy: { createdAt: 'asc' },
                select: {
                  role: true,
                  content: true,
                  status: true,
                  createdAt: true,
                },
              },
            },
          })
        : Promise.resolve([]),
      this.prisma.xapiStatement.findMany({
        where: { studentId, voidedAt: null },
        select: {
          verb: true,
          objectType: true,
          objectName: true,
          resultScaled: true,
          timestamp: true,
        },
        orderBy: { timestamp: 'asc' },
        take: 5000,
      }),
      this.prisma.masteryLevel.findMany({
        where: { studentId },
        include: { standard: { select: { code: true, description: true } } },
      }),
      this.prisma.rewardTransaction.findMany({
        where: { studentId },
        select: { reason: true, amount: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.studentBadge.findMany({
        where: { studentId },
        include: { badge: { select: { code: true, name: true } } },
      }),
    ]);
    const sections: Record<string, unknown> = {
      profile: {
        id: student.id,
        studentNumber: student.studentNumber,
        firstName: student.firstName,
        lastName: student.lastName,
        gradeLevel: student.gradeLevel,
        dateOfBirth: student.dateOfBirth,
        enrollmentStatus: student.enrollmentStatus,
        createdAt: student.createdAt,
      },
      guardians: guardians.map((g) => ({
        name: `${g.guardian.firstName} ${g.guardian.lastName}`,
        email: g.guardian.email,
        relationship: g.relationship,
        isPrimary: g.isPrimary,
      })),
      enrollments: enrollments.map((e) => ({
        class: e.class.name,
        course: e.class.course.title,
        courseCode: e.class.course.courseCode,
        term: e.class.term,
        status: e.status,
        currentGrade: e.currentGrade === null ? null : Number(e.currentGrade),
      })),
      assignments: submissions.map((s) => ({
        assignment: s.assignment.title,
        class: s.assignment.class.name,
        attempt: s.attemptNumber,
        submittedAt: s.submittedAt,
        late: s.isLate,
        text: s.textContent,
        files: s.files.map((f) => ({
          name: f.file.originalName,
          bytes: f.file.sizeBytes,
        })),
      })),
      grades: grades.map((g) => ({
        assignment: g.assignment.title,
        class: g.assignment.class.name,
        score: Number(g.score),
        maxPoints: Number(g.maxPoints),
        percentage: Number(g.percentage),
        letter: g.letterGrade,
        feedback: g.feedback,
        gradedAt: g.gradedAt,
      })),
      attendance: attendance.map((a) => ({
        date: a.date.toISOString().slice(0, 10),
        class: a.class.name,
        status: a.status,
      })),
      'report-cards': reportCards.map((c) => ({
        year: c.gradingPeriod.term.academicYear.name,
        term: c.gradingPeriod.term.name,
        period: c.gradingPeriod.name,
        gpa: c.gpa === null ? null : Number(c.gpa),
        lines: c.lines.map((l) => ({
          class: l.className,
          course: l.courseTitle,
          teacher: l.teacherName,
          percentage: l.percentage === null ? null : Number(l.percentage),
          letter: l.letter,
          comment: l.comment,
        })),
      })),
      support: {
        accommodation: accommodation
          ? {
              plan: accommodation.plan,
              extendedTimePercent: accommodation.extendedTimePercent,
              readAloud: accommodation.readAloud,
              largeText: accommodation.largeText,
              reducedMotion: accommodation.reducedMotion,
              notes: accommodation.notes,
            }
          : null,
        behaviour: behaviour.map((b) => ({
          kind: b.kind,
          title: b.title,
          description: b.description,
          occurredAt: b.occurredAt,
          actionTaken: b.actionTaken,
        })),
      },
      'ai-conversations': conversations.map((c) => ({
        title: c.title,
        capability: c.capability,
        createdAt: c.createdAt,
        messages: c.messages,
      })),
      learning: {
        statements: statements.map((s) => ({
          ...s,
          resultScaled: s.resultScaled === null ? null : Number(s.resultScaled),
        })),
        mastery: mastery.map((m) => ({
          standard: m.standard.code,
          description: m.standard.description,
          level: Number(m.level),
          trend: m.trend,
        })),
      },
      motivation: {
        rewards,
        badges: badges.map((b) => ({
          code: b.badge.code,
          name: b.badge.name,
          earnedAt: b.createdAt,
        })),
      },
    };
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(sections))
      counts[k] = Array.isArray(v) ? v.length : 1;
    const files: Record<string, Uint8Array> = {
      'manifest.json': strToU8(
        JSON.stringify(
          exportManifest({
            studentNumber: student.studentNumber,
            generatedAt: new Date(),
            counts,
            requestedBy: actor.email,
          }),
          null,
          2,
        ),
      ),
    };
    for (const [k, v] of Object.entries(sections))
      files[`${k}.json`] = strToU8(JSON.stringify(v, null, 2));
    files['README.txt'] = strToU8(
      'This is a copy of the education records SmartSchool holds for the student named in manifest.json, in JSON files per section. It was produced on request under FERPA. Keep it private.\n',
    );
    await this.audit.record({
      userId: actor.id,
      organizationId: student.organizationId,
      action: 'compliance.records.export',
      entityType: 'Student',
      entityId: studentId,
      details: { sections: counts },
    });
    return {
      fileName: `records-${student.studentNumber}-${new Date().toISOString().slice(0, 10)}.zip`,
      zip: zipSync(files, { level: 6 }),
    };
  }

  // ---------------------------------------------------------------------------
  // Security incidents
  // ---------------------------------------------------------------------------

  async incidents(actor: AuthenticatedUser, organizationId?: string) {
    if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.PRINCIPAL)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Administrators only.',
      });
    const where = isDistrictRole(actor)
      ? organizationId
        ? { organizationId }
        : {}
      : { organizationId: actor.organizationId ?? '' };
    const rows = await this.prisma.securityIncident.findMany({
      where,
      orderBy: { detectedAt: 'desc' },
      take: 200,
      include: { reportedBy: { select: { firstName: true, lastName: true } } },
    });
    return rows.map((r) => this.toIncident(r));
  }

  async createIncident(dto: CreateIncidentDto, actor: AuthenticatedUser) {
    if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.PRINCIPAL)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Administrators only.',
      });
    const organizationId = isDistrictRole(actor)
      ? (dto.organizationId ?? actor.organizationId ?? null)
      : actor.organizationId;
    if (organizationId && !isDistrictRole(actor))
      assertOrganizationAccess(actor, organizationId);
    const detectedAt = dto.detectedAt ? new Date(dto.detectedAt) : new Date();
    const row = await this.prisma.securityIncident.create({
      data: {
        id: newId(),
        organizationId,
        title: dto.title.trim(),
        severity: dto.severity,
        summary: dto.summary,
        affectedCount: dto.affectedCount ?? 0,
        dataCategories: dto.dataCategories ?? null,
        detectedAt,
        reportedById: actor.id,
        timeline: appendTimeline(null, {
          at: new Date().toISOString(),
          by: actor.email,
          note: 'Incident opened.',
        }),
      },
      include: { reportedBy: { select: { firstName: true, lastName: true } } },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'compliance.incident.open',
      entityType: 'SecurityIncident',
      entityId: row.id,
      details: { severity: dto.severity },
    });
    return this.toIncident(row);
  }

  async updateIncident(
    id: string,
    dto: UpdateIncidentDto,
    actor: AuthenticatedUser,
  ) {
    const row = await this.incidentFor(id, actor);
    const now = new Date();
    let timeline = row.timeline;
    if (dto.note)
      timeline = appendTimeline(timeline, {
        at: now.toISOString(),
        by: actor.email,
        note: dto.note,
      });
    const data: Record<string, unknown> = { timeline };
    if (dto.status && dto.status !== row.status) {
      if (!canMoveIncident(row.status as IncidentStatus, dto.status))
        throw new BadRequestException({
          code: 'compliance.incident_status',
          detail: `An incident cannot go from ${row.status} back to ${dto.status}.`,
        });
      data.status = dto.status;
      if (dto.status === 'contained') data.containedAt = now;
      if (dto.status === 'notified') data.notifiedAt = row.notifiedAt ?? now;
      if (dto.status === 'closed') data.closedAt = now;
      data.timeline = appendTimeline(data.timeline as string, {
        at: now.toISOString(),
        by: actor.email,
        note: `Status: ${dto.status}.`,
      });
    }
    if (dto.severity) data.severity = dto.severity;
    if (dto.affectedCount !== undefined) data.affectedCount = dto.affectedCount;
    if (dto.dataCategories !== undefined)
      data.dataCategories = dto.dataCategories;
    const updated = await this.prisma.securityIncident.update({
      where: { id },
      data,
      include: { reportedBy: { select: { firstName: true, lastName: true } } },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: 'compliance.incident.update',
      entityType: 'SecurityIncident',
      entityId: id,
      details: { status: dto.status ?? row.status },
    });
    return this.toIncident(updated);
  }

  /** Tells every administrator of the school (and the district roles) now, by notification and email, and stamps the clock. */
  async notifyIncident(id: string, actor: AuthenticatedUser) {
    const row = await this.incidentFor(id, actor);
    const recipients = await this.prisma.user.findMany({
      where: {
        deletedAt: null,
        OR: [
          { role: { in: ['SUPER_ADMIN', 'SUPERINTENDENT'] } },
          ...(row.organizationId
            ? [
                {
                  organizationId: row.organizationId,
                  role: 'PRINCIPAL' as const,
                },
              ]
            : []),
        ],
      },
      select: { id: true },
    });
    const sent = await this.notifications.notify(
      recipients.map((r) => r.id),
      {
        category: 'SYSTEM',
        title: `Security incident (${row.severity}): ${row.title}`,
        body: `${row.summary.slice(0, 400)}${row.affectedCount ? ` About ${row.affectedCount} people affected.` : ''} Follow the breach runbook (docs/18).`,
        link: '/compliance?tab=incidents',
        entityType: 'SecurityIncident',
        entityId: id,
        forceEmail: true,
      },
    );
    const now = new Date();
    const updated = await this.prisma.securityIncident.update({
      where: { id },
      data: {
        notifiedAt: row.notifiedAt ?? now,
        status:
          row.status === 'open' || row.status === 'contained'
            ? 'notified'
            : row.status,
        timeline: appendTimeline(row.timeline, {
          at: now.toISOString(),
          by: actor.email,
          note: `Administrators notified (${sent}).`,
        }),
      },
      include: { reportedBy: { select: { firstName: true, lastName: true } } },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: 'compliance.incident.notify',
      entityType: 'SecurityIncident',
      entityId: id,
      details: { recipients: sent },
    });
    return { ...this.toIncident(updated), notified: sent };
  }

  private async incidentFor(id: string, actor: AuthenticatedUser) {
    const row = await this.prisma.securityIncident.findUnique({
      where: { id },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Incident not found.',
      });
    if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.PRINCIPAL)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Administrators only.',
      });
    if (!isDistrictRole(actor) && row.organizationId !== actor.organizationId)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Not your school.',
      });
    return row;
  }

  private toIncident(r: {
    id: string;
    organizationId: string | null;
    title: string;
    severity: string;
    status: string;
    summary: string;
    affectedCount: number;
    dataCategories: string | null;
    detectedAt: Date;
    containedAt: Date | null;
    notifiedAt: Date | null;
    closedAt: Date | null;
    timeline: string;
    reportedBy: { firstName: string; lastName: string };
    createdAt: Date;
  }) {
    let timeline: TimelineEntry[] = [];
    try {
      timeline = JSON.parse(r.timeline) as TimelineEntry[];
    } catch {
      timeline = [];
    }
    return {
      id: r.id,
      organizationId: r.organizationId,
      title: r.title,
      severity: r.severity,
      status: r.status,
      summary: r.summary,
      affectedCount: r.affectedCount,
      dataCategories: r.dataCategories,
      detectedAt: r.detectedAt,
      containedAt: r.containedAt,
      notifiedAt: r.notifiedAt,
      closedAt: r.closedAt,
      deadlines: incidentDeadlines(
        r.detectedAt,
        r.severity as IncidentSeverity,
      ),
      timeline,
      reportedBy: `${r.reportedBy.firstName} ${r.reportedBy.lastName}`,
      createdAt: r.createdAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Access helpers
  // ---------------------------------------------------------------------------

  private adminOf(organizationId: string, actor: AuthenticatedUser): void {
    if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.PRINCIPAL)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Administrators only.',
      });
    if (!isDistrictRole(actor)) assertOrganizationAccess(actor, organizationId);
  }

  /** Family (guardian or the student) and administrators; counselors may read records but not request deletion. */
  private async visibleStudent(
    studentId: string,
    actor: AuthenticatedUser,
    opts: { familyOnly: boolean },
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
      if (family) return student;
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Not available for your account.',
      });
    }
    if (!isDistrictRole(actor))
      assertOrganizationAccess(actor, student.organizationId);
    const allowed =
      ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL ||
      (!opts.familyOnly && actor.role === 'COUNSELOR');
    if (!allowed)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Families, counselors and administrators only.',
      });
    return student;
  }
}
