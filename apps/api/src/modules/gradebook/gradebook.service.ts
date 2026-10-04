import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  GradeCategory,
  ProficiencyScale,
} from '../../generated/prisma/client';
import { toCsv } from '../../common/utils/csv';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import { assertOrganizationAccess } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canManage } from '../classes/classes.service';
import {
  ClassGradingDto,
  CreateCategoryDto,
  CreateScaleDto,
  SetMarkDto,
  UpdateCategoryDto,
  UpdateScaleDto,
} from './dto/gradebook.dto';
import {
  DEFAULT_PROFICIENCY_LEVELS,
  buildWeightedGradebook,
  parseGradingScale,
  parseLevels,
  summariseStandards,
  weightWarning,
  type ProficiencyLevel,
  type WeightedGradebook,
} from './gradebook-rules';

export interface PublicCategory {
  id: string;
  name: string;
  weight: number;
  dropLowest: number;
  sortOrder: number;
}
export interface PublicScale {
  id: string;
  name: string;
  levels: ProficiencyLevel[];
  isDefault: boolean;
}
export interface ClassGrading {
  classId: string;
  gradingMode: 'points' | 'standards';
  proficiencyScaleId: string | null;
  scale: PublicScale | null;
  latePolicy: string | null;
  syllabus: string | null;
  categories: PublicCategory[];
  weightWarning: string | null;
  canManage: boolean;
}

