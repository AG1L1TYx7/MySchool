import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AcademicYear,
  AttendanceCode,
  BellSchedule,
  GradingPeriod,
  Period,
  Prisma,
  Term,
} from '../../generated/prisma/client';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { assertOrganizationAccess } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import {
  AttendanceCodeDto,
  CreateAcademicYearDto,
  CreateBellScheduleDto,
  CreateGradingPeriodDto,
  CreatePeriodDto,
  CreateTermDto,
  SchoolSettingsDto,
  UpdateAcademicYearDto,
  UpdateAttendanceCodeDto,
  UpdatePeriodDto,
  UpdateTermDto,
} from './dto/school.dto';
import {
  DEFAULT_ATTENDANCE_CODES,
  dateRangeValid,
  isValidGradeLevel,
  parseGradeLevels,
  validDays,
  within,
} from './school-rules';
import {
  parseGpaScale,
  parseGradingScale,
  validateGradingScale,
} from '../gradebook/gradebook-rules';

const day = (s: string) => new Date(`${s}T00:00:00Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

export interface PublicYear {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  terms: PublicTerm[];
}
export interface PublicTerm {
  id: string;
  academicYearId: string;
  name: string;
  type: string;
  startDate: string;
  endDate: string;
  sortOrder: number;
  gradingPeriods: Array<{
    id: string;
    name: string;
    startDate: string;
    endDate: string;
    sortOrder: number;
  }>;
}
export interface PublicBellSchedule {
  id: string;
  name: string;
  isDefault: boolean;
  periods: PublicPeriod[];
}
export interface PublicPeriod {
  id: string;
  bellScheduleId: string;
  name: string;
  startTime: string;
  endTime: string;
  days: string;
  sortOrder: number;
}
export interface PublicCode {
  id: string;
  code: string;
  label: string;
  category: string;
  countsAsPresent: boolean;
  isActive: boolean;
  sortOrder: number;
}

/** School years, terms, grading periods, bell schedules, attendance codes and grade levels (docs/13 sections 3 and 5). */
@Injectable()
export class SchoolService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Everything the structure screens need in one call; readable by any member of the organisation. */
  async structure(organizationId: string, actor: AuthenticatedUser) {
    assertOrganizationAccess(actor, organizationId);
    const org = await this.prisma.organization.findFirst({
      where: { id: organizationId, deletedAt: null },
      select: {
        gradeLevels: true,
        attendanceDeadlineTime: true,
        timezone: true,
        gradingScale: true,
        gpaScale: true,
      },
    });
    if (!org)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Organisation not found.',
      });
    const [years, schedules, codes] = await Promise.all([
      this.prisma.academicYear.findMany({
        where: { organizationId },
        include: {
          terms: {
            include: { gradingPeriods: { orderBy: { sortOrder: 'asc' } } },
            orderBy: [{ sortOrder: 'asc' }, { startDate: 'asc' }],
          },
        },
        orderBy: { startDate: 'desc' },
      }),
      this.prisma.bellSchedule.findMany({
        where: { organizationId },
        include: { periods: { orderBy: { sortOrder: 'asc' } } },
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      }),
      this.prisma.attendanceCode.findMany({
        where: { organizationId },
        orderBy: { sortOrder: 'asc' },
      }),
    ]);
    return {
      gradeLevels: parseGradeLevels(org.gradeLevels),
      attendanceDeadlineTime: org.attendanceDeadlineTime,
      timezone: org.timezone,
      gradingScale: parseGradingScale(org.gradingScale),
      gpaScale: parseGpaScale(org.gpaScale),
      years: years.map(toYear),
      bellSchedules: schedules.map(toSchedule),
      attendanceCodes: codes.map(toCode),
    };
  }

  async setSettings(
    organizationId: string,
    dto: SchoolSettingsDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.gradeLevels) {
      const bad = dto.gradeLevels.filter((g) => !isValidGradeLevel(g));
      if (bad.length)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: `Unknown grade levels: ${bad.join(', ')}. Use PK, K or 1 to 12.`,
        });
      data.gradeLevels = [
        ...new Set(dto.gradeLevels.map((g) => g.trim().toUpperCase())),
      ].join(',');
    }
    if (dto.attendanceDeadlineTime !== undefined)
      data.attendanceDeadlineTime = dto.attendanceDeadlineTime || null;
    if (dto.timezone) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: dto.timezone });
      } catch {
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'Unknown timezone.',
        });
      }
      data.timezone = dto.timezone;
    }
    if (dto.gradingScale) {
      const scale = dto.gradingScale.map((c) => ({
        letter: c.letter.trim().toUpperCase(),
        min: c.min,
      }));
      const problem = validateGradingScale(scale);
      if (problem)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: problem,
        });
      data.gradingScale = JSON.stringify(
        [...scale].sort((a, b) => b.min - a.min),
      );
    }
    if (dto.gpaScale) {
      const scale = dto.gpaScale.map((c) => ({
        letter: c.letter.trim().toUpperCase(),
        points: c.points,
      }));
      if (new Set(scale.map((c) => c.letter)).size !== scale.length)
        throw new BadRequestException({
          code: 'request.invalid',
          detail: 'Each letter may appear once in the GPA scale.',
        });
      data.gpaScale = JSON.stringify(scale);
    }
    await this.prisma.organization.update({
      where: { id: organizationId },
      data,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'organizations.settings.update',
      entityType: 'Organization',
      entityId: organizationId,
      details: { fields: Object.keys(data) },
    });
    return this.structure(organizationId, actor);
  }

  // ---------------------------------------------------------------------------
  // Years, terms, grading periods
  // ---------------------------------------------------------------------------

  async createYear(
    organizationId: string,
    dto: CreateAcademicYearDto,
    actor: AuthenticatedUser,
  ): Promise<PublicYear> {
    assertOrganizationAccess(actor, organizationId);
    if (!dateRangeValid(dto.startDate, dto.endDate))
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'The year must end after it starts.',
      });
    if (dto.isCurrent)
      await this.prisma.academicYear.updateMany({
        where: { organizationId },
        data: { isCurrent: false },
      });
    const row = await this.prisma.academicYear.create({
      data: {
        id: newId(),
        organizationId,
        name: dto.name.trim(),
        startDate: day(dto.startDate),
        endDate: day(dto.endDate),
        isCurrent: dto.isCurrent ?? false,
      },
      include: { terms: { include: { gradingPeriods: true } } },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'school.year.create',
      entityType: 'AcademicYear',
      entityId: row.id,
    });
    return toYear(row);
  }

  async updateYear(
    organizationId: string,
    id: string,
    dto: UpdateAcademicYearDto,
    actor: AuthenticatedUser,
  ): Promise<PublicYear> {
    assertOrganizationAccess(actor, organizationId);
    const existing = await this.findYear(organizationId, id);
    const start = dto.startDate ? day(dto.startDate) : existing.startDate;
    const end = dto.endDate ? day(dto.endDate) : existing.endDate;
    if (!dateRangeValid(start, end))
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'The year must end after it starts.',
      });
    if (dto.isCurrent)
      await this.prisma.academicYear.updateMany({
        where: { organizationId, id: { not: id } },
        data: { isCurrent: false },
      });
    const row = await this.prisma.academicYear.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        startDate: start,
        endDate: end,
        isCurrent: dto.isCurrent,
      },
      include: {
        terms: {
          include: { gradingPeriods: { orderBy: { sortOrder: 'asc' } } },
          orderBy: { sortOrder: 'asc' },
        },
      },
    });
    return toYear(row);
  }

  async removeYear(
    organizationId: string,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    assertOrganizationAccess(actor, organizationId);
    await this.findYear(organizationId, id);
    const classes = await this.prisma.class.count({
      where: { academicYearId: id, deletedAt: null },
    });
    if (classes)
      throw new ConflictException({
        code: 'school.in_use',
        detail: `${classes} class${classes === 1 ? '' : 'es'} belong to this year. Move them first.`,
      });
    await this.prisma.academicYear.delete({ where: { id } });
    await this.audit.record({
      userId: actor.id,
      organizationId,
      action: 'school.year.delete',
      entityType: 'AcademicYear',
      entityId: id,
    });
  }

  async createTerm(
    organizationId: string,
    yearId: string,
    dto: CreateTermDto,
    actor: AuthenticatedUser,
  ): Promise<PublicTerm> {
    assertOrganizationAccess(actor, organizationId);
    const year = await this.findYear(organizationId, yearId);
    const start = day(dto.startDate),
      end = day(dto.endDate);
    if (!dateRangeValid(start, end))
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'The term must end after it starts.',
      });
    if (!within({ start, end }, { start: year.startDate, end: year.endDate }))
      throw new BadRequestException({
        code: 'request.invalid',
        detail: `Terms must fall inside ${year.name} (${ymd(year.startDate)} to ${ymd(year.endDate)}).`,
      });
    const row = await this.prisma.term.create({
      data: {
        id: newId(),
        academicYearId: yearId,
        name: dto.name.trim(),
        type: (dto.type ?? 'semester').toUpperCase() as Term['type'],
        startDate: start,
        endDate: end,
        sortOrder: dto.sortOrder ?? 0,
      },
      include: { gradingPeriods: true },
    });
    return toTerm(row);
  }

  async updateTerm(
    organizationId: string,
    id: string,
    dto: UpdateTermDto,
    actor: AuthenticatedUser,
  ): Promise<PublicTerm> {
    assertOrganizationAccess(actor, organizationId);
    const existing = await this.findTerm(organizationId, id);
    const start = dto.startDate ? day(dto.startDate) : existing.startDate;
    const end = dto.endDate ? day(dto.endDate) : existing.endDate;
    if (
      !dateRangeValid(start, end) ||
      !within(
        { start, end },
        {
          start: existing.academicYear.startDate,
          end: existing.academicYear.endDate,
        },
      )
    )
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'The term must end after it starts and stay inside its year.',
      });
    const row = await this.prisma.term.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        type: dto.type ? (dto.type.toUpperCase() as Term['type']) : undefined,
        startDate: start,
        endDate: end,
        sortOrder: dto.sortOrder,
      },
      include: { gradingPeriods: { orderBy: { sortOrder: 'asc' } } },
    });
    return toTerm(row);
  }

  async removeTerm(
    organizationId: string,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    assertOrganizationAccess(actor, organizationId);
    await this.findTerm(organizationId, id);
    const classes = await this.prisma.class.count({
      where: { termId: id, deletedAt: null },
    });
    if (classes)
      throw new ConflictException({
        code: 'school.in_use',
        detail: `${classes} class${classes === 1 ? '' : 'es'} use this term.`,
      });
    await this.prisma.term.delete({ where: { id } });
  }

  async createGradingPeriod(
    organizationId: string,
    termId: string,
    dto: CreateGradingPeriodDto,
    actor: AuthenticatedUser,
  ) {
    assertOrganizationAccess(actor, organizationId);
    const term = await this.findTerm(organizationId, termId);
    const start = day(dto.startDate),
      end = day(dto.endDate);
    if (
      !dateRangeValid(start, end) ||
      !within({ start, end }, { start: term.startDate, end: term.endDate })
    )
      throw new BadRequestException({
        code: 'request.invalid',
        detail: `Grading periods must fall inside ${term.name}.`,
      });
    const row = await this.prisma.gradingPeriod.create({
      data: {
        id: newId(),
        termId,
        name: dto.name.trim(),
        startDate: start,
        endDate: end,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    return toGradingPeriod(row);
  }

  async removeGradingPeriod(
    organizationId: string,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    assertOrganizationAccess(actor, organizationId);
    const row = await this.prisma.gradingPeriod.findFirst({
      where: { id, term: { academicYear: { organizationId } } },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Grading period not found.',
      });
    await this.prisma.gradingPeriod.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------
  // Bell schedules and periods
  // ---------------------------------------------------------------------------

  async createBellSchedule(
    organizationId: string,
    dto: CreateBellScheduleDto,
    actor: AuthenticatedUser,
  ): Promise<PublicBellSchedule> {
    assertOrganizationAccess(actor, organizationId);
    const count = await this.prisma.bellSchedule.count({
      where: { organizationId },
    });
    if (dto.isDefault || count === 0)
      await this.prisma.bellSchedule.updateMany({
        where: { organizationId },
        data: { isDefault: false },
      });
    const row = await this.prisma.bellSchedule.create({
      data: {
        id: newId(),
        organizationId,
        name: dto.name.trim(),
        isDefault: dto.isDefault || count === 0,
      },
      include: { periods: true },
    });
    return toSchedule(row);
  }

  async removeBellSchedule(
    organizationId: string,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    assertOrganizationAccess(actor, organizationId);
    const row = await this.prisma.bellSchedule.findFirst({
      where: { id, organizationId },
      include: { _count: { select: { periods: true } } },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Bell schedule not found.',
      });
    const inUse = await this.prisma.class.count({
      where: { period: { bellScheduleId: id }, deletedAt: null },
    });
    if (inUse)
      throw new ConflictException({
        code: 'school.in_use',
        detail: `${inUse} class${inUse === 1 ? '' : 'es'} use periods of this schedule.`,
      });
    await this.prisma.bellSchedule.delete({ where: { id } });
  }

  async createPeriod(
    organizationId: string,
    scheduleId: string,
    dto: CreatePeriodDto,
    actor: AuthenticatedUser,
  ): Promise<PublicPeriod> {
    assertOrganizationAccess(actor, organizationId);
    const schedule = await this.prisma.bellSchedule.findFirst({
      where: { id: scheduleId, organizationId },
    });
    if (!schedule)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Bell schedule not found.',
      });
    const days = (dto.days ?? 'MTWRF').toUpperCase();
    if (!validDays(days))
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Days use the letters M T W R F S U without repeats.',
      });
    if (dto.startTime >= dto.endTime)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'A period must end after it starts.',
      });
    const row = await this.prisma.period.create({
      data: {
        id: newId(),
        bellScheduleId: scheduleId,
        name: dto.name.trim(),
        startTime: dto.startTime,
        endTime: dto.endTime,
        days,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
    return toPeriod(row);
  }

  async updatePeriod(
    organizationId: string,
    id: string,
    dto: UpdatePeriodDto,
    actor: AuthenticatedUser,
  ): Promise<PublicPeriod> {
    assertOrganizationAccess(actor, organizationId);
    const existing = await this.prisma.period.findFirst({
      where: { id, bellSchedule: { organizationId } },
    });
    if (!existing)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Period not found.',
      });
    const days = dto.days ? dto.days.toUpperCase() : existing.days;
    if (!validDays(days))
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Days use the letters M T W R F S U without repeats.',
      });
    const start = dto.startTime ?? existing.startTime,
      end = dto.endTime ?? existing.endTime;
    if (start >= end)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'A period must end after it starts.',
      });
    const row = await this.prisma.period.update({
      where: { id },
      data: {
        name: dto.name?.trim(),
        startTime: start,
        endTime: end,
        days,
        sortOrder: dto.sortOrder,
      },
    });
    return toPeriod(row);
  }

  async removePeriod(
    organizationId: string,
    id: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    assertOrganizationAccess(actor, organizationId);
    const existing = await this.prisma.period.findFirst({
      where: { id, bellSchedule: { organizationId } },
    });
    if (!existing)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Period not found.',
      });
    await this.prisma.period.delete({ where: { id } });
  }

  // ---------------------------------------------------------------------------
  // Attendance codes
  // ---------------------------------------------------------------------------

  /** Creates the standard code set for an organisation that has none yet. */
  async ensureDefaultCodes(organizationId: string): Promise<void> {
    const count = await this.prisma.attendanceCode.count({
      where: { organizationId },
    });
    if (count > 0) return;
    await this.prisma.attendanceCode.createMany({
      data: DEFAULT_ATTENDANCE_CODES.map((c, i) => ({
        id: newId(),
        organizationId,
        code: c.code,
        label: c.label,
        category: c.category,
        countsAsPresent: c.countsAsPresent,
        sortOrder: i,
      })),
    });
  }

  async codes(
    organizationId: string,
    actor: AuthenticatedUser,
  ): Promise<PublicCode[]> {
    assertOrganizationAccess(actor, organizationId);
    await this.ensureDefaultCodes(organizationId);
    const rows = await this.prisma.attendanceCode.findMany({
      where: { organizationId },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(toCode);
  }

  async createCode(
    organizationId: string,
    dto: AttendanceCodeDto,
    actor: AuthenticatedUser,
  ): Promise<PublicCode> {
    assertOrganizationAccess(actor, organizationId);
    const code = dto.code.trim().toUpperCase();
    const exists = await this.prisma.attendanceCode.findUnique({
      where: { organizationId_code: { organizationId, code } },
    });
    if (exists)
      throw new ConflictException({
        code: 'school.code_exists',
        detail: `Code ${code} already exists.`,
      });
    const row = await this.prisma.attendanceCode.create({
      data: {
        id: newId(),
        organizationId,
        code,
        label: dto.label.trim(),
        category: dto.category.toUpperCase() as AttendanceCode['category'],
        countsAsPresent: dto.countsAsPresent,
        isActive: dto.isActive ?? true,
        sortOrder: dto.sortOrder ?? 99,
      },
    });
    return toCode(row);
  }

  async updateCode(
    organizationId: string,
    id: string,
    dto: UpdateAttendanceCodeDto,
    actor: AuthenticatedUser,
  ): Promise<PublicCode> {
    assertOrganizationAccess(actor, organizationId);
    const existing = await this.prisma.attendanceCode.findFirst({
      where: { id, organizationId },
    });
    if (!existing)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Attendance code not found.',
      });
    const row = await this.prisma.attendanceCode.update({
      where: { id },
      data: {
        code: dto.code?.trim().toUpperCase(),
        label: dto.label?.trim(),
        category: dto.category
          ? (dto.category.toUpperCase() as AttendanceCode['category'])
          : undefined,
        countsAsPresent: dto.countsAsPresent,
        isActive: dto.isActive,
        sortOrder: dto.sortOrder,
      },
    });
    return toCode(row);
  }

  // ---------------------------------------------------------------------------

  private async findYear(organizationId: string, id: string) {
    const row = await this.prisma.academicYear.findFirst({
      where: { id, organizationId },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Academic year not found.',
      });
    return row;
  }

  private async findTerm(organizationId: string, id: string) {
    const row = await this.prisma.term.findFirst({
      where: { id, academicYear: { organizationId } },
      include: { academicYear: true },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Term not found.',
      });
    return row;
  }
}

function toGradingPeriod(g: GradingPeriod) {
  return {
    id: g.id,
    name: g.name,
    startDate: ymd(g.startDate),
    endDate: ymd(g.endDate),
    sortOrder: g.sortOrder,
  };
}
function toTerm(t: Term & { gradingPeriods: GradingPeriod[] }): PublicTerm {
  return {
    id: t.id,
    academicYearId: t.academicYearId,
    name: t.name,
    type: t.type.toLowerCase(),
    startDate: ymd(t.startDate),
    endDate: ymd(t.endDate),
    sortOrder: t.sortOrder,
    gradingPeriods: t.gradingPeriods.map(toGradingPeriod),
  };
}
function toYear(
  y: AcademicYear & {
    terms: Array<Term & { gradingPeriods: GradingPeriod[] }>;
  },
): PublicYear {
  return {
    id: y.id,
    name: y.name,
    startDate: ymd(y.startDate),
    endDate: ymd(y.endDate),
    isCurrent: y.isCurrent,
    terms: y.terms.map(toTerm),
  };
}
function toPeriod(p: Period): PublicPeriod {
  return {
    id: p.id,
    bellScheduleId: p.bellScheduleId,
    name: p.name,
    startTime: p.startTime,
    endTime: p.endTime,
    days: p.days,
    sortOrder: p.sortOrder,
  };
}
function toSchedule(
  s: BellSchedule & { periods: Period[] },
): PublicBellSchedule {
  return {
    id: s.id,
    name: s.name,
    isDefault: s.isDefault,
    periods: s.periods.map(toPeriod),
  };
}
export function toCode(c: AttendanceCode): PublicCode {
  return {
    id: c.id,
    code: c.code,
    label: c.label,
    category: c.category.toLowerCase(),
    countsAsPresent: c.countsAsPresent,
    isActive: c.isActive,
    sortOrder: c.sortOrder,
  };
}
