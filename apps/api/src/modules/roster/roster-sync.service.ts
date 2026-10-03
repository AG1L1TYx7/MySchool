import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, RecordSource, Role } from '../../generated/prisma/client';
import { newId } from '../../common/utils/ids';
import { randomToken } from '../../common/utils/tokens';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { RosterSnapshot, RosterUser } from './roster-model';

export interface SyncCounts {
  users: { created: number; updated: number; linked: number };
  students: { created: number; updated: number };
  guardians: { created: number };
  courses: { created: number; updated: number };
  classes: { created: number; updated: number };
  enrollments: { created: number; updated: number; dropped: number };
  teachers: { created: number };
  skipped: number;
}

export interface SyncError {
  entityType: string;
  externalId: string | null;
  message: string;
}

export interface SyncResult {
  counts: SyncCounts;
  errors: SyncError[];
}

/** Deadlocks and lock waits (Prisma P2034, MariaDB 1213 and 1205) are worth a retry; anything else is not. */
export function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  if (code === 'P2034') return true;
  return /deadlock|lock wait timeout/i.test(err.message);
}

class DryRunRollback extends Error {
  constructor(public readonly result: SyncResult) {
    super('dry run');
  }
}

type Tx = Prisma.TransactionClient;

const ROLE_FOR: Record<RosterUser['role'], Role | null> = {
  student: 'STUDENT',
  teacher: 'TEACHER',
  staff: 'ASSISTANT',
  parent: 'PARENT',
  administrator: 'PRINCIPAL',
  ignored: null,
};

/**
 * Applies a roster snapshot to one organisation. Records are matched by external id and source, then by
 * email (users) or student number (students); matched records become "managed by the SIS". A dry run
 * executes the whole sync inside a transaction and rolls it back, so its counts are exact.
 */
