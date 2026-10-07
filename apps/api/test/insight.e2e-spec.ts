import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import argon2 from 'argon2';
import request from 'supertest';
import { AI_STUB_PORT, AI_STUB_TOKEN } from './ai-env';
import { AppModule } from '../src/app.module';
import { newId } from '../src/common/utils/ids';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { startAiStub } from './ai-stub';

interface Overview {
  date: string;
  attendance: {
    classesMeeting: number;
    classesTaken: number;
    classesMissing: unknown[];
    rateToday: number | null;
  };
  missingWork: {
    items: number;
    students: number;
    byGradeLevel: Array<{ gradeLevel: string; items: number }>;
  };
  failing: {
    threshold: number;
    students: number;
    byClass: Array<{ className: string; count: number }>;
  };
  gradebook: {
    classes: Array<{ className: string; completeness: number | null }>;
    average: number | null;
  };
  ai: {
    conversations: number;
    messages: number;
    refusals: number;
    byRole: unknown[];
  };
  engagement: {
    submissions: number;
    lessonCompletions: number;
    loginsByRole: unknown[];
  };
}
interface ClassInsight {
  class: { id: string; name: string };
  students: number;
  distribution: Array<{ label: string; count: number }>;
  atRisk: Array<{ studentId: string; flags: string[] }>;
  roster: Array<{ studentId: string; name: string }>;
  assignments: Array<{ id: string; average: number | null }>;
}
interface StudentInsight {
  student: { id: string };
  classes: Array<{ classId: string; grade: number | null }>;
  attendance: { rate: number | null };
  weekly: { submissions: Array<{ weekStart: string; count: number }> };
  flags: string[];
}
interface Schedule {
  id: string;
  kind: string;
  frequency: string;
  nextRunAt: string;
  recipients: string[];
  active: boolean;
}
interface Problem {
  code: string;
}

const PASSWORD = 'SmartSchool!Demo2026';

