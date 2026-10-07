import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infra/prisma/prisma.service';

interface Problem {
  code: string;
  detail: string;
}
interface Structure {
  gradeLevels: string[];
  attendanceDeadlineTime: string | null;
  timezone: string;
  years: Array<{
    id: string;
    name: string;
    isCurrent: boolean;
    terms: Array<{
      id: string;
      name: string;
      gradingPeriods: Array<{ id: string; name: string }>;
    }>;
  }>;
  bellSchedules: Array<{
    id: string;
    name: string;
    isDefault: boolean;
    periods: Array<{ id: string; name: string; days: string }>;
  }>;
  attendanceCodes: Array<{
    id: string;
    code: string;
    category: string;
    countsAsPresent: boolean;
  }>;
}
interface AttendanceRow {
  id: string;
  studentId: string;
  status: string;
  code: { code: string; category: string } | null;
  period: { id: string; name: string } | null;
}
interface FeedItem {
  id: string;
  kind: string;
  type: string;
  title: string;
  classId: string | null;
}

const PASSWORD = 'SmartSchool!Demo2026';
const DAY = '2026-11-17'; // a Tuesday inside the seeded term with no seeded attendance

/** School structure, period attendance with codes, office status and exports, and the calendar. */
describe('School structure, attendance and calendar (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  let orgId = '';
  let classId = '';
  let emmaId = '';
  let yearId = '';
  let termId = '';
  let scheduleId = '';
  let periodId = '';
  let excusedCodeId = '';
  let presentCodeId = '';
  let createdClassId = '';
  let eventId = '';

  const login = async (role: string) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `${role}@smartschool.local`, password: PASSWORD })
      .expect(200);
    tokens[role] = (res.body as { accessToken: string }).accessToken;
  };
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
  const base = () => `/api/v1/organizations/${orgId}/structure`;

  beforeAll(async () => {
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
    await Promise.all(['teacher', 'student', 'parent', 'principal'].map(login));
    const klass = await prisma.class.findFirstOrThrow({
      where: { name: 'English 7 - Section A', deletedAt: null },
    });
    classId = klass.id;
    orgId = klass.organizationId;
    emmaId = (
      await prisma.student.findFirstOrThrow({
        where: { studentNumber: 'S2026-000001' },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.attendance.deleteMany({
      where: { classId, date: new Date(`${DAY}T00:00:00Z`) },
    });
    if (createdClassId)
      await prisma.class.deleteMany({ where: { id: createdClassId } });
    if (eventId)
      await prisma.calendarEvent.deleteMany({ where: { id: eventId } });
    if (yearId) await prisma.academicYear.deleteMany({ where: { id: yearId } });
    if (scheduleId)
      await prisma.bellSchedule.deleteMany({ where: { id: scheduleId } });
    await prisma.attendanceCode.deleteMany({
      where: { organizationId: orgId, code: `X${stamp % 1000}` },
    });
    await app.close();
  });

  it('shows the seeded school structure to staff', async () => {
    const res = await request(server)
      .get(base())
      .set(as('teacher'))
      .expect(200);
    const body = res.body as Structure;
    expect(body.gradeLevels).toEqual(['6', '7', '8']);
    expect(body.attendanceDeadlineTime).toBe('10:00');
    expect(body.years.some((y) => y.name === '2026-2027')).toBe(true);
    const regular = body.bellSchedules.find((s) => s.name === 'Regular day');
    expect(regular?.periods).toHaveLength(7);
    expect(body.attendanceCodes.map((c) => c.code)).toEqual(
      expect.arrayContaining(['P', 'T', 'AE', 'AU']),
    );
    excusedCodeId = body.attendanceCodes.find((c) => c.code === 'AE')?.id ?? '';
    presentCodeId = body.attendanceCodes.find((c) => c.code === 'P')?.id ?? '';
    expect(excusedCodeId).not.toBe('');
  });

  it('keeps structure changes to administrators', async () => {
    const res = await request(server)
      .post(`${base()}/years`)
      .set(as('teacher'))
      .send({
        name: `Y${stamp}`,
        startDate: '2031-08-15',
        endDate: '2032-06-05',
      })
      .expect(403);
    expect((res.body as Problem).code).toBe('authz.forbidden');
    const student = await request(server)
      .post(`${base()}/years`)
      .set(as('student'))
      .send({
        name: `S${stamp}`,
        startDate: '2031-08-15',
        endDate: '2032-06-05',
      })
      .expect(403);
    expect((student.body as Problem).code).toBe('authz.forbidden');
  });

  it('lets a principal build a year with terms, grading periods, a bell schedule and codes', async () => {
    const year = await request(server)
      .post(`${base()}/years`)
      .set(as('principal'))
      .send({
        name: `Y${stamp}`,
        startDate: '2031-08-15',
        endDate: '2032-06-05',
      })
      .expect(201);
    yearId = (year.body as { id: string }).id;
    const term = await request(server)
      .post(`${base()}/years/${yearId}/terms`)
      .set(as('principal'))
      .send({
        name: 'Fall',
        type: 'semester',
        startDate: '2031-08-15',
        endDate: '2031-12-20',
      })
      .expect(201);
    termId = (term.body as { id: string }).id;
    const outside = await request(server)
      .post(`${base()}/years/${yearId}/terms`)
      .set(as('principal'))
      .send({ name: 'Summer', startDate: '2032-06-10', endDate: '2032-07-20' })
      .expect(400);
    expect((outside.body as Problem).code).toBe('request.invalid');
    await request(server)
      .post(`${base()}/terms/${termId}/grading-periods`)
      .set(as('principal'))
      .send({ name: 'Q1', startDate: '2031-08-15', endDate: '2031-10-10' })
      .expect(201);
    const schedule = await request(server)
      .post(`${base()}/bell-schedules`)
      .set(as('principal'))
      .send({ name: `Early release ${stamp}` })
      .expect(201);
    scheduleId = (schedule.body as { id: string }).id;
    const period = await request(server)
      .post(`${base()}/bell-schedules/${scheduleId}/periods`)
      .set(as('principal'))
      .send({ name: '1', startTime: '08:00', endTime: '08:35', days: 'MTWRF' })
      .expect(201);
    periodId = (period.body as { id: string }).id;
    const badTime = await request(server)
      .post(`${base()}/bell-schedules/${scheduleId}/periods`)
      .set(as('principal'))
      .send({ name: '2', startTime: '09:00', endTime: '08:35' })
      .expect(400);
    expect((badTime.body as Problem).code).toBe('request.invalid');
    const code = await request(server)
      .post(`${base()}/attendance-codes`)
      .set(as('principal'))
      .send({
        code: `X${stamp % 1000}`,
        label: 'Testing day',
        category: 'other',
        countsAsPresent: true,
      })
      .expect(201);
    expect((code.body as { category: string }).category).toBe('other');
    const dup = await request(server)
      .post(`${base()}/attendance-codes`)
      .set(as('principal'))
      .send({
        code: 'AE',
        label: 'Again',
        category: 'excused',
        countsAsPresent: false,
      })
      .expect(409);
    expect((dup.body as Problem).code).toBe('school.code_exists');
    const after = await request(server)
      .get(base())
      .set(as('principal'))
      .expect(200);
    const built = (after.body as Structure).years.find((y) => y.id === yearId);
    expect(built?.terms[0]?.gradingPeriods).toHaveLength(1);
  });

  it('updates grade levels and the attendance deadline', async () => {
    const res = await request(server)
      .put(`${base()}/settings`)
      .set(as('principal'))
      .send({ gradeLevels: ['6', '7', '8'], attendanceDeadlineTime: '10:00' })
      .expect(200);
    expect((res.body as Structure).attendanceDeadlineTime).toBe('10:00');
    const bad = await request(server)
      .put(`${base()}/settings`)
      .set(as('principal'))
      .send({ gradeLevels: ['13'] })
      .expect(400);
    expect((bad.body as Problem).code).toBe('request.invalid');
  });

  it('creates a class tied to a term and period', async () => {
    // A seeded course: picking any course can land on the curriculum suite's own course, which it then cannot delete.
    const course = await prisma.course.findFirstOrThrow({
      where: { organizationId: orgId, courseCode: 'ELA-7', deletedAt: null },
    });
    const res = await request(server)
      .post('/api/v1/classes')
      .set(as('principal'))
      .send({
        courseId: course.id,
        name: `E2E period class ${stamp}`,
        termId,
        periodId,
        gradeLevel: '7',
      })
      .expect(201);
    const body = res.body as {
      id: string;
      term: string;
      termId: string;
      period: { name: string } | null;
      gradeLevel: string;
    };
    createdClassId = body.id;
    expect(body.term).toBe('Fall');
    expect(body.termId).toBe(termId);
    expect(body.period?.name).toBe('1');
    expect(body.gradeLevel).toBe('7');
    const noTerm = await request(server)
      .post('/api/v1/classes')
      .set(as('principal'))
      .send({ courseId: course.id, name: `E2E no term ${stamp}` })
      .expect(400);
    expect((noTerm.body as Problem).code).toBe('request.invalid');
  });

  it('records period attendance with a district code and derives the status', async () => {
    const roster = await prisma.classEnrollment.findMany({
      where: { classId, status: 'ENROLLED' },
      select: { studentId: true },
    });
    const period = await prisma.period.findFirstOrThrow({
      where: {
        bellSchedule: { organizationId: orgId, name: 'Regular day' },
        name: '1',
      },
    });
    const res = await request(server)
      .post('/api/v1/attendance/bulk')
      .set(as('teacher'))
      .send({
        classId,
        date: DAY,
        periodId: period.id,
        records: roster.map((r) => ({
          studentId: r.studentId,
          codeId: r.studentId === emmaId ? excusedCodeId : presentCodeId,
        })),
      })
      .expect(200);
    const rows = (res.body as { records: AttendanceRow[] }).records;
    const emma = rows.find((r) => r.studentId === emmaId);
    expect(emma?.status).toBe('excused');
    expect(emma?.code?.code).toBe('AE');
    expect(emma?.period?.name).toBe('1');
    expect(
      rows
        .filter((r) => r.studentId !== emmaId)
        .every((r) => r.status === 'present'),
    ).toBe(true);
    const unknown = await request(server)
      .post('/api/v1/attendance')
      .set(as('teacher'))
      .send({
        classId,
        studentId: emmaId,
        date: DAY,
        codeId: '00000000-0000-7000-8000-000000000000',
      })
      .expect(400);
    expect((unknown.body as Problem).code).toBe('request.invalid');
    const none = await request(server)
      .post('/api/v1/attendance')
      .set(as('teacher'))
      .send({ classId, studentId: emmaId, date: DAY })
      .expect(400);
    expect((none.body as Problem).code).toBe('request.invalid');
  });

  it('tells the office which classes have taken attendance', async () => {
    const res = await request(server)
      .get(`/api/v1/organizations/${orgId}/attendance/status`)
      .query({ date: DAY })
      .set(as('principal'))
      .expect(200);
    const body = res.body as {
      deadline: string | null;
      taken: Array<{ classId: string }>;
      missing: Array<{ classId: string }>;
    };
    expect(body.deadline).toBe('10:00');
    expect(body.taken.some((c) => c.classId === classId)).toBe(true);
    expect(body.missing.some((c) => c.classId === classId)).toBe(false);
    await request(server)
      .get(`/api/v1/organizations/${orgId}/attendance/status`)
      .set(as('student'))
      .expect(403);
  });

  it('exports average daily attendance and the chronic absenteeism list', async () => {
    const ada = await request(server)
      .get(`/api/v1/organizations/${orgId}/attendance/export`)
      .query({ from: DAY, to: DAY, type: 'ada' })
      .set(as('principal'))
      .expect(200);
    expect(ada.headers['content-type']).toContain('text/csv');
    const lines = ada.text.trim().split(/\r?\n/);
    expect(lines[0]).toBe(
      'studentNumber,lastName,firstName,gradeLevel,daysEnrolled,daysPresent,daysAbsent,attendanceRate,chronicallyAbsent',
    );
    expect(
      lines.some(
        (l) => l.startsWith('S2026-000001,') && l.endsWith(',1,0,1,0,yes'),
      ),
    ).toBe(true);
    expect(lines[lines.length - 1]).toContain('average daily attendance');
    const chronic = await request(server)
      .get(`/api/v1/organizations/${orgId}/attendance/export`)
      .query({ from: DAY, to: DAY, type: 'chronic' })
      .set(as('principal'))
      .expect(200);
    expect(chronic.text).toContain('S2026-000001');
    await request(server)
      .get(`/api/v1/organizations/${orgId}/attendance/export`)
      .query({ from: DAY, to: DAY })
      .set(as('parent'))
      .expect(403);
  });

  it('puts class events, due dates and term boundaries on the calendar', async () => {
    const created = await request(server)
      .post('/api/v1/calendar/events')
      .set(as('teacher'))
      .send({
        title: `Field trip ${stamp}`,
        type: 'class_event',
        classId,
        startsAt: `${DAY}T14:00:00Z`,
        endsAt: `${DAY}T16:00:00Z`,
      })
      .expect(201);
    eventId = (created.body as { id: string }).id;
    const schoolWide = await request(server)
      .post('/api/v1/calendar/events')
      .set(as('teacher'))
      .send({
        title: 'Snow day',
        type: 'day_off',
        startsAt: `${DAY}T00:00:00Z`,
        allDay: true,
      })
      .expect(403);
    expect((schoolWide.body as Problem).code).toBe('authz.forbidden');
    const feed = await request(server)
      .get('/api/v1/calendar')
      .query({ from: '2026-11-01', to: '2026-11-30' })
      .set(as('student'))
      .expect(200);
    const items = (feed.body as { data: FeedItem[] }).data;
    expect(items.some((i) => i.id === eventId && i.kind === 'event')).toBe(
      true,
    );
    const outsider = await request(server)
      .get('/api/v1/calendar')
      .query({ from: '2026-11-01', to: '2026-11-30' })
      .set(as('parent'))
      .expect(200);
    expect(
      (outsider.body as { data: FeedItem[] }).data.some(
        (i) => i.id === eventId,
      ),
    ).toBe(true);
    const terms = await request(server)
      .get('/api/v1/calendar')
      .query({ from: '2026-08-01', to: '2026-08-31' })
      .set(as('teacher'))
      .expect(200);
    expect(
      (terms.body as { data: FeedItem[] }).data.some((i) => i.kind === 'term'),
    ).toBe(true);
  });

  it('serves a private iCal subscription without a login', async () => {
    const sub = await request(server)
      .get('/api/v1/calendar/subscription')
      .set(as('student'))
      .expect(200);
    const path = (sub.body as { path: string }).path;
    expect(path).toMatch(/^\/api\/v1\/calendar\/ical\/[A-Za-z0-9_-]+\.ics$/);
    const ics = await request(server).get(path).expect(200);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.text).toContain('BEGIN:VCALENDAR');
    expect(ics.text).toContain(`Field trip ${stamp}`);
    const rotated = await request(server)
      .get('/api/v1/calendar/subscription')
      .query({ rotate: 'true' })
      .set(as('student'))
      .expect(200);
    expect((rotated.body as { path: string }).path).not.toBe(path);
    await request(server).get(path).expect(404);
  });

  it('refuses to delete a term that classes still use', async () => {
    const res = await request(server)
      .delete(`${base()}/terms/${termId}`)
      .set(as('principal'))
      .expect(409);
    expect((res.body as Problem).code).toBe('school.in_use');
  });
});
