import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import PDFDocument from 'pdfkit';
import type {
  Prisma,
  ReportCard,
  ReportCardLine,
} from '../../generated/prisma/client';
import { PagedResponse } from '../../common/dto/paged-response.dto';
import { domainEvent } from '../../common/events/domain-event';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import {
  assertOrganizationAccess,
  organizationScope,
  resolveOrganizationId,
} from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canManage } from '../classes/classes.service';
import { GradebookService } from '../gradebook/gradebook.service';
import {
  gpaOf,
  gpaPointsFor,
  parseGpaScale,
} from '../gradebook/gradebook-rules';
import {
  CommentDto,
  GenerateReportCardsDto,
  ListReportCardsQuery,
  PublishReportCardsDto,
} from './dto/report-cards.dto';

export interface PublicLine {
  id: string;
  classId: string;
  className: string;
  courseTitle: string;
  teacherName: string | null;
  percentage: number | null;
  letter: string | null;
  gpaPoints: number | null;
  categories: Array<{
    name: string;
    weight: number;
    percentage: number | null;
  }>;
  standards: Array<{
    code: string;
    description: string;
    level: number | null;
    label: string | null;
  }>;
  comment: string | null;
  canComment: boolean;
}
export interface PublicReportCard {
  id: string;
  organizationId: string;
  student: {
    id: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
    gradeLevel: string | null;
  };
  gradingPeriod: {
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    termName: string;
    yearName: string;
  };
  kind: 'report_card' | 'progress';
  status: 'draft' | 'published';
  gpa: number | null;
  attendance: {
    daysPresent: number;
    daysAbsent: number;
    tardies: number;
    rate: number | null;
  } | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lines: PublicLine[];
  canPublish: boolean;
}

type CardRow = ReportCard & {
  lines: Array<
    ReportCardLine & {
      class: { organizationId: string; teachers: Array<{ teacherId: string }> };
    }
  >;
  student: {
    id: string;
    studentNumber: string;
    firstName: string;
    lastName: string;
    gradeLevel: string | null;
  };
  gradingPeriod: {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date;
    term: { name: string; academicYear: { name: string } };
  };
};

/**
 * Report cards and progress reports per grading period (docs/13 section 4): a snapshot of each class's
 * weighted grade, category breakdown and standards levels, attendance for the period, GPA on the district's
 * scale, teacher comments while in draft, and publication to students and parents with a PDF.
 */