/** Grading settings per class, the weighted gradebook, marks and proficiency scales (docs/13 section 4). */
@Injectable()
export class GradebookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // Class grading settings
  // ---------------------------------------------------------------------------

  async grading(
    classId: string,
    actor: AuthenticatedUser,
  ): Promise<ClassGrading> {
    const klass = await this.readableClass(classId, actor);
    const [categories, scale] = await Promise.all([
      this.prisma.gradeCategory.findMany({
        where: { classId },
        orderBy: { sortOrder: 'asc' },
      }),
      klass.proficiencyScaleId
        ? this.prisma.proficiencyScale.findUnique({
            where: { id: klass.proficiencyScaleId },
          })
        : this.prisma.proficiencyScale.findFirst({
            where: { organizationId: klass.organizationId, isDefault: true },
          }),
    ]);
    return {
      classId,
      gradingMode: klass.gradingMode.toLowerCase() as 'points' | 'standards',
      proficiencyScaleId: klass.proficiencyScaleId,
      scale: scale ? toScale(scale) : null,
      latePolicy: klass.latePolicy,
      syllabus: klass.syllabus,
      categories: categories.map(toCategory),
      weightWarning: weightWarning(
        categories.map((c) => ({ weight: Number(c.weight) })),
      ),
      canManage: canManage(klass, actor),
    };
  }

  async setGrading(
    classId: string,
    dto: ClassGradingDto,
    actor: AuthenticatedUser,
  ): Promise<ClassGrading> {
    const klass = await this.manageableClass(classId, actor);
    if (dto.proficiencyScaleId) {
      const scale = await this.prisma.proficiencyScale.findFirst({
        where: {
          id: dto.proficiencyScaleId,
          organizationId: klass.organizationId,
        },
      });
      if (!scale)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'Unknown proficiency scale for this school.',
        });
    }
    await this.prisma.class.update({
      where: { id: classId },
      data: {
        gradingMode: dto.gradingMode
          ? (dto.gradingMode.toUpperCase() as 'POINTS' | 'STANDARDS')
          : undefined,
        proficiencyScaleId:
          dto.proficiencyScaleId === undefined
            ? undefined
            : dto.proficiencyScaleId,
        latePolicy:
          dto.latePolicy === undefined
            ? undefined
            : dto.latePolicy.trim() || null,
        syllabus:
          dto.syllabus === undefined ? undefined : dto.syllabus.trim() || null,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: klass.organizationId,
      action: 'grading.settings.update',
      entityType: 'Class',
      entityId: classId,
      details: { gradingMode: dto.gradingMode },
    });
    return this.grading(classId, actor);
  }

  async createCategory(
    classId: string,
    dto: CreateCategoryDto,
    actor: AuthenticatedUser,
  ): Promise<PublicCategory> {
    const klass = await this.manageableClass(classId, actor);
    const name = dto.name.trim();
    const exists = await this.prisma.gradeCategory.findUnique({
      where: { classId_name: { classId, name } },
    });
    if (exists)
      throw new ConflictException({
        code: 'grading.category_exists',
        detail: `A category called ${name} already exists.`,
      });
    const count = await this.prisma.gradeCategory.count({ where: { classId } });
    const row = await this.prisma.gradeCategory.create({
      data: {
        id: newId(),
        classId,
        name,
        weight: dto.weight,
        dropLowest: dto.dropLowest ?? 0,
        sortOrder: dto.sortOrder ?? count,
      },
    });
    // Assignments that already carry this category label join it.
    await this.prisma.assignment.updateMany({
      where: { classId, categoryId: null, category: name, deletedAt: null },
      data: { categoryId: row.id },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: klass.organizationId,
      action: 'grading.category.create',
      entityType: 'GradeCategory',
      entityId: row.id,
      details: { classId, name, weight: dto.weight },
    });
    return toCategory(row);
  }

  async updateCategory(
    classId: string,
    id: string,
    dto: UpdateCategoryDto,
    actor: AuthenticatedUser,
  ): Promise<PublicCategory> {
    await this.manageableClass(classId, actor);
    const existing = await this.prisma.gradeCategory.findFirst({
      where: { id, classId },
    });
    if (!existing)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Category not found.',
      });
    const name = dto.name?.trim();
    if (name && name !== existing.name) {
      const dup = await this.prisma.gradeCategory.findUnique({
        where: { classId_name: { classId, name } },
      });
      if (dup)
        throw new ConflictException({
          code: 'grading.category_exists',
          detail: `A category called ${name} already exists.`,
        });
    }
    const row = await this.prisma.gradeCategory.update({
      where: { id },
      data: {
        name,
        weight: dto.weight,
        dropLowest: dto.dropLowest,
        sortOrder: dto.sortOrder,
      },
    });
    if (name && name !== existing.name)
      await this.prisma.assignment.updateMany({
        where: { categoryId: id },
        data: { category: name },
      });
    return toCategory(row);
  }

  async removeCategory(
    classId: string,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const klass = await this.manageableClass(classId, actor);
    const existing = await this.prisma.gradeCategory.findFirst({
      where: { id, classId },
    });
    if (!existing)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Category not found.',
      });
    await this.prisma.gradeCategory.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      organizationId: klass.organizationId,
      action: 'grading.category.delete',
      entityType: 'GradeCategory',
      entityId: id,
    });
  }

  // ---------------------------------------------------------------------------
  // Marks
  // ---------------------------------------------------------------------------

  async setMark(
    assignmentId: string,
    studentId: string,
    dto: SetMarkDto,
    actor: AuthenticatedUser,
  ) {
    const assignment = await this.prisma.assignment.findFirst({
      where: { id: assignmentId, deletedAt: null },
      include: {
        class: { include: { teachers: { select: { teacherId: true } } } },
      },
    });
    if (!assignment)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Assignment not found.',
      });
    if (!canManage(assignment.class, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only an assigned teacher or an administrator can set marks for this class.',
      });
    const enrolled = await this.prisma.classEnrollment.count({
      where: {
        classId: assignment.classId,
        studentId,
        status: { in: ['ENROLLED', 'COMPLETED'] },
      },
    });
    if (!enrolled)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'That student is not enrolled in this class.',
      });
    if (!dto.mark) {
      await this.prisma.assignmentMark.deleteMany({
        where: { assignmentId, studentId },
      });
    } else {
      const mark = dto.mark.toUpperCase() as
        'MISSING' | 'EXCUSED' | 'INCOMPLETE';
      await this.prisma.assignmentMark.upsert({
        where: { assignmentId_studentId: { assignmentId, studentId } },
        create: {
          id: newId(),
          assignmentId,
          studentId,
          mark,
          note: dto.note,
          setById: actor.id,
        },
        update: { mark, note: dto.note, setById: actor.id },
      });
    }
    await this.refreshCurrentGrade(assignment.classId, studentId);
    await this.audit.record({
      userId: actor.id,
      organizationId: assignment.organizationId,
      action: 'grading.mark.set',
      entityType: 'Assignment',
      entityId: assignmentId,
      details: { studentId, mark: dto.mark ?? null },
    });
    return {
      assignmentId,
      studentId,
      mark: dto.mark ?? null,
      note: dto.mark ? (dto.note ?? null) : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Gradebook
  // ---------------------------------------------------------------------------

  /** The full matrix for staff; also used (with one student) to refresh ClassEnrollments.currentGrade. */
  async build(
    classId: string,
    studentIds?: string[],
  ): Promise<
    WeightedGradebook & {
      standards: StandardsBook | null;
      gradingMode: 'points' | 'standards';
    }
  > {
    const klass = await this.prisma.class.findFirstOrThrow({
      where: { id: classId },
      include: { organization: { select: { gradingScale: true } } },
    });
    const [enrolled, categories, assignments, grades, marks] =
      await Promise.all([
        this.prisma.classEnrollment.findMany({
          where: {
            classId,
            status: { in: ['ENROLLED', 'COMPLETED'] },
            ...(studentIds ? { studentId: { in: studentIds } } : {}),
          },
          include: {
            student: {
              select: {
                id: true,
                studentNumber: true,
                firstName: true,
                lastName: true,
              },
            },
          },
          orderBy: { student: { lastName: 'asc' } },
        }),
        this.prisma.gradeCategory.findMany({
          where: { classId },
          orderBy: { sortOrder: 'asc' },
        }),
        this.prisma.assignment.findMany({
          where: {
            classId,
            deletedAt: null,
            status: { in: ['PUBLISHED', 'CLOSED'] },
          },
          orderBy: [{ dueAt: 'asc' }, { createdAt: 'asc' }],
          include: { gradeCategory: { select: { name: true } } },
        }),
        this.prisma.grade.findMany({
          where: {
            assignment: { classId, deletedAt: null },
            ...(studentIds ? { studentId: { in: studentIds } } : {}),
          },
          include: { standardScores: true },
        }),
        this.prisma.assignmentMark.findMany({
          where: {
            assignment: { classId, deletedAt: null },
            ...(studentIds ? { studentId: { in: studentIds } } : {}),
          },
        }),
      ]);
    const book = buildWeightedGradebook({
      students: enrolled.map((e) => e.student),
      categories: categories.map(toCategory),
      assignments: assignments.map((a) => ({
        id: a.id,
        title: a.title,
        categoryId: a.categoryId,
        categoryName: a.gradeCategory?.name ?? a.category,
        maxPoints: Number(a.maxPoints),
        weight: Number(a.weight),
        isExtraCredit: a.isExtraCredit,
        dueAt: a.dueAt,
        status: a.status.toLowerCase(),
      })),
      grades: grades.map((g) => ({
        assignmentId: g.assignmentId,
        studentId: g.studentId,
        score: Number(g.score),
        maxPoints: Number(g.maxPoints),
      })),
      marks: marks.map((m) => ({
        assignmentId: m.assignmentId,
        studentId: m.studentId,
        mark: m.mark,
      })),
      scale: parseGradingScale(klass.organization.gradingScale),
    });
    const gradingMode = klass.gradingMode.toLowerCase() as
      'points' | 'standards';
    let standards: StandardsBook | null = null;
    if (gradingMode === 'standards') {
      const scale = klass.proficiencyScaleId
        ? await this.prisma.proficiencyScale.findUnique({
            where: { id: klass.proficiencyScaleId },
          })
        : await this.prisma.proficiencyScale.findFirst({
            where: { organizationId: klass.organizationId, isDefault: true },
          });
      const levels = scale
        ? parseLevels(scale.levels)
        : DEFAULT_PROFICIENCY_LEVELS;
      const scores = grades.flatMap((g) =>
        g.standardScores.map((s) => ({
          studentId: g.studentId,
          standardId: s.standardId,
          level: s.level,
          gradedAt: g.gradedAt,
        })),
      );
      const standardIds = [...new Set(scores.map((s) => s.standardId))];
      const tagged = await this.prisma.assignmentStandard.findMany({
        where: { assignment: { classId, deletedAt: null } },
        select: { standardId: true },
      });
      const allIds = [
        ...new Set([...standardIds, ...tagged.map((t) => t.standardId)]),
      ];
      const rows = allIds.length
        ? await this.prisma.standard.findMany({
            where: { id: { in: allIds } },
            select: { id: true, code: true, description: true },
            orderBy: { code: 'asc' },
          })
        : [];
      const summary = summariseStandards(scores);
      standards = {
        levels,
        standards: rows,
        rows: enrolled.map((e) => ({
          studentId: e.studentId,
          levels: Object.fromEntries(
            rows.map((s) => {
              const sum = summary.get(e.studentId)?.get(s.id);
              return [
                s.id,
                sum
                  ? {
                      latest: sum.latest,
                      best: sum.best,
                      average: sum.average,
                      attempts: sum.attempts,
                      label:
                        levels.find((l) => l.level === sum.latest)?.label ??
                        null,
                    }
                  : null,
              ];
            }),
          ),
        })),
      };
    }
    return { ...book, standards, gradingMode };
  }

  async gradebook(classId: string, actor: AuthenticatedUser) {
    const klass = await this.readableClass(classId, actor, true);
    const book = await this.build(classId);
    return { classId, className: klass.name, ...book };
  }

  async gradebookCsv(
    classId: string,
    actor: AuthenticatedUser,
  ): Promise<string> {
    const book = await this.gradebook(classId, actor);
    const header = [
      'studentNumber',
      'lastName',
      'firstName',
      ...book.assignments.map(
        (a) =>
          `${a.title} (${a.maxPoints}${a.isExtraCredit ? ', extra credit' : ''})`,
      ),
      ...book.categories.map((c) => `${c.name} %`),
      'percentage',
      'letter',
      'missing',
    ];
    const rows = book.rows.map((r) => [
      r.student.studentNumber,
      r.student.lastName,
      r.student.firstName,
      ...book.assignments.map((a) => {
        const c = r.cells[a.id];
        return c.mark === 'excused'
          ? 'EX'
          : c.mark === 'missing'
            ? 'M'
            : c.mark === 'incomplete'
              ? 'I'
              : (c.score ?? '');
      }),
      ...book.categories.map(
        (c) =>
          r.categories.find((t) => t.categoryId === c.id)?.percentage ?? '',
      ),
      r.percentage ?? '',
      r.letter ?? '',
      r.missing,
    ]);
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'grades.export',
      entityType: 'Class',
      entityId: classId,
    });
    return toCsv([header, ...rows]);
  }

  /** Keeps ClassEnrollments.currentGrade in step with the weighted gradebook (called after grades and marks). */
  async refreshCurrentGrade(classId: string, studentId: string): Promise<void> {
    const book = await this.build(classId, [studentId]);
    const row = book.rows[0];
    await this.prisma.classEnrollment.updateMany({
      where: { classId, studentId },
      data: { currentGrade: row?.percentage ?? null },
    });
  }

  // ---------------------------------------------------------------------------
  // Proficiency scales
  // ---------------------------------------------------------------------------

  async scales(
    organizationId: string,
    actor: AuthenticatedUser,
  ): Promise<PublicScale[]> {
    assertOrganizationAccess(actor, organizationId);
    await this.ensureDefaultScale(organizationId);
    const rows = await this.prisma.proficiencyScale.findMany({
      where: { organizationId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toScale);
  }

  async ensureDefaultScale(organizationId: string): Promise<void> {
    const count = await this.prisma.proficiencyScale.count({
      where: { organizationId },
    });
    if (count === 0)
      await this.prisma.proficiencyScale.create({
        data: {
          id: newId(),
          organizationId,
          name: 'Four levels',
          levels: JSON.stringify(DEFAULT_PROFICIENCY_LEVELS),
          isDefault: true,
        },
      });
  }

  async createScale(
    organizationId: string,
    dto: CreateScaleDto,
    actor: AuthenticatedUser,
  ): Promise<PublicScale> {
    assertOrganizationAccess(actor, organizationId);
    validateLevels(dto.levels);
    const exists = await this.prisma.proficiencyScale.findUnique({
      where: { organizationId_name: { organizationId, name: dto.name.trim() } },
    });
    if (exists)
      throw new ConflictException({
        code: 'grading.scale_exists',
        detail: 'A scale with that name already exists.',
      });
    if (dto.isDefault)
      await this.prisma.proficiencyScale.updateMany({
        where: { organizationId },
        data: { isDefault: false },
      });
    const row = await this.prisma.proficiencyScale.create({
      data: {
        id: newId(),
        organizationId,
        name: dto.name.trim(),
        levels: JSON.stringify(sortLevels(dto.levels)),
        isDefault: dto.isDefault ?? false,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'grading.scale.create',
      entityType: 'ProficiencyScale',
      entityId: row.id,
    });
    return toScale(row);
  }

  async updateScale(
    organizationId: string,
    id: string,
    dto: UpdateScaleDto,
    actor: AuthenticatedUser,
  ): Promise<PublicScale> {
    assertOrganizationAccess(actor, organizationId);
    const existing = await this.prisma.proficiencyScale.findFirst({
      where: { id, organizationId },
    });
    if (!existing)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Scale not found.',
      });
    if (dto.levels) validateLevels(dto.levels);
    if (dto.isDefault)
      await this.prisma.proficiencyScale.updateMany({
        where: { organizationId },
        data: { isDefault: false },
      });
    const row = await this.prisma.proficiencyScale.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        levels: dto.levels ? JSON.stringify(sortLevels(dto.levels)) : undefined,
        isDefault: dto.isDefault,
      },
    });
    return toScale(row);
  }

  async removeScale(
    organizationId: string,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    assertOrganizationAccess(actor, organizationId);
    const existing = await this.prisma.proficiencyScale.findFirst({
      where: { id, organizationId },
      include: { _count: { select: { classes: true } } },
    });
    if (!existing)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Scale not found.',
      });
    if (existing._count.classes)
      throw new ConflictException({
        code: 'school.in_use',
        detail: `${existing._count.classes} class${existing._count.classes === 1 ? '' : 'es'} use this scale.`,
      });
    await this.prisma.proficiencyScale.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------

  private async readableClass(
    classId: string,
    actor: AuthenticatedUser,
    staffOnly = false,
  ) {
    const klass = await this.prisma.class.findFirst({
      where: { id: classId, deletedAt: null },
      include: { teachers: { select: { teacherId: true } } },
    });
    if (!klass)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    if (actor.role === 'STUDENT' || actor.role === 'PARENT') {
      if (staffOnly)
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'Staff only.',
        });
      const member = await this.prisma.classEnrollment.count({
        where: {
          classId,
          student:
            actor.role === 'PARENT'
              ? { guardians: { some: { guardianUserId: actor.id } } }
              : { userId: actor.id },
        },
      });
      if (!member)
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'You are not in this class.',
        });
      return klass;
    }
    assertOrganizationAccess(actor, klass.organizationId);
    if (
      staffOnly &&
      !canManage(klass, actor) &&
      ROLE_LEVEL[actor.role] < ROLE_LEVEL.PRINCIPAL &&
      actor.role !== 'ASSISTANT' &&
      actor.role !== 'COUNSELOR'
    )
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only the class teachers, assistants or an administrator can open this gradebook.',
      });
    return klass;
  }

  private async manageableClass(classId: string, actor: AuthenticatedUser) {
    const klass = await this.readableClass(classId, actor);
    if (!canManage(klass, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only an assigned teacher or an administrator can change grading for this class.',
      });
    return klass;
  }
}