/** Insight (slice 17): the principal overview, class and student analytics, CSV reports on a schedule, PDF transcripts. */
describe('Insight (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  let orgId = '';
  let classId = '';
  let emmaId = '';
  let ownUserId = '';
  let periodId = '';
  let otherStudentId = '';
  let reportCardId = '';
  let scheduleId = '';

  const login = async (role: string, email = `${role}@smartschool.local`) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    tokens[role] = (res.body as { accessToken: string }).accessToken;
  };
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });

  beforeAll(async () => {
    stub = await startAiStub(AI_STUB_TOKEN, AI_STUB_PORT);
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = configureApp(
      moduleRef.createNestApplication<NestExpressApplication>({
        bodyParser: false,
      }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
    await Promise.all(
      ['teacher', 'parent', 'principal', 'counselor', 'student'].map((r) =>
        login(r),
      ),
    );
    const klass = await prisma.class.findFirstOrThrow({
      where: { name: 'English 7 - Section A', deletedAt: null },
    });
    classId = klass.id;
    orgId = klass.organizationId;
    const parent = await prisma.user.findUniqueOrThrow({
      where: { email: 'parent@smartschool.local' },
    });
    // A student of our own, in the class and guarded by the demo parent: the gradebook suite deletes Emma's cards.
    const passwordHash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    const email = `insight-student-${stamp}@smartschool.local`;
    const user = await prisma.user.create({
      data: {
        id: newId(),
        email,
        passwordHash,
        passwordChangedAt: new Date(),
        firstName: 'Ivy',
        lastName: 'Insight',
        role: 'STUDENT',
        organizationId: orgId,
        emailVerifiedAt: new Date(),
      },
    });
    ownUserId = user.id;
    const own = await prisma.student.create({
      data: {
        id: newId(),
        organizationId: orgId,
        userId: user.id,
        studentNumber: `E2E-I-${stamp}`,
        firstName: 'Ivy',
        lastName: 'Insight',
        gradeLevel: '7',
        enrollmentStatus: 'ACTIVE',
      },
    });
    emmaId = own.id;
    await prisma.classEnrollment.create({
      data: { id: newId(), classId, studentId: emmaId, status: 'ENROLLED' },
    });
    await prisma.studentGuardian.create({
      data: {
        id: newId(),
        studentId: emmaId,
        guardianUserId: parent.id,
        relationship: 'GUARDIAN',
      },
    });
    await login('student', email);
    const other = await prisma.student.findFirstOrThrow({
      where: {
        organizationId: orgId,
        deletedAt: null,
        id: { not: emmaId },
        guardians: { none: { guardianUserId: parent.id } },
        studentNumber: { startsWith: 'S2026-' },
      },
    });
    otherStudentId = other.id;
    // A published report card of our own so the transcript has a line; the seeded Q1 of the seeded year.
    const q1 = await prisma.gradingPeriod.findFirstOrThrow({
      where: {
        name: 'Q1',
        term: { academicYear: { organizationId: orgId, name: '2026-2027' } },
      },
    });
    const period = await prisma.gradingPeriod.create({
      data: {
        id: newId(),
        termId: q1.termId,
        name: `E2E-I ${stamp}`,
        startDate: q1.startDate,
        endDate: q1.endDate,
        sortOrder: 99,
      },
    });
    periodId = period.id;
    const card = await prisma.reportCard.create({
      data: {
        id: newId(),
        organizationId: orgId,
        studentId: emmaId,
        gradingPeriodId: periodId,
        kind: 'REPORT_CARD',
        status: 'PUBLISHED',
        gpa: 3.5,
        publishedAt: new Date(),
        lines: {
          create: [
            {
              id: newId(),
              classId,
              className: `${klass.name} (e2e ${stamp})`,
              courseTitle: 'English 7',
              teacherName: 'Jane Teacher',
              percentage: 91.5,
              letter: 'A',
              gpaPoints: 4,
            },
          ],
        },
      },
    });
    reportCardId = card.id;
  });

  afterAll(async () => {
    if (reportCardId)
      await prisma.reportCard.deleteMany({ where: { id: reportCardId } });
    await prisma.reportSchedule.deleteMany({
      where: {
        organizationId: orgId,
        name: { startsWith: `E2E report ${stamp}` },
      },
    });
    if (periodId)
      await prisma.gradingPeriod.deleteMany({ where: { id: periodId } });
    await prisma.student.deleteMany({ where: { id: emmaId } });
    await prisma.user.deleteMany({ where: { id: ownUserId } });
    await app.close();
    stub.server.close();
  });

  it('gives the principal the school overview and keeps teachers and families out', async () => {
    const res = await request(server)
      .get(`/api/v1/organizations/${orgId}/insight/overview`)
      .set(as('principal'))
      .expect(200);
    const o = res.body as Overview;
    expect(o.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(o.attendance.classesMeeting).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(o.missingWork.byGradeLevel)).toBe(true);
    expect(o.failing.threshold).toBe(60);
    expect(o.gradebook.classes.length).toBeGreaterThanOrEqual(2);
    expect(typeof o.ai.conversations).toBe('number');
    expect(typeof o.engagement.submissions).toBe('number');
    expect(JSON.stringify(o)).not.toMatch(/"rank"/);
    await request(server)
      .get(`/api/v1/organizations/${orgId}/insight/overview`)
      .set(as('counselor'))
      .expect(200);
    const teacher = (
      await request(server)
        .get(`/api/v1/organizations/${orgId}/insight/overview`)
        .set(as('teacher'))
        .expect(403)
    ).body as Problem;
    expect(teacher.code).toBe('authz.forbidden');
    await request(server)
      .get(`/api/v1/organizations/${orgId}/insight/overview`)
      .set(as('parent'))
      .expect(403);
    await request(server)
      .get(`/api/v1/organizations/${orgId}/insight/overview?date=not-a-date`)
      .set(as('principal'))
      .expect(400);
  });

  it('shows a teacher the class picture: distribution, at-risk flags, assignment averages', async () => {
    const res = await request(server)
      .get(`/api/v1/classes/${classId}/insight`)
      .set(as('teacher'))
      .expect(200);
    const c = res.body as ClassInsight;
    expect(c.class.id).toBe(classId);
    expect(c.distribution.map((d) => d.label)).toEqual([
      '90-100',
      '80-89',
      '70-79',
      '60-69',
      'Below 60',
    ]);
    expect(c.roster.length).toBe(c.students);
    expect(c.roster.map((r) => r.name)).toEqual(
      [...c.roster.map((r) => r.name)].sort((a, b) => a.localeCompare(b)),
    );
    for (const r of c.atRisk) expect(r.flags.length).toBeGreaterThan(0);
    await request(server)
      .get(`/api/v1/classes/${classId}/insight`)
      .set(as('principal'))
      .expect(200);
    await request(server)
      .get(`/api/v1/classes/${classId}/insight`)
      .set(as('student'))
      .expect(403);
    await request(server)
      .get(`/api/v1/classes/${classId}/insight`)
      .set(as('parent'))
      .expect(403);
  });

  it('shows one student to their family and teachers, never to another family', async () => {
    const res = await request(server)
      .get(`/api/v1/students/${emmaId}/insight`)
      .set(as('parent'))
      .expect(200);
    const s = res.body as StudentInsight;
    expect(s.student.id).toBe(emmaId);
    expect(s.classes.length).toBeGreaterThanOrEqual(1);
    expect(s.weekly.submissions.length).toBe(8);
    await request(server)
      .get(`/api/v1/students/${emmaId}/insight`)
      .set(as('student'))
      .expect(200);
    await request(server)
      .get(`/api/v1/students/${emmaId}/insight`)
      .set(as('teacher'))
      .expect(200);
    await request(server)
      .get(`/api/v1/students/${emmaId}/insight`)
      .set(as('counselor'))
      .expect(200);
    const denied = (
      await request(server)
        .get(`/api/v1/students/${otherStudentId}/insight`)
        .set(as('parent'))
        .expect(403)
    ).body as Problem;
    expect(denied.code).toBe('authz.forbidden');
  });

  it('renders a PDF transcript from published report cards for the family and staff', async () => {
    const res = await request(server)
      .get(`/api/v1/students/${emmaId}/transcript.pdf`)
      .set(as('parent'))
      .expect(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect((res.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    expect((res.body as Buffer).length).toBeGreaterThan(1500);
    await request(server)
      .get(`/api/v1/students/${emmaId}/transcript.pdf`)
      .set(as('student'))
      .expect(200);
    await request(server)
      .get(`/api/v1/students/${emmaId}/transcript.pdf`)
      .set(as('principal'))
      .expect(200);
    await request(server)
      .get(`/api/v1/students/${otherStudentId}/transcript.pdf`)
      .set(as('parent'))
      .expect(403);
    const audit = await prisma.auditLog.count({
      where: { action: 'insight.transcript.pdf', entityId: emmaId },
    });
    expect(audit).toBeGreaterThanOrEqual(3);
  });

  it('downloads reports as CSV: school kinds for administrators, class summaries for the class teacher', async () => {
    const res = await request(server)
      .get(`/api/v1/organizations/${orgId}/insight/reports/missing_work.csv`)
      .set(as('principal'))
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(
      /missing-work-\d{4}-\d{2}-\d{2}\.csv/,
    );
    expect(
      res.text
        .replace(new RegExp('^' + String.fromCharCode(0xfeff)), '')
        .split('\r\n')[0],
    ).toBe('Student,Grade level,Class,Assignment,Due');
    const overview = await request(server)
      .get(`/api/v1/organizations/${orgId}/insight/reports/school_overview.csv`)
      .set(as('principal'))
      .expect(200);
    expect(overview.text).toContain('Classes meeting today');
    await request(server)
      .get(
        `/api/v1/organizations/${orgId}/insight/reports/failing_students.csv`,
      )
      .set(as('teacher'))
      .expect(403);
    const mine = await request(server)
      .get(
        `/api/v1/organizations/${orgId}/insight/reports/class_summary.csv?classId=${classId}`,
      )
      .set(as('teacher'))
      .expect(200);
    expect(mine.text).toContain('Student,Grade level,Current grade');
    await request(server)
      .get(`/api/v1/organizations/${orgId}/insight/reports/class_summary.csv`)
      .set(as('teacher'))
      .expect(400);
  });

  it('lets administrators schedule a report to staff, run it now and see the run', async () => {
    const bad = (
      await request(server)
        .post(`/api/v1/organizations/${orgId}/report-schedules`)
        .set(as('principal'))
        .send({
          name: `E2E report ${stamp} bad`,
          kind: 'missing_work',
          frequency: 'weekly',
          dayOfWeek: 1,
          hour: 7,
          recipients: ['parent@smartschool.local'],
        })
        .expect(400)
    ).body as Problem;
    expect(bad.code).toBe('insight.recipient_not_staff');
    const created = (
      await request(server)
        .post(`/api/v1/organizations/${orgId}/report-schedules`)
        .set(as('principal'))
        .send({
          name: `E2E report ${stamp}`,
          kind: 'missing_work',
          frequency: 'weekly',
          dayOfWeek: 1,
          hour: 7,
          recipients: [
            'teacher@smartschool.local',
            'principal@smartschool.local',
          ],
        })
        .expect(201)
    ).body as Schedule;
    scheduleId = created.id;
    expect(created.recipients).toEqual([
      'teacher@smartschool.local',
      'principal@smartschool.local',
    ]);
    expect(new Date(created.nextRunAt).getUTCDay()).toBe(1);
    expect(new Date(created.nextRunAt).getUTCHours()).toBe(7);
    const list = (
      await request(server)
        .get(`/api/v1/organizations/${orgId}/report-schedules`)
        .set(as('principal'))
        .expect(200)
    ).body as { data: Schedule[]; kinds: string[] };
    expect(list.data.some((s) => s.id === scheduleId)).toBe(true);
    expect(list.kinds).toContain('gradebook_completeness');
    const run = (
      await request(server)
        .post(`/api/v1/report-schedules/${scheduleId}/run`)
        .set(as('principal'))
        .expect(200)
    ).body as {
      status: string;
      delivered: boolean;
      rowCount: number;
      fileName: string;
    };
    expect(run.status).toBe('ok');
    expect(run.delivered).toBe(false); // no mail transport in tests, reported honestly
    expect(run.fileName).toMatch(/^missing-work-.*\.csv$/);
    const runs = (
      await request(server)
        .get(`/api/v1/report-schedules/${scheduleId}/runs`)
        .set(as('principal'))
        .expect(200)
    ).body as { data: Array<{ status: string }> };
    expect(runs.data.length).toBe(1);
    const paused = (
      await request(server)
        .patch(`/api/v1/report-schedules/${scheduleId}`)
        .set(as('principal'))
        .send({ active: false, frequency: 'daily', hour: 6 })
        .expect(200)
    ).body as Schedule;
    expect(paused.active).toBe(false);
    expect(paused.frequency).toBe('daily');
    await request(server)
      .post(`/api/v1/organizations/${orgId}/report-schedules`)
      .set(as('teacher'))
      .send({
        name: 'x',
        kind: 'ai_usage',
        frequency: 'daily',
        recipients: ['teacher@smartschool.local'],
      })
      .expect(403);
    await request(server)
      .delete(`/api/v1/report-schedules/${scheduleId}`)
      .set(as('teacher'))
      .expect(403);
    await request(server)
      .delete(`/api/v1/report-schedules/${scheduleId}`)
      .set(as('principal'))
      .expect(204);
    scheduleId = '';
  });
});