@Injectable()
export class ReportCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gradebook: GradebookService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
  ) {}

  async generate(
    dto: GenerateReportCardsDto,
    actor: AuthenticatedUser,
  ): Promise<{ created: number; updated: number; students: number }> {
    const organizationId = resolveOrganizationId(actor, dto.organizationId);
    const period = await this.period(dto.gradingPeriodId, organizationId);
    const kind = dto.kind === 'progress' ? 'PROGRESS' : 'REPORT_CARD';
    const admin = ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL;
    if (!admin && !dto.classId)
      throw new BadRequestException({
        code: 'request.invalid',
        detail:
          'Teachers generate report cards one class at a time: give a classId.',
      });
    const classes = await this.prisma.class.findMany({
      where: {
        organizationId,
        deletedAt: null,
        ...(dto.classId ? { id: dto.classId } : {}),
        status: { in: ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED'] },
      },
      include: {
        course: { select: { title: true } },
        teachers: {
          include: { teacher: { select: { firstName: true, lastName: true } } },
          orderBy: { isPrimary: 'desc' },
        },
      },
    });
    if (dto.classId && classes.length === 0)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    if (dto.classId && !canManage(classes[0], actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only the class teachers or an administrator can generate report cards for this class.',
      });
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: organizationId },
      select: { gpaScale: true },
    });
    const gpaScale = parseGpaScale(org.gpaScale);
    let created = 0;
    let updated = 0;
    const touched = new Set<string>();
    for (const klass of classes) {
      const book = await this.gradebook.build(klass.id);
      const teacherName = klass.teachers[0]
        ? `${klass.teachers[0].teacher.firstName} ${klass.teachers[0].teacher.lastName}`
        : null;
      for (const row of book.rows) {
        const studentId = row.student.id;
        let card = await this.prisma.reportCard.findUnique({
          where: {
            studentId_gradingPeriodId_kind: {
              studentId,
              gradingPeriodId: period.id,
              kind,
            },
          },
        });
        if (card && card.status === 'PUBLISHED') continue;
        if (!card) {
          card = await this.prisma.reportCard.create({
            data: {
              id: newId(),
              organizationId,
              studentId,
              gradingPeriodId: period.id,
              kind,
              generatedById: actor.id,
            },
          });
          created += 1;
        } else updated += 1;
        touched.add(card.id);
        const standards = book.standards
          ? book.standards.standards.map((s) => {
              const lv =
                book.standards?.rows.find((r) => r.studentId === studentId)
                  ?.levels[s.id] ?? null;
              return {
                code: s.code,
                description: s.description,
                level: lv?.latest ?? null,
                label: lv?.label ?? null,
              };
            })
          : [];
        const line = {
          className: klass.name,
          courseTitle: klass.course.title,
          teacherName,
          percentage: row.percentage,
          letter: row.letter,
          gpaPoints: gpaPointsFor(row.letter, gpaScale),
          categories: JSON.stringify(
            row.categories.map((c) => ({
              name: c.name,
              weight: c.weight,
              percentage: c.percentage,
            })),
          ),
          standards: JSON.stringify(standards),
        };
        await this.prisma.reportCardLine.upsert({
          where: {
            reportCardId_classId: { reportCardId: card.id, classId: klass.id },
          },
          create: {
            id: newId(),
            reportCardId: card.id,
            classId: klass.id,
            ...line,
          },
          update: line,
        });
      }
    }
    for (const cardId of touched)
      await this.refreshTotals(cardId, period.startDate, period.endDate);
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'report-cards.generate',
      entityType: 'GradingPeriod',
      entityId: period.id,
      details: { kind, classId: dto.classId ?? null, created, updated },
    });
    return { created, updated, students: touched.size };
  }

  async list(
    q: ListReportCardsQuery,
    actor: AuthenticatedUser,
  ): Promise<PagedResponse<PublicReportCard>> {
    const where: Prisma.ReportCardWhereInput = {
      ...(q.gradingPeriodId ? { gradingPeriodId: q.gradingPeriodId } : {}),
      ...(q.status
        ? { status: q.status.toUpperCase() as 'DRAFT' | 'PUBLISHED' }
        : {}),
      ...(q.kind
        ? { kind: q.kind === 'progress' ? 'PROGRESS' : 'REPORT_CARD' }
        : {}),
      ...(q.classId ? { lines: { some: { classId: q.classId } } } : {}),
    };
    if (actor.role === 'STUDENT' || actor.role === 'PARENT') {
      where.status = 'PUBLISHED';
      where.student =
        actor.role === 'PARENT'
          ? { guardians: { some: { guardianUserId: actor.id } } }
          : { userId: actor.id };
      if (q.studentId) where.studentId = q.studentId;
    } else {
      Object.assign(where, organizationScope(actor, q.organizationId));
      if (q.studentId) where.studentId = q.studentId;
      if (actor.role === 'TEACHER' || actor.role === 'ASSISTANT')
        where.lines = {
          some: {
            class: { teachers: { some: { teacherId: actor.id } } },
            ...(q.classId ? { classId: q.classId } : {}),
          },
        };
    }
    const [rows, total] = await Promise.all([
      this.prisma.reportCard.findMany({
        where,
        include: this.include,
        orderBy: [
          { gradingPeriod: { startDate: 'desc' } },
          { student: { lastName: 'asc' } },
        ],
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.reportCard.count({ where }),
    ]);
    return PagedResponse.of(
      rows.map((r) => this.toPublic(r, actor)),
      q,
      total,
    );
  }

  async get(id: string, actor: AuthenticatedUser): Promise<PublicReportCard> {
    return this.toPublic(await this.readable(id, actor), actor);
  }

  async comment(
    id: string,
    lineId: string,
    dto: CommentDto,
    actor: AuthenticatedUser,
  ): Promise<PublicReportCard> {
    const card = await this.readable(id, actor);
    if (actor.role === 'STUDENT' || actor.role === 'PARENT')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Staff only.',
      });
    const line = card.lines.find((l) => l.id === lineId);
    if (!line)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Line not found.',
      });
    if (!canManage(line.class, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only the class teachers or an administrator can comment on this class.',
      });
    if (
      card.status === 'PUBLISHED' &&
      ROLE_LEVEL[actor.role] < ROLE_LEVEL.PRINCIPAL
    )
      throw new ConflictException({
        code: 'report-cards.published',
        detail:
          'This report card is published; ask an administrator to amend it.',
      });
    await this.prisma.reportCardLine.update({
      where: { id: lineId },
      data: { comment: dto.comment.trim() || null, commentById: actor.id },
    });
    return this.get(id, actor);
  }

  async publish(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<PublicReportCard> {
    const card = await this.readable(id, actor);
    if (!this.canPublish(card, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only an administrator, or the teacher of a one-class report, can publish it.',
      });
    await this.publishCards([card], actor);
    return this.get(id, actor);
  }

  async publishAll(
    dto: PublishReportCardsDto,
    actor: AuthenticatedUser,
  ): Promise<{ published: number }> {
    const organizationId = resolveOrganizationId(actor, dto.organizationId);
    if (ROLE_LEVEL[actor.role] < ROLE_LEVEL.PRINCIPAL)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Administrators publish a whole grading period.',
      });
    const cards = await this.prisma.reportCard.findMany({
      where: {
        organizationId,
        gradingPeriodId: dto.gradingPeriodId,
        kind: dto.kind === 'progress' ? 'PROGRESS' : 'REPORT_CARD',
        status: 'DRAFT',
      },
      include: this.include,
    });
    await this.publishCards(cards, actor);
    return { published: cards.length };
  }

  async pdf(id: string, actor: AuthenticatedUser): Promise<Buffer> {
    const card = this.toPublic(await this.readable(id, actor), actor);
    const org = await this.prisma.organization.findUniqueOrThrow({
      where: { id: card.organizationId },
      select: { name: true, address: true },
    });
    return renderPdf(card, org);
  }

  // ---------------------------------------------------------------------------

  private async publishCards(
    cards: CardRow[],
    actor: AuthenticatedUser,
  ): Promise<void> {
    const now = new Date();
    for (const card of cards) {
      if (card.status === 'PUBLISHED') continue;
      await this.prisma.reportCard.update({
        where: { id: card.id },
        data: { status: 'PUBLISHED', publishedAt: now },
      });
      if (card.kind === 'REPORT_CARD' && card.gpa !== null)
        await this.prisma.student.update({
          where: { id: card.studentId },
          data: { gpa: card.gpa },
        });
      this.events.emit(
        'report_card.published',
        domainEvent({
          eventType: 'report_card.published',
          entityType: 'ReportCard',
          entityId: card.id,
          organizationId: card.organizationId,
          actorId: actor.id,
          data: {
            studentId: card.studentId,
            kind: card.kind.toLowerCase(),
            periodName: card.gradingPeriod.name,
          },
        }),
      );
    }
    if (cards.length)
      await this.audit.record({
        userId: actor.id,
        organizationId: cards[0].organizationId,
        action: 'report-cards.publish',
        entityType: 'ReportCard',
        entityId: cards.length === 1 ? cards[0].id : cards[0].gradingPeriodId,
        details: { count: cards.length },
      });
  }

  private async refreshTotals(
    cardId: string,
    from: Date,
    to: Date,
  ): Promise<void> {
    const card = await this.prisma.reportCard.findUniqueOrThrow({
      where: { id: cardId },
      include: { lines: true },
    });
    const gpa = gpaOf(
      card.lines.map((l) => ({
        gpaPoints: l.gpaPoints === null ? null : Number(l.gpaPoints),
      })),
    );
    const records = await this.prisma.attendance.findMany({
      where: { studentId: card.studentId, date: { gte: from, lte: to } },
      select: {
        date: true,
        status: true,
        code: { select: { countsAsPresent: true, category: true } },
      },
    });
    const days = new Map<string, { present: boolean; tardy: boolean }>();
    for (const r of records) {
      const key = r.date.toISOString().slice(0, 10);
      const present = r.code
        ? r.code.countsAsPresent
        : ['PRESENT', 'TARDY', 'LATE', 'LEFT_EARLY'].includes(r.status);
      const tardy = r.code
        ? r.code.category === 'TARDY'
        : r.status === 'TARDY' || r.status === 'LATE';
      const cur = days.get(key) ?? { present: false, tardy: false };
      days.set(key, {
        present: cur.present || present,
        tardy: cur.tardy || tardy,
      });
    }
    const present = [...days.values()].filter((d) => d.present).length;
    const tardies = [...days.values()].filter((d) => d.tardy).length;
    const attendance = days.size
      ? {
          daysPresent: present,
          daysAbsent: days.size - present,
          tardies,
          rate: Math.round((present / days.size) * 10000) / 100,
        }
      : null;
    await this.prisma.reportCard.update({
      where: { id: cardId },
      data: { gpa, attendance: attendance ? JSON.stringify(attendance) : null },
    });
  }

  private async period(id: string, organizationId: string) {
    const period = await this.prisma.gradingPeriod.findFirst({
      where: { id, term: { academicYear: { organizationId } } },
    });
    if (!period)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Grading period not found in this school.',
      });
    return period;
  }

  private readonly include = {
    lines: {
      include: {
        class: {
          select: {
            organizationId: true,
            teachers: { select: { teacherId: true } },
          },
        },
      },
      orderBy: { className: 'asc' as const },
    },
    student: {
      select: {
        id: true,
        studentNumber: true,
        firstName: true,
        lastName: true,
        gradeLevel: true,
      },
    },
    gradingPeriod: {
      select: {
        id: true,
        name: true,
        startDate: true,
        endDate: true,
        term: {
          select: { name: true, academicYear: { select: { name: true } } },
        },
      },
    },
  } satisfies Prisma.ReportCardInclude;

  private async readable(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<CardRow> {
    const card = await this.prisma.reportCard.findUnique({
      where: { id },
      include: this.include,
    });
    if (!card)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Report card not found.',
      });
    if (actor.role === 'STUDENT' || actor.role === 'PARENT') {
      const own = await this.prisma.student.count({
        where: {
          id: card.studentId,
          ...(actor.role === 'PARENT'
            ? { guardians: { some: { guardianUserId: actor.id } } }
            : { userId: actor.id }),
        },
      });
      if (!own || card.status !== 'PUBLISHED')
        throw new NotFoundException({
          code: 'resource.not_found',
          detail: 'Report card not found.',
        });
      return card;
    }
    assertOrganizationAccess(actor, card.organizationId);
    if (
      (actor.role === 'TEACHER' || actor.role === 'ASSISTANT') &&
      !card.lines.some((l) => canManage(l.class, actor))
    )
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'You do not teach this student.',
      });
    return card;
  }

  private canPublish(card: CardRow, actor: AuthenticatedUser): boolean {
    if (ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL) return true;
    return (
      actor.role === 'TEACHER' &&
      card.lines.length === 1 &&
      canManage(card.lines[0].class, actor)
    );
  }

  private toPublic(card: CardRow, actor: AuthenticatedUser): PublicReportCard {
    const staff = actor.role !== 'STUDENT' && actor.role !== 'PARENT';
    return {
      id: card.id,
      organizationId: card.organizationId,
      student: card.student,
      gradingPeriod: {
        id: card.gradingPeriod.id,
        name: card.gradingPeriod.name,
        startDate: card.gradingPeriod.startDate.toISOString().slice(0, 10),
        endDate: card.gradingPeriod.endDate.toISOString().slice(0, 10),
        termName: card.gradingPeriod.term.name,
        yearName: card.gradingPeriod.term.academicYear.name,
      },
      kind: card.kind === 'PROGRESS' ? 'progress' : 'report_card',
      status: card.status === 'PUBLISHED' ? 'published' : 'draft',
      gpa: card.gpa === null ? null : Number(card.gpa),
      attendance: safe<PublicReportCard['attendance']>(card.attendance) ?? null,
      publishedAt: card.publishedAt,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
      lines: card.lines.map((l) => ({
        id: l.id,
        classId: l.classId,
        className: l.className,
        courseTitle: l.courseTitle,
        teacherName: l.teacherName,
        percentage: l.percentage === null ? null : Number(l.percentage),
        letter: l.letter,
        gpaPoints: l.gpaPoints === null ? null : Number(l.gpaPoints),
        categories: safe<PublicLine['categories']>(l.categories) ?? [],
        standards: safe<PublicLine['standards']>(l.standards) ?? [],
        comment: l.comment,
        canComment: staff && canManage(l.class, actor),
      })),
      canPublish: staff && this.canPublish(card, actor),
    };
  }
}

