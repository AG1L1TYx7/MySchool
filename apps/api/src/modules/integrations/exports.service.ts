import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { strToU8, zipSync } from 'fflate';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { assertOrganizationAccess, isDistrictRole } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canManage } from '../classes/classes.service';
import { GradebookService } from '../gradebook/gradebook.service';
import {
  canvasGradebookCsv,
  cartridgeItemHtml,
  commonCartridgeManifest,
  googleClassroomCsv,
  type ExportBook,
} from './integration-rules';

/** Exports to other platforms: Canvas and Google Classroom grade sheets, and a Common Cartridge of a class's assignments. */
@Injectable()
export class ExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly gradebook: GradebookService,
  ) {}

  async canvasCsv(
    classId: string,
    actor: AuthenticatedUser,
  ): Promise<{ fileName: string; csv: string }> {
    const book = await this.book(classId, actor);
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'exports.canvas_gradebook',
      entityType: 'Class',
      entityId: classId,
      details: { students: book.students.length },
    });
    return {
      fileName: `canvas-gradebook-${slug(book.className)}.csv`,
      csv: canvasGradebookCsv(book),
    };
  }

  async googleClassroomCsv(
    classId: string,
    actor: AuthenticatedUser,
  ): Promise<{ fileName: string; csv: string }> {
    const book = await this.book(classId, actor);
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'exports.google_classroom',
      entityType: 'Class',
      entityId: classId,
      details: { students: book.students.length },
    });
    return {
      fileName: `google-classroom-${slug(book.className)}.csv`,
      csv: googleClassroomCsv(book),
    };
  }

  /** IMS Common Cartridge 1.3 (.imscc) with one page per published assignment; Canvas, Schoology and Moodle import it. */
  async commonCartridge(
    classId: string,
    actor: AuthenticatedUser,
  ): Promise<{ fileName: string; zip: Uint8Array }> {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      include: {
        teachers: { select: { teacherId: true } },
        course: { select: { title: true } },
      },
    });
    if (!klass)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    if (!isDistrictRole(actor))
      assertOrganizationAccess(actor, klass.organizationId);
    if (!canManage(klass, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only the class teacher or an administrator can export the class.',
      });
    const assignments = await this.prisma.assignment.findMany({
      where: {
        classId,
        deletedAt: null,
        status: { in: ['PUBLISHED', 'CLOSED'] },
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
    });
    const title = `${klass.course.title}: ${klass.name}`;
    const items = assignments.map((a) => ({
      id: a.id,
      title: a.title,
      html: cartridgeItemHtml(
        {
          id: a.id,
          title: a.title,
          maxPoints: Number(a.maxPoints),
          dueAt: a.dueAt,
          description: a.description ?? a.instructions,
          isExtraCredit: a.isExtraCredit,
        },
        title,
      ),
    }));
    const files: Record<string, Uint8Array> = {
      'imsmanifest.xml': strToU8(commonCartridgeManifest(title, items)),
    };
    for (const i of items) files[`resources/${i.id}.html`] = strToU8(i.html);
    await this.audit.record({
      userId: actor.id,
      organizationId: klass.organizationId,
      action: 'exports.common_cartridge',
      entityType: 'Class',
      entityId: classId,
      details: { assignments: items.length },
    });
    return {
      fileName: `${slug(klass.name)}.imscc`,
      zip: zipSync(files, { level: 6 }),
    };
  }

  private async book(
    classId: string,
    actor: AuthenticatedUser,
  ): Promise<ExportBook> {
    const book = await this.gradebook.gradebook(classId, actor);
    const klass = await this.prisma.class.findUniqueOrThrow({
      where: { id: classId },
      select: { section: true },
    });
    const ids = book.rows.map((r) => r.student.id);
    const people = await this.prisma.student.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        email: true,
        externalId: true,
        user: { select: { email: true } },
      },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    const rows = new Map(book.rows.map((r) => [r.student.id, r]));
    return {
      className: book.className,
      section: klass.section,
      students: book.rows.map((r) => {
        const p = byId.get(r.student.id);
        return {
          id: r.student.id,
          studentNumber: r.student.studentNumber,
          firstName: r.student.firstName,
          lastName: r.student.lastName,
          email: p?.user?.email ?? p?.email ?? null,
          sisId: p?.externalId ?? null,
        };
      }),
      assignments: book.assignments
        .filter((a) => a.status !== 'DRAFT')
        .map((a) => ({
          id: a.id,
          title: a.title,
          maxPoints: a.maxPoints,
          dueAt: a.dueAt,
          description: null,
          isExtraCredit: a.isExtraCredit,
        })),
      cell: (studentId, assignmentId) => {
        const c = rows.get(studentId)?.cells[assignmentId];
        if (!c) return { score: null, mark: null };
        return {
          score: c.score,
          mark:
            c.mark === 'missing' ||
            c.mark === 'excused' ||
            c.mark === 'incomplete'
              ? c.mark
              : null,
        };
      },
      overall: (studentId) => rows.get(studentId)?.percentage ?? null,
    };
  }
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'class';
