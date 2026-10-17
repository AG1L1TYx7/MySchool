import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { newId } from '../../common/utils/ids';
import { assertPublicHttpUrl } from '../../common/outbound-url';
import { AppConfigService } from '../../config/app-config.service';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { assertOrganizationAccess, isDistrictRole } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  GoogleClassroomClient,
  gradesToPush,
  importableCourseWork,
} from './google-classroom';

/**
 * Grades back to Google Classroom (slice 30): a class that came from a Classroom course keeps the course id
 * as its external id; each published assignment gets a piece of course work there (remembered in
 * `ClassroomCourseWork`), and every grade is written to the matching student submission.
 */
@Injectable()
export class ClassroomService {
  private readonly log = new Logger(ClassroomService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly config: AppConfigService,
    private readonly audit: AuditService,
  ) {}

  /** Whether the class is a Classroom course and what has been pushed so far. */
  async status(classId: string, actor: AuthenticatedUser) {
    const klass = await this.visibleClass(classId, actor);
    if (klass.source !== 'CLASSROOM' || !klass.externalId)
      return { linked: false as const };
    const links = await this.prisma.classroomCourseWork.findMany({
      where: { assignment: { classId, deletedAt: null } },
      select: { assignmentId: true, updatedAt: true },
    });
    return {
      linked: true as const,
      courseId: klass.externalId,
      assignmentsLinked: links.length,
      lastPushAt: links.reduce<Date | null>(
        (m, l) => (!m || l.updatedAt > m ? l.updatedAt : m),
        null,
      ),
    };
  }