function safe<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/** A one or two page PDF: school header, student, period, one row per class with comment, attendance and GPA. */
function renderPdf(
  card: PublicReportCard,
  org: { name: string; address: string | null },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'LETTER',
      margin: 54,
      info: {
        Title: `${card.kind === 'progress' ? 'Progress report' : 'Report card'} ${card.student.lastName} ${card.gradingPeriod.name}`,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.fontSize(18).text(org.name, { align: 'left' });
    if (org.address) doc.fontSize(9).fillColor('#555').text(org.address);
    doc
      .moveDown(0.5)
      .fillColor('#000')
      .fontSize(14)
      .text(card.kind === 'progress' ? 'Progress report' : 'Report card');
    doc
      .fontSize(10)
      .text(
        `${card.gradingPeriod.yearName} · ${card.gradingPeriod.termName} · ${card.gradingPeriod.name} (${card.gradingPeriod.startDate} to ${card.gradingPeriod.endDate})`,
      );
    doc.moveDown();
    doc
      .fontSize(11)
      .text(`${card.student.lastName}, ${card.student.firstName}`, {
        continued: true,
      })
      .fontSize(9)
      .fillColor('#555')
      .text(
        `   ${card.student.studentNumber}${card.student.gradeLevel ? ` · Grade ${card.student.gradeLevel}` : ''}`,
      );
    doc.fillColor('#000').moveDown();
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const cols = [
      width * 0.42,
      width * 0.28,
      width * 0.1,
      width * 0.1,
      width * 0.1,
    ];
    const header = (y: number) => {
      doc.fontSize(8).fillColor('#555');
      let x = left;
      for (const [i, label] of [
        'Class',
        'Teacher',
        'Percent',
        'Letter',
        'GPA',
      ].entries()) {
        doc.text(label, x, y, {
          width: cols[i],
          align: i >= 2 ? 'right' : 'left',
        });
        x += cols[i];
      }
      doc
        .moveTo(left, y + 12)
        .lineTo(left + width, y + 12)
        .strokeColor('#999')
        .stroke();
      doc.fillColor('#000');
    };
    let y = doc.y;
    header(y);
    y += 18;
    for (const line of card.lines) {
      if (y > doc.page.height - 140) {
        doc.addPage();
        y = doc.page.margins.top;
        header(y);
        y += 18;
      }
      doc.fontSize(10);
      let x = left;
      const cells = [
        line.className,
        line.teacherName ?? '',
        line.percentage === null ? '—' : `${line.percentage}%`,
        line.letter ?? '—',
        line.gpaPoints === null ? '—' : String(line.gpaPoints),
      ];
      for (const [i, cell] of cells.entries()) {
        doc.text(cell, x, y, {
          width: cols[i],
          align: i >= 2 ? 'right' : 'left',
        });
        x += cols[i];
      }
      y += 14;
      if (line.categories.length) {
        doc
          .fontSize(8)
          .fillColor('#555')
          .text(
            line.categories
              .map(
                (c) =>
                  `${c.name} ${c.percentage === null ? '—' : `${c.percentage}%`} (${c.weight}%)`,
              )
              .join(' · '),
            left + 12,
            y,
            { width: width - 12 },
          );
        y = doc.y + 2;
      }
      if (line.standards.length) {
        doc
          .fontSize(8)
          .fillColor('#555')
          .text(
            line.standards
              .map((s) => `${s.code}: ${s.label ?? 'not yet assessed'}`)
              .join(' · '),
            left + 12,
            y,
            { width: width - 12 },
          );
        y = doc.y + 2;
      }
      if (line.comment) {
        doc
          .fontSize(9)
          .fillColor('#000')
          .text(line.comment, left + 12, y, { width: width - 12 });
        y = doc.y + 4;
      }
      doc.fillColor('#000');
      y += 4;
    }
    doc.moveDown();
    doc
      .fontSize(10)
      .text(
        `GPA this period: ${card.gpa === null ? '—' : card.gpa.toFixed(2)}`,
        left,
        y + 6,
      );
    if (card.attendance)
      doc.text(
        `Attendance: ${card.attendance.daysPresent} days present, ${card.attendance.daysAbsent} absent, ${card.attendance.tardies} tardy${card.attendance.rate === null ? '' : ` (${card.attendance.rate}%)`}`,
      );
    doc
      .moveDown()
      .fontSize(8)
      .fillColor('#555')
      .text(
        card.status === 'published' && card.publishedAt
          ? `Published ${card.publishedAt.toISOString().slice(0, 10)}`
          : 'Draft: not yet published',
      );
    doc.end();
  });
}
