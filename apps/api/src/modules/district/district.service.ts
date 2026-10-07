import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { toCsv } from '../insight/insight-rules';
import {
  averageDailyAttendance,
  districtTotals,
  type DistrictReportKind,
  type SchoolRow,
  type StateExportKind,
} from '../tenants/tenant-rules';
import { DEFAULT_TENANT_ID } from '../tenants/tenants.service';

const DAY = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const PRESENT = ['PRESENT', 'LATE', 'TARDY', 'LEFT_EARLY'];

/**
 * District (docs/13 section 9, slice 20): one picture of every school in the tenant, cross-school CSV reports,
 * and state-reporting exports. Superintendents see their own district; the platform administrator may name one.
 */
@Injectable()
export class DistrictService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async overview(actor: AuthenticatedUser, tenantId?: string) {
    const tid = this.tenantFor(actor, tenantId);
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tid },
      select: { id: true, name: true, slug: true },
    });
    if (!tenant)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'District not found.',
      });
    const schools = await this.prisma.organization.findMany({
      where: { tenantId: tid, deletedAt: null },
      select: { id: true, name: true, isActive: true },
      orderBy: { name: 'asc' },
    });
    const rows: SchoolRow[] = [];
    for (const s of schools) rows.push(await this.schoolRow(s.id, s.name));
    return {
      tenant,
      generatedAt: new Date(),
      totals: districtTotals(rows),
      schools: rows,
    };
  }

  private async schoolRow(
    organizationId: string,
    name: string,
  ): Promise<SchoolRow> {
    const now = new Date();
    const today = new Date(`${isoDay(now)}T00:00:00Z`);
    const since30 = new Date(now.getTime() - 30 * DAY);
    const since14 = new Date(now.getTime() - 14 * DAY);
    const since7 = new Date(now.getTime() - 7 * DAY);
    const [students, staff, att30, attToday, failing, ai, incidents, classes] =
      await Promise.all([
        this.prisma.student.count({
          where: {
            organizationId,
            deletedAt: null,
            enrollmentStatus: 'ACTIVE',
          },
        }),
        this.prisma.user.count({
          where: {
            organizationId,
            deletedAt: null,
            role: { in: ['TEACHER', 'ASSISTANT', 'PRINCIPAL', 'COUNSELOR'] },
          },
        }),
        this.prisma.attendance.findMany({
          where: { class: { organizationId }, date: { gte: since30 } },
          select: { status: true },
        }),
        this.prisma.attendance.findMany({
          where: { class: { organizationId }, date: today },
          select: { status: true },
        }),
        this.prisma.classEnrollment.count({
          where: {
            status: 'ENROLLED',
            currentGrade: { lt: 60 },
            class: { organizationId, deletedAt: null },
          },
        }),
        this.prisma.aiConversation.count({
          where: {
            organizationId,
            createdAt: { gte: since7 },
            deletedAt: null,
          },
        }),
        this.prisma.securityIncident.count({
          where: { organizationId, status: { not: 'closed' } },
        }),
        this.prisma.class.findMany({
          where: {
            organizationId,
            deletedAt: null,
            status: { in: ['SCHEDULED', 'IN_PROGRESS'] },
          },
          select: {
            _count: {
              select: { enrollments: { where: { status: 'ENROLLED' } } },
            },
            assignments: {
              where: {
                deletedAt: null,
                status: { in: ['PUBLISHED', 'CLOSED'] },
                dueAt: { gte: since30, lt: now },
              },
              select: {
                _count: { select: { grades: true, submissions: true } },
              },
            },
          },
        }),
      ]);
    // Missing work: past-due published work in 14 days with no submission, grade or mark per enrolled student.
    const assignments = await this.prisma.assignment.findMany({
      where: {
        deletedAt: null,
        status: { in: ['PUBLISHED', 'CLOSED'] },
        dueAt: { gte: since14, lt: now },
        class: { organizationId, deletedAt: null },
      },
      select: {
        class: {
          select: {
            enrollments: {
              where: { status: 'ENROLLED' },
              select: { studentId: true },
            },
          },
        },
        submissions: { select: { studentId: true } },
        grades: { select: { studentId: true } },
        marks: { select: { studentId: true } },
      },
      take: 1000,
    });
    let missing = 0;
    for (const a of assignments) {
      const done = new Set(
        [...a.submissions, ...a.grades, ...a.marks].map((x) => x.studentId),
      );
      missing += a.class.enrollments.filter(
        (e) => !done.has(e.studentId),
      ).length;
    }
    let expected = 0;
    let graded = 0;
    for (const c of classes) {
      expected += c._count.enrollments * c.assignments.length;
      graded += c.assignments.reduce((s, a) => s + a._count.grades, 0);
    }
    const rate = (rows: Array<{ status: string }>) =>
      rows.length
        ? Math.round(
            (rows.filter((r) => PRESENT.includes(r.status)).length /
              rows.length) *
              1000,
          ) / 10
        : null;
    return {
      organizationId,
      name,
      students,
      staff,
      attendanceRate30: rate(att30),
      presentToday: rate(attToday),
      missingItems: missing,
      failing,
      gradebookCompleteness: expected
        ? Math.round((Math.min(graded, expected) / expected) * 1000) / 10
        : null,
      aiConversations7: ai,
      openIncidents: incidents,
    };
  }

  // ---------------------------------------------------------------------------
  // Cross-school reports
  // ---------------------------------------------------------------------------

  async report(
    kind: DistrictReportKind,
    actor: AuthenticatedUser,
    tenantId?: string,
  ): Promise<{ fileName: string; csv: string; rows: number }> {
    const tid = this.tenantFor(actor, tenantId);
    const schools = await this.prisma.organization.findMany({
      where: { tenantId: tid, deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const ids = schools.map((s) => s.id);
    const nameOf = new Map(schools.map((s) => [s.id, s.name]));
    const today = isoDay(new Date());
    const done = (
      headers: string[],
      rows: Array<Array<string | number | null>>,
    ) => ({
      fileName: `district-${kind}-${today}.csv`,
      csv: toCsv(headers, rows),
      rows: rows.length,
    });
    switch (kind) {
      case 'enrollment_by_grade': {
        const groups = await this.prisma.student.groupBy({
          by: ['organizationId', 'gradeLevel'],
          where: {
            organizationId: { in: ids },
            deletedAt: null,
            enrollmentStatus: 'ACTIVE',
          },
          _count: { _all: true },
        });
        return done(
          ['School', 'Grade level', 'Students'],
          groups
            .map((g) => [
              nameOf.get(g.organizationId) ?? '',
              g.gradeLevel ?? 'Unknown',
              g._count._all,
            ])
            .sort(
              (a, b) =>
                String(a[0]).localeCompare(String(b[0])) ||
                String(a[1]).localeCompare(String(b[1])),
            ),
        );
      }
      case 'attendance_daily': {
        const since = new Date(Date.now() - 30 * DAY);
        const rows = await this.prisma.attendance.findMany({
          where: {
            class: { organizationId: { in: ids } },
            date: { gte: since },
          },
          select: {
            date: true,
            status: true,
            class: { select: { organizationId: true } },
          },
        });
        const byKey = new Map<
          string,
          { school: string; date: string; records: Array<{ status: string }> }
        >();
        for (const r of rows) {
          const key = `${r.class.organizationId}|${isoDay(r.date)}`;
          const e = byKey.get(key) ?? {
            school: nameOf.get(r.class.organizationId) ?? '',
            date: isoDay(r.date),
            records: [],
          };
          e.records.push({ status: r.status });
          byKey.set(key, e);
        }
        return done(
          ['School', 'Date', 'Records', 'Present rate'],
          [...byKey.values()]
            .sort(
              (a, b) =>
                a.school.localeCompare(b.school) ||
                a.date.localeCompare(b.date),
            )
            .map((e) => [
              e.school,
              e.date,
              e.records.length,
              averageDailyAttendance(e.records),
            ]),
        );
      }
      case 'ai_usage': {
        const since = new Date(Date.now() - 7 * DAY);
        const convs = await this.prisma.aiConversation.groupBy({
          by: ['organizationId', 'capability'],
          where: {
            organizationId: { in: ids },
            createdAt: { gte: since },
            deletedAt: null,
          },
          _count: { _all: true },
          _sum: { messageCount: true },
        });
        return done(
          ['School', 'Capability', 'Conversations (7 days)', 'Messages'],
          convs.map((c) => [
            nameOf.get(c.organizationId ?? '') ?? '',
            c.capability,
            c._count._all,
            c._sum.messageCount ?? 0,
          ]),
        );
      }
      case 'schools':
      default: {
        const rows: SchoolRow[] = [];
        for (const s of schools) rows.push(await this.schoolRow(s.id, s.name));
        return done(
          [
            'School',
            'Students',
            'Staff',
            'Attendance % (30 days)',
            'Present today %',
            'Missing items (14 days)',
            'Failing a class',
            'Gradebook completeness %',
            'AI conversations (7 days)',
            'Open incidents',
          ],
          rows.map((r) => [
            r.name,
            r.students,
            r.staff,
            r.attendanceRate30,
            r.presentToday,
            r.missingItems,
            r.failing,
            r.gradebookCompleteness,
            r.aiConversations7,
            r.openIncidents,
          ]),
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // State reporting exports (student level; column names are state-neutral, mapped by the district's template)
  // ---------------------------------------------------------------------------

  async stateExport(
    kind: StateExportKind,
    actor: AuthenticatedUser,
    tenantId?: string,
    year?: string,
  ): Promise<{ fileName: string; csv: string; rows: number }> {
    const tid = this.tenantFor(actor, tenantId);
    const schools = await this.prisma.organization.findMany({
      where: { tenantId: tid, deletedAt: null },
      select: { id: true, name: true, externalId: true },
    });
    const ids = schools.map((s) => s.id);
    const schoolOf = new Map(schools.map((s) => [s.id, s]));
    const today = isoDay(new Date());
    const done = (
      headers: string[],
      rows: Array<Array<string | number | null>>,
    ) => ({
      fileName: `state-${kind}-${today}.csv`,
      csv: toCsv(headers, rows),
      rows: rows.length,
    });
    const yearName = year ?? null;
    let result: { fileName: string; csv: string; rows: number };
    switch (kind) {
      case 'attendance': {
        const since = new Date(Date.now() - 365 * DAY);
        const students = await this.prisma.student.findMany({
          where: { organizationId: { in: ids }, deletedAt: null },
          select: {
            id: true,
            organizationId: true,
            studentNumber: true,
            lastName: true,
            firstName: true,
            gradeLevel: true,
          },
        });
        const records = await this.prisma.attendance.groupBy({
          by: ['studentId', 'status'],
          where: {
            studentId: { in: students.map((s) => s.id) },
            date: { gte: since },
          },
          _count: { _all: true },
        });
        const by = new Map<string, Record<string, number>>();
        for (const r of records)
          by.set(r.studentId, {
            ...(by.get(r.studentId) ?? {}),
            [r.status]: r._count._all,
          });
        result = done(
          [
            'School code',
            'School',
            'Student number',
            'Last name',
            'First name',
            'Grade level',
            'Days present',
            'Days absent',
            'Days excused',
            'Tardies',
            'ADA',
          ],
          students.map((s) => {
            const c = by.get(s.id) ?? {};
            const present =
              (c.PRESENT ?? 0) +
              (c.LATE ?? 0) +
              (c.TARDY ?? 0) +
              (c.LEFT_EARLY ?? 0);
            const total = Object.values(c).reduce((a, b) => a + b, 0);
            const school = schoolOf.get(s.organizationId);
            return [
              school?.externalId ?? '',
              school?.name ?? '',
              s.studentNumber,
              s.lastName,
              s.firstName,
              s.gradeLevel,
              present,
              c.ABSENT ?? 0,
              c.EXCUSED ?? 0,
              (c.LATE ?? 0) + (c.TARDY ?? 0),
              total ? Math.round((present / total) * 10000) / 10000 : null,
            ];
          }),
        );
        break;
      }
      case 'discipline': {
        const rows = await this.prisma.behaviorRecord.findMany({
          where: { organizationId: { in: ids }, kind: 'CONCERN' },
          include: {
            student: {
              select: {
                studentNumber: true,
                lastName: true,
                firstName: true,
                gradeLevel: true,
              },
            },
          },
          orderBy: { occurredAt: 'asc' },
          take: 20000,
        });
        result = done(
          [
            'School code',
            'School',
            'Student number',
            'Last name',
            'First name',
            'Grade level',
            'Date',
            'Title',
            'Location',
            'Action taken',
          ],
          rows.map((r) => {
            const school = schoolOf.get(r.organizationId);
            return [
              school?.externalId ?? '',
              school?.name ?? '',
              r.student.studentNumber,
              r.student.lastName,
              r.student.firstName,
              r.student.gradeLevel,
              isoDay(r.occurredAt),
              r.title,
              r.location,
              r.actionTaken,
            ];
          }),
        );
        break;
      }
      case 'grades': {
        const cards = await this.prisma.reportCard.findMany({
          where: {
            organizationId: { in: ids },
            status: 'PUBLISHED',
            kind: 'REPORT_CARD',
            ...(yearName
              ? {
                  gradingPeriod: { term: { academicYear: { name: yearName } } },
                }
              : {}),
          },
          include: {
            student: {
              select: {
                studentNumber: true,
                lastName: true,
                firstName: true,
                gradeLevel: true,
              },
            },
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
          take: 20000,
        });
        const rows: Array<Array<string | number | null>> = [];
        for (const c of cards) {
          const school = schoolOf.get(c.organizationId);
          for (const l of c.lines)
            rows.push([
              school?.externalId ?? '',
              school?.name ?? '',
              c.student.studentNumber,
              c.student.lastName,
              c.student.firstName,
              c.student.gradeLevel,
              c.gradingPeriod.term.academicYear.name,
              c.gradingPeriod.term.name,
              c.gradingPeriod.name,
              l.courseTitle,
              l.className,
              l.percentage === null ? null : Number(l.percentage),
              l.letter,
              l.gpaPoints === null ? null : Number(l.gpaPoints),
            ]);
        }
        result = done(
          [
            'School code',
            'School',
            'Student number',
            'Last name',
            'First name',
            'Grade level',
            'Year',
            'Term',
            'Period',
            'Course',
            'Class',
            'Percent',
            'Letter',
            'GPA points',
          ],
          rows,
        );
        break;
      }
      case 'enrollment':
      default: {
        const students = await this.prisma.student.findMany({
          where: { organizationId: { in: ids }, deletedAt: null },
          orderBy: [
            { organizationId: 'asc' },
            { lastName: 'asc' },
            { firstName: 'asc' },
          ],
          take: 50000,
        });
        result = done(
          [
            'School code',
            'School',
            'Student number',
            'Last name',
            'First name',
            'Date of birth',
            'Gender',
            'Grade level',
            'Enrollment status',
            'Enrollment date',
          ],
          students.map((s) => {
            const school = schoolOf.get(s.organizationId);
            return [
              school?.externalId ?? '',
              school?.name ?? '',
              s.studentNumber,
              s.lastName,
              s.firstName,
              s.dateOfBirth ? isoDay(s.dateOfBirth) : null,
              s.gender ?? null,
              s.gradeLevel,
              s.enrollmentStatus.toLowerCase(),
              s.enrollmentDate ? isoDay(s.enrollmentDate) : null,
            ];
          }),
        );
      }
    }
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'district.state_export',
      entityType: 'Tenant',
      entityId: tid,
      details: { kind, rows: result.rows },
    });
    return result;
  }

  private tenantFor(actor: AuthenticatedUser, requested?: string): string {
    if (actor.role === 'SUPER_ADMIN')
      return requested ?? actor.tenantId ?? DEFAULT_TENANT_ID;
    if (actor.role !== 'SUPERINTENDENT')
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'District roles only.',
      });
    if (requested && requested !== actor.tenantId)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Not your district.',
      });
    if (!actor.tenantId)
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Your account is not attached to a district.',
      });
    return actor.tenantId;
  }
}