export interface StandardsBook {
  levels: ProficiencyLevel[];
  standards: Array<{ id: string; code: string; description: string }>;
  rows: Array<{
    studentId: string;
    levels: Record<
      string,
      {
        latest: number | null;
        best: number | null;
        average: number | null;
        attempts: number;
        label: string | null;
      } | null
    >;
  }>;
}

export function toCategory(c: GradeCategory): PublicCategory {
  return {
    id: c.id,
    name: c.name,
    weight: Number(c.weight),
    dropLowest: c.dropLowest,
    sortOrder: c.sortOrder,
  };
}
export function toScale(s: ProficiencyScale): PublicScale {
  return {
    id: s.id,
    name: s.name,
    levels: parseLevels(s.levels),
    isDefault: s.isDefault,
  };
}
function sortLevels(levels: ProficiencyLevel[]): ProficiencyLevel[] {
  return [...levels].sort((a, b) => a.level - b.level);
}
function validateLevels(levels: ProficiencyLevel[]): void {
  if (levels.length < 2)
    throw new BadRequestException({
      code: 'request.invalid',
      detail: 'A scale needs at least two levels.',
    });
  if (new Set(levels.map((l) => l.level)).size !== levels.length)
    throw new BadRequestException({
      code: 'request.invalid',
      detail: 'Each level number may appear once.',
    });
  if (!levels.some((l) => l.minPercent === 0))
    throw new BadRequestException({
      code: 'request.invalid',
      detail: 'The lowest level must start at 0 percent.',
    });
}