  async pushGrades(classId: string, actor: AuthenticatedUser) {
    const klass = await this.visibleClass(classId, actor);
    const staff =
      isDistrictRole(actor) ||
      actor.role === 'PRINCIPAL' ||
      klass.teachers.some((t) => t.teacherId === actor.id);
    if (!staff)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only the teachers of this class send its grades to Classroom.',
      });
    if (klass.source !== 'CLASSROOM' || !klass.externalId)
      throw new BadRequestException({
        code: 'classroom.not_linked',
        detail: 'This class did not come from a Google Classroom course.',
      });
    const client = await this.clientFor(klass.organizationId);
    const courseId = klass.externalId;
    const assignments = await this.prisma.assignment.findMany({
      where: {
        classId,
        deletedAt: null,
        status: { in: ['PUBLISHED', 'CLOSED'] },
      },
      select: { id: true, title: true, maxPoints: true, description: true },
      orderBy: { createdAt: 'asc' },
    });
    const existing = assignments.length
      ? await client.courseWork(courseId)
      : [];
    const counts = {
      assignments: assignments.length,
      courseWorkCreated: 0,
      grades: 0,
      pushed: 0,
      skipped: 0,
    };
    for (const a of assignments) {
      let link = await this.prisma.classroomCourseWork.findUnique({
        where: { assignmentId: a.id },
      });
      if (link && !existing.some((w) => w.id === link!.courseWorkId))
        link = null;
      if (!link) {
        const created = await client.createCourseWork(courseId, {
          title: a.title,
          maxPoints: Number(a.maxPoints),
          description: a.description ?? undefined,
        });
        link = await this.prisma.classroomCourseWork.upsert({
          where: { assignmentId: a.id },
          create: {
            id: newId(),
            assignmentId: a.id,
            courseId,
            courseWorkId: created.id,
          },
          update: { courseId, courseWorkId: created.id },
        });
        counts.courseWorkCreated += 1;
      }
      const grades = await this.prisma.grade.findMany({
        where: { assignmentId: a.id },
        select: {
          studentId: true,
          score: true,
          student: { select: { user: { select: { externalId: true } } } },
        },
      });
      counts.grades += grades.length;
      if (grades.length === 0) continue;
      const submissions = await client.submissions(courseId, link.courseWorkId);
      const todo = gradesToPush(
        grades.map((g) => ({
          studentId: g.studentId,
          score: Number(g.score),
          externalUserId: g.student.user?.externalId ?? null,
        })),
        submissions,
      );
      counts.skipped += grades.length - todo.length;
      for (const t of todo) {
        try {
          await client.patchGrade(
            courseId,
            link.courseWorkId,
            t.submissionId,
            t.score,
          );
          counts.pushed += 1;
        } catch (err) {
          counts.skipped += 1;
          this.log.warn(
            `Classroom grade not written: ${(err as Error).message}`,
          );
        }
      }
      await this.prisma.classroomCourseWork.update({
        where: { id: link.id },
        data: { updatedAt: new Date() },
      });
    }
    await this.audit.record({
      userId: actor.id,
      organizationId: klass.organizationId,
      action: 'classroom.grades.push',
      entityType: 'Class',
      entityId: classId,
      details: counts,
    });
    return counts;
  }

  /** Course work Classroom already holds becomes assignments here, with the grades its submissions carry. */
  async importCourseWork(classId: string, actor: AuthenticatedUser) {
    const klass = await this.visibleClass(classId, actor);
    const staff =
      isDistrictRole(actor) ||
      actor.role === 'PRINCIPAL' ||
      klass.teachers.some((t) => t.teacherId === actor.id);
    if (!staff)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only the teachers of this class import its Classroom work.',
      });
    if (klass.source !== 'CLASSROOM' || !klass.externalId)
      throw new BadRequestException({
        code: 'classroom.not_linked',
        detail: 'This class did not come from a Google Classroom course.',
      });
    const client = await this.clientFor(klass.organizationId);
    const courseId = klass.externalId;
    const linked = await this.prisma.classroomCourseWork.findMany({
      where: { courseId },
      select: { courseWorkId: true, assignmentId: true },
    });
    const items = await client.courseWork(courseId);
    const todo = importableCourseWork(
      items,
      new Set(linked.map((l) => l.courseWorkId)),
    );
    const counts = {
      courseWork: items.length,
      assignmentsCreated: 0,
      gradesImported: 0,
      skipped: 0,
    };
    const students = await this.prisma.student.findMany({
      where: {
        organizationId: klass.organizationId,
        deletedAt: null,
        user: { externalId: { not: null } },
      },
      select: { id: true, user: { select: { externalId: true } } },
    });
    const studentByGoogleId = new Map(
      students.map((st) => [st.user!.externalId as string, st.id]),
    );
    const links = new Map(linked.map((l) => [l.courseWorkId, l.assignmentId]));
    for (const item of todo) {
      const assignment = await this.prisma.assignment.create({
        data: {
          id: newId(),
          organizationId: klass.organizationId,
          classId,
          createdById: actor.id,
          title: item.title,
          description: item.description,
          type: 'HOMEWORK',
          submissionType: 'EXTERNAL',
          maxPoints: item.maxPoints,
          dueAt: item.dueAt,
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });
      await this.prisma.classroomCourseWork.create({
        data: {
          id: newId(),
          assignmentId: assignment.id,
          courseId,
          courseWorkId: item.courseWorkId,
        },
      });
      links.set(item.courseWorkId, assignment.id);
      counts.assignmentsCreated += 1;
    }
    // Grades Classroom holds (assignedGrade) for every linked piece of work, for students we know.
    for (const [courseWorkId, assignmentId] of links) {
      const assignment = await this.prisma.assignment.findFirst({
        where: { id: assignmentId, deletedAt: null },
        select: { maxPoints: true },
      });
      if (!assignment) continue;
      const submissions = await client.submissions(courseId, courseWorkId);
      for (const sub of submissions) {
        if (typeof sub.assignedGrade !== 'number') continue;
        const studentId = studentByGoogleId.get(sub.userId);
        if (!studentId) {
          counts.skipped += 1;
          continue;
        }
        const max = Number(assignment.maxPoints);
        const data = {
          score: sub.assignedGrade,
          maxPoints: max,
          percentage:
            max > 0 ? Math.round((sub.assignedGrade / max) * 10000) / 100 : 0,
        };
        await this.prisma.grade.upsert({
          where: { assignmentId_studentId: { assignmentId, studentId } },
          create: { id: newId(), assignmentId, studentId, ...data },
          update: data,
        });
        counts.gradesImported += 1;
      }
    }
    await this.audit.record({
      userId: actor.id,
      organizationId: klass.organizationId,
      action: 'classroom.coursework.import',
      entityType: 'Class',
      entityId: classId,
      details: counts,
    });
    return counts;
  }

  // ---------------------------------------------------------------------------

  private async visibleClass(classId: string, actor: AuthenticatedUser) {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      select: {
        id: true,
        organizationId: true,
        source: true,
        externalId: true,
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
    return klass;
  }

  /** The school's Classroom roster source holds the service account; its secrets are sealed in the row. */
  private async clientFor(
    organizationId: string,
  ): Promise<GoogleClassroomClient> {
    const source = await this.prisma.rosterSource.findFirst({
      where: { organizationId, provider: 'GOOGLE_CLASSROOM', isEnabled: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!source)
      throw new BadRequestException({
        code: 'classroom.no_source',
        detail:
          'Add a Google Classroom roster source first (Settings, Rostering).',
      });
    const parsed = JSON.parse(source.config) as Record<string, string>;
    const config: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed))
      config[k] =
        typeof v === 'string' && v.startsWith('enc:')
          ? this.crypto.decrypt(v.slice(4))
          : v;
    for (const k of ['baseUrl', 'tokenUrl'])
      if (config[k])
        await assertPublicHttpUrl(config[k], {
          allowLoopback: !this.config.isProduction,
        });
    return new GoogleClassroomClient({
      serviceAccountJson: config.serviceAccountJson,
      adminEmail: config.adminEmail,
      baseUrl: config.baseUrl || undefined,
      tokenUrl: config.tokenUrl || undefined,
    });
  }
}