@Injectable()
export class RosterSyncService {
  private readonly logger = new Logger(RosterSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async apply(
    organizationId: string,
    source: RecordSource,
    snapshot: RosterSnapshot,
    options: { dryRun: boolean; schoolExternalId?: string | null },
  ): Promise<SyncResult> {
    // A nightly sync shares the database with the school day; a deadlock or lock wait against
    // another writer is retried a few times before the run is reported as failed.
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const result = await this.run(
              tx,
              organizationId,
              source,
              snapshot,
              options.schoolExternalId ?? null,
            );
            if (options.dryRun) throw new DryRunRollback(result);
            return result;
          },
          { timeout: 20 * 60_000, maxWait: 15_000 },
        );
      } catch (err) {
        if (err instanceof DryRunRollback) return err.result;
        if (attempt < 3 && isTransient(err)) {
          await new Promise((r) => setTimeout(r, 250 * attempt));
          continue;
        }
        throw err;
      }
    }
  }

  private async run(
    tx: Tx,
    organizationId: string,
    source: RecordSource,
    snap: RosterSnapshot,
    schoolExternalId: string | null,
  ): Promise<SyncResult> {
    const counts: SyncCounts = {
      users: { created: 0, updated: 0, linked: 0 },
      students: { created: 0, updated: 0 },
      guardians: { created: 0 },
      courses: { created: 0, updated: 0 },
      classes: { created: 0, updated: 0 },
      enrollments: { created: 0, updated: 0, dropped: 0 },
      teachers: { created: 0 },
      skipped: 0,
    };
    const errors: SyncError[] = [];
    const fail = (
      entityType: string,
      externalId: string | null,
      message: string,
    ) => {
      if (errors.length < 500) errors.push({ entityType, externalId, message });
    };

    // Which school this organisation is. A single-school snapshot binds the organisation on first sync.
    const school = schoolExternalId
      ? snap.schools.find((s) => s.externalId === schoolExternalId)
      : snap.schools.length === 1
        ? snap.schools[0]
        : null;
    if (school)
      await tx.organization.update({
        where: { id: organizationId },
        data: { externalId: school.externalId },
      });

    const termTitle = new Map(snap.terms.map((t) => [t.externalId, t]));
    const userIdByExternal = new Map<string, string>();
    const studentIdByExternal = new Map<string, string>();
    const unusablePassword = `sso:${randomToken(24)}`;

    // ---- users (teachers, staff, administrators, parents, students with email) ----
    for (const u of snap.users) {
      const role = ROLE_FOR[u.role];
      if (!role) {
        counts.skipped += 1;
        continue;
      }
      if (!u.active) continue;
      if (!u.email) {
        if (u.role !== 'student')
          fail(
            'user',
            u.externalId,
            'No email address; staff and parents need one to sign in.',
          );
        continue;
      }
      if (!u.firstName && !u.lastName) {
        fail('user', u.externalId, 'Missing name.');
        continue;
      }
      const existing =
        (await tx.user.findFirst({
          where: {
            organizationId,
            externalId: u.externalId,
            source,
            deletedAt: null,
          },
        })) ??
        (await tx.user.findFirst({
          where: { email: u.email, deletedAt: null },
        }));
      if (
        existing &&
        existing.organizationId &&
        existing.organizationId !== organizationId
      ) {
        fail(
          'user',
          u.externalId,
          `${u.email} belongs to another organisation.`,
        );
        continue;
      }
      if (existing) {
        const changed =
          existing.firstName !== u.firstName ||
          existing.lastName !== u.lastName ||
          existing.externalId !== u.externalId ||
          !existing.managedBySis ||
          (existing.role !== role &&
            existing.role !== 'PRINCIPAL' &&
            existing.role !== 'SUPERINTENDENT' &&
            existing.role !== 'SUPER_ADMIN');
        if (changed) {
          await tx.user.update({
            where: { id: existing.id },
            data: {
              firstName: u.firstName || existing.firstName,
              lastName: u.lastName || existing.lastName,
              externalId: u.externalId,
              source,
              managedBySis: true,
              organizationId,
              role: ['PRINCIPAL', 'SUPERINTENDENT', 'SUPER_ADMIN'].includes(
                existing.role,
              )
                ? existing.role
                : role,
            },
          });
          if (existing.externalId === u.externalId) counts.users.updated += 1;
          else counts.users.linked += 1;
        }
        userIdByExternal.set(u.externalId, existing.id);
      } else {
        const id = newId();
        await tx.user.create({
          data: {
            id,
            email: u.email,
            passwordHash: unusablePassword,
            firstName: u.firstName || '-',
            lastName: u.lastName || '-',
            role,
            organizationId,
            status: 'ACTIVE',
            emailVerifiedAt: new Date(),
            externalId: u.externalId,
            source,
            managedBySis: true,
          },
        });
        userIdByExternal.set(u.externalId, id);
        counts.users.created += 1;
      }
    }

    // ---- students ----
    for (const u of snap.users) {
      if (u.role !== 'student' || !u.active) continue;
      const studentNumber = (u.identifier ?? u.username ?? u.externalId).slice(
        0,
        50,
      );
      const existing =
        (await tx.student.findFirst({
          where: { organizationId, externalId: u.externalId, deletedAt: null },
        })) ??
        (await tx.student.findFirst({
          where: { organizationId, studentNumber, deletedAt: null },
        }));
      const userId = userIdByExternal.get(u.externalId) ?? null;
      const data = {
        firstName: u.firstName || '-',
        lastName: u.lastName || '-',
        email: u.email,
        gradeLevel: u.grade,
        dateOfBirth: u.dateOfBirth ? new Date(u.dateOfBirth) : undefined,
        externalId: u.externalId,
        source,
        managedBySis: true,
        userId: userId ?? undefined,
        enrollmentStatus: 'ACTIVE' as const,
      };
      if (existing) {
        await tx.student.update({ where: { id: existing.id }, data });
        studentIdByExternal.set(u.externalId, existing.id);
        counts.students.updated += 1;
      } else {
        const id = newId();
        await tx.student.create({
          data: {
            id,
            organizationId,
            studentNumber,
            ...data,
            dateOfBirth: data.dateOfBirth ?? null,
            userId,
          },
        });
        studentIdByExternal.set(u.externalId, id);
        counts.students.created += 1;
      }
    }

    // ---- guardians ----
    for (const u of snap.users) {
      if (u.role !== 'parent' || !u.active) continue;
      const guardianUserId = userIdByExternal.get(u.externalId);
      if (!guardianUserId) continue;
      for (const agent of u.agentExternalIds) {
        const studentId = studentIdByExternal.get(agent);
        if (!studentId) {
          fail(
            'guardian',
            u.externalId,
            `Linked student ${agent} not in this snapshot.`,
          );
          continue;
        }
        const exists = await tx.studentGuardian.findUnique({
          where: { studentId_guardianUserId: { studentId, guardianUserId } },
        });
        if (!exists) {
          await tx.studentGuardian.create({
            data: {
              id: newId(),
              studentId,
              guardianUserId,
              relationship: 'GUARDIAN',
              source,
            },
          });
          counts.guardians.created += 1;
        }
      }
    }

    // ---- courses ----
    const courseIdByExternal = new Map<string, string>();
    for (const c of snap.courses) {
      const code = (c.courseCode ?? c.externalId).slice(0, 50);
      const existing =
        (await tx.course.findFirst({
          where: { organizationId, externalId: c.externalId, deletedAt: null },
        })) ??
        (await tx.course.findFirst({
          where: { organizationId, courseCode: code, deletedAt: null },
        }));
      if (existing) {
        await tx.course.update({
          where: { id: existing.id },
          data: {
            title: c.title || existing.title,
            subject: c.subject ?? existing.subject,
            gradeLevel: c.grade ?? existing.gradeLevel,
            externalId: c.externalId,
            source,
          },
        });
        courseIdByExternal.set(c.externalId, existing.id);
        counts.courses.updated += 1;
      } else {
        const id = newId();
        await tx.course.create({
          data: {
            id,
            organizationId,
            courseCode: code,
            title: c.title || code,
            subject: c.subject,
            gradeLevel: c.grade,
            status: 'ACTIVE',
            isPublished: true,
            publishedAt: new Date(),
            externalId: c.externalId,
            source,
          },
        });
        courseIdByExternal.set(c.externalId, id);
        counts.courses.created += 1;
      }
    }

    // ---- classes ----
    const classIdByExternal = new Map<string, string>();
    const teacherByClass = new Map<
      string,
      Array<{ userId: string; primary: boolean }>
    >();
    for (const e of snap.enrollments) {
      if (e.role !== 'teacher' || !e.active) continue;
      const userId = userIdByExternal.get(e.userExternalId);
      if (!userId) continue;
      teacherByClass.set(e.classExternalId, [
        ...(teacherByClass.get(e.classExternalId) ?? []),
        { userId, primary: e.primary },
      ]);
    }
    for (const k of snap.classes) {
      if (!k.active) continue;
      let courseId = k.courseExternalId
        ? courseIdByExternal.get(k.courseExternalId)
        : undefined;
      if (!courseId) {
        // A class without a known course gets one named after it, so the class can exist.
        const code = `SIS-${k.externalId}`.slice(0, 50);
        const existingCourse = await tx.course.findFirst({
          where: { organizationId, courseCode: code, deletedAt: null },
        });
        courseId =
          existingCourse?.id ??
          (
            await tx.course.create({
              data: {
                id: newId(),
                organizationId,
                courseCode: code,
                title: k.title,
                gradeLevel: k.grade,
                status: 'ACTIVE',
                isPublished: true,
                publishedAt: new Date(),
                source,
              },
            })
          ).id;
      }
      const term = k.termExternalIds.map((t) => termTitle.get(t)).find(Boolean);
      const termLabel = (term?.title ?? term?.schoolYear ?? 'SIS').slice(0, 50);
      const existing = await tx.class.findFirst({
        where: { organizationId, externalId: k.externalId, deletedAt: null },
      });
      const data = {
        name: k.title,
        section: k.classCode?.slice(0, 50) ?? null,
        term: termLabel,
        periodLabel: k.period?.slice(0, 50) ?? null,
        startDate: term?.startDate ? new Date(term.startDate) : null,
        endDate: term?.endDate ? new Date(term.endDate) : null,
        status: 'IN_PROGRESS' as const,
        externalId: k.externalId,
        source,
        managedBySis: true,
        courseId,
      };
      let classId: string;
      if (existing) {
        await tx.class.update({ where: { id: existing.id }, data });
        classId = existing.id;
        counts.classes.updated += 1;
      } else {
        classId = newId();
        await tx.class.create({
          data: { id: classId, organizationId, ...data },
        });
        counts.classes.created += 1;
      }
      classIdByExternal.set(k.externalId, classId);
      for (const t of teacherByClass.get(k.externalId) ?? []) {
        const exists = await tx.classTeacher.findUnique({
          where: { classId_teacherId: { classId, teacherId: t.userId } },
        });
        if (!exists) {
          await tx.classTeacher.create({
            data: {
              id: newId(),
              classId,
              teacherId: t.userId,
              isPrimary: t.primary,
            },
          });
          counts.teachers.created += 1;
        }
      }
    }

    // ---- enrollments ----
    const seenEnrollments = new Set<string>();
    for (const e of snap.enrollments) {
      if (e.role !== 'student') continue;
      const classId = classIdByExternal.get(e.classExternalId);
      const studentId = studentIdByExternal.get(e.userExternalId);
      if (!classId || !studentId) {
        if (e.active)
          fail(
            'enrollment',
            e.externalId,
            `Class ${e.classExternalId} or student ${e.userExternalId} not in this snapshot.`,
          );
        continue;
      }
      seenEnrollments.add(`${classId}:${studentId}`);
      const existing = await tx.classEnrollment.findUnique({
        where: { classId_studentId: { classId, studentId } },
      });
      const status = e.active ? ('ENROLLED' as const) : ('DROPPED' as const);
      if (existing) {
        if (existing.status !== status || !existing.managedBySis) {
          await tx.classEnrollment.update({
            where: { id: existing.id },
            data: {
              status,
              externalId: e.externalId,
              source,
              managedBySis: true,
            },
          });
          if (status === 'DROPPED') counts.enrollments.dropped += 1;
          else counts.enrollments.updated += 1;
        }
      } else if (e.active) {
        await tx.classEnrollment.create({
          data: {
            id: newId(),
            classId,
            studentId,
            status: 'ENROLLED',
            externalId: e.externalId,
            source,
            managedBySis: true,
          },
        });
        counts.enrollments.created += 1;
      }
    }
    // Managed enrolments that vanished from the feed are drops (withdrawals, schedule changes).
    const managed = await tx.classEnrollment.findMany({
      where: {
        managedBySis: true,
        source,
        status: 'ENROLLED',
        class: {
          organizationId,
          externalId: { in: [...classIdByExternal.keys()] },
        },
      },
      select: { id: true, classId: true, studentId: true },
    });
    for (const m of managed) {
      if (!seenEnrollments.has(`${m.classId}:${m.studentId}`)) {
        await tx.classEnrollment.update({
          where: { id: m.id },
          data: { status: 'DROPPED' },
        });
        counts.enrollments.dropped += 1;
      }
    }

    this.logger.log(
      `Roster sync for ${organizationId} (${source}): ${JSON.stringify(counts)}; ${errors.length} errors`,
    );
    return { counts, errors };
  }
}
