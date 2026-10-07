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
interface AssignmentBody {
  id: string;
  status: string;
  canManage: boolean;
  mySubmissions?: Array<{
    id: string;
    attemptNumber: number;
    status: string;
    isLate: boolean;
    grade: { score: number } | null;
  }>;
  mySubmission?: { status: string } | null;
  myGrade?: { score: number; percentage: number } | null;
}
interface SubmissionBody {
  id: string;
  attemptNumber: number;
  status: string;
  isLate: boolean;
  files: Array<{ id: string; originalName: string }>;
}
interface GradeBody {
  score: number;
  maxPoints: number;
  percentage: number;
  letterGrade: string;
  latePenaltyApplied: number | null;
}

const PASSWORD = 'SmartSchool!Demo2026';

/** Files, rubrics, assignments, submissions, grading, gradebook and attendance against the seeded database. */
describe('Academics (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  let classId = '';
  let emmaId = '';
  let rubricId = '';
  let assignmentId = '';
  let fileId = '';
  let submissionId = '';

  const login = async (role: string) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `${role}@smartschool.local`, password: PASSWORD })
      .expect(200);
    tokens[role] = (res.body as { accessToken: string }).accessToken;
  };
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });

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
    emmaId = (
      await prisma.student.findFirstOrThrow({
        where: { studentNumber: 'S2026-000001' },
      })
    ).id;
  });

  afterAll(async () => {
    if (assignmentId)
      await prisma.assignment.deleteMany({ where: { id: assignmentId } });
    if (rubricId) await prisma.rubric.deleteMany({ where: { id: rubricId } });
    if (fileId) await prisma.fileUpload.deleteMany({ where: { id: fileId } });
    await prisma.attendance.deleteMany({
      where: { classId, date: new Date('2030-01-15T00:00:00Z') },
    });
    await app.close();
  });

  it('lets a teacher create a rubric and a draft assignment with it', async () => {
    const rubric = await request(server)
      .post('/api/v1/rubrics')
      .set(as('teacher'))
      .send({
        title: `E2E rubric ${stamp}`,
        criteria: [
          { id: 'ideas', title: 'Ideas', maxPoints: 6 },
          { title: 'Mechanics', maxPoints: 4 },
        ],
      })
      .expect(201);
    rubricId = (rubric.body as { id: string }).id;
    expect((rubric.body as { totalPoints: number }).totalPoints).toBe(10);
    const res = await request(server)
      .post('/api/v1/assignments')
      .set(as('teacher'))
      .send({
        classId,
        title: `E2E essay ${stamp}`,
        maxPoints: 10,
        rubricId,
        dueAt: '2026-01-01T00:00:00Z',
        latePenaltyPercent: 10,
        maxAttempts: 2,
      })
      .expect(201);
    const body = res.body as AssignmentBody;
    expect(body.status).toBe('draft');
    expect(body.canManage).toBe(true);
    assignmentId = body.id;
  });

  it('hides drafts from students and refuses submissions until published', async () => {
    await request(server)
      .get(`/api/v1/assignments/${assignmentId}`)
      .set(as('student'))
      .expect(404);
    await request(server)
      .post(`/api/v1/assignments/${assignmentId}/publish`)
      .set(as('teacher'))
      .expect(200);
    const visible = await request(server)
      .get(`/api/v1/assignments/${assignmentId}`)
      .set(as('student'))
      .expect(200);
    expect((visible.body as AssignmentBody).canManage).toBe(false);
    await request(server)
      .post(`/api/v1/assignments/${assignmentId}/submissions`)
      .set(as('student'))
      .send({})
      .expect(400);
  });

  it('uploads a file, refuses dangerous types, and submits late with the file attached', async () => {
    const bad = await request(server)
      .post('/api/v1/files')
      .set(as('student'))
      .attach('file', Buffer.from('echo hi'), 'script.exe')
      .expect(400);
    expect((bad.body as Problem).code).toBe('file.type_not_allowed');
    const up = await request(server)
      .post('/api/v1/files?category=submission')
      .set(as('student'))
      .attach(
        'file',
        Buffer.from('My essay about story structure.'),
        'essay.txt',
      )
      .expect(201);
    fileId = (up.body as { id: string }).id;
    const meta = await request(server)
      .get(`/api/v1/files/${fileId}`)
      .set(as('student'))
      .expect(200);
    expect((meta.body as { originalName: string }).originalName).toBe(
      'essay.txt',
    );
    const dl = await request(server)
      .get(`/api/v1/files/${fileId}/download`)
      .set(as('teacher'))
      .expect(200);
    expect(dl.headers['content-disposition']).toContain('essay.txt');
    expect(dl.text).toContain('My essay');

    const sub = await request(server)
      .post(`/api/v1/assignments/${assignmentId}/submissions`)
      .set(as('student'))
      .send({ textContent: 'Here is my essay.', fileIds: [fileId] })
      .expect(201);
    const body = sub.body as SubmissionBody;
    expect(body.attemptNumber).toBe(1);
    expect(body.isLate).toBe(true);
    expect(body.status).toBe('late');
    expect(body.files.map((f) => f.id)).toEqual([fileId]);
    submissionId = body.id;
    const other = await request(server)
      .post('/api/v1/files')
      .set(as('teacher'))
      .attach('file', Buffer.from('x'), 'notes.txt')
      .expect(201);
    const stolen = await request(server)
      .post(`/api/v1/assignments/${assignmentId}/submissions`)
      .set(as('student'))
      .send({ fileIds: [(other.body as { id: string }).id] })
      .expect(400);
    expect((stolen.body as Problem).code).toBe('file.not_owned');
    await prisma.fileUpload.deleteMany({
      where: { id: (other.body as { id: string }).id },
    });
  });

  it('keeps the submission private to the student, their parent and the class teacher', async () => {
    await request(server)
      .get(`/api/v1/submissions/${submissionId}`)
      .set(as('student'))
      .expect(200);
    await request(server)
      .get(`/api/v1/submissions/${submissionId}`)
      .set(as('parent'))
      .expect(200);
    await request(server)
      .get(`/api/v1/submissions/${submissionId}`)
      .set(as('teacher'))
      .expect(200);
    await request(server)
      .post(`/api/v1/submissions/${submissionId}/grade`)
      .set(as('student'))
      .send({ score: 10 })
      .expect(403);
  });

  it('grades with the rubric, applies the late penalty, and shows the grade to the student and parent', async () => {
    const tooMuch = await request(server)
      .post(`/api/v1/submissions/${submissionId}/grade`)
      .set(as('teacher'))
      .send({ score: 11 })
      .expect(400);
    expect((tooMuch.body as Problem).code).toBe('request.invalid');
    const graded = await request(server)
      .post(`/api/v1/submissions/${submissionId}/grade`)
      .set(as('teacher'))
      .send({
        score: 9,
        feedback: 'Strong ideas.',
        rubricScores: [
          { criterionId: 'ideas', points: 6 },
          { criterionId: 'c2', points: 3 },
        ],
      })
      .expect(200);
    const g = graded.body as GradeBody;
    expect(g).toMatchObject({
      score: 8,
      maxPoints: 10,
      percentage: 80,
      letterGrade: 'B',
      latePenaltyApplied: 10,
    });
    const mine = await request(server)
      .get('/api/v1/grades')
      .set(as('student'))
      .expect(200);
    expect(
      (
        mine.body as { data: Array<{ assignmentId: string; score: number }> }
      ).data.some((x) => x.assignmentId === assignmentId && x.score === 8),
    ).toBe(true);
    const child = await request(server)
      .get(`/api/v1/grades?studentId=${emmaId}`)
      .set(as('parent'))
      .expect(200);
    expect((child.body as { data: unknown[] }).data.length).toBeGreaterThan(0);
    const list = await request(server)
      .get(`/api/v1/assignments?classId=${classId}`)
      .set(as('student'))
      .expect(200);
    const row = (list.body as { data: AssignmentBody[] }).data.find(
      (a) => a.id === assignmentId,
    );
    expect(row?.mySubmission?.status).toBe('graded');
    expect(row?.myGrade?.score).toBe(8);
    const enrollment = await prisma.classEnrollment.findUniqueOrThrow({
      where: { classId_studentId: { classId, studentId: emmaId } },
    });
    expect(enrollment.currentGrade).not.toBeNull();
  });

  it('builds the gradebook and exports it, for the teacher and the principal only', async () => {
    const book = await request(server)
      .get(`/api/v1/classes/${classId}/gradebook`)
      .set(as('teacher'))
      .expect(200);
    const body = book.body as {
      rows: Array<{
        student: { id: string };
        percentage: number | null;
        letter: string | null;
      }>;
      assignments: Array<{ id: string }>;
      classAverage: number | null;
    };
    expect(body.assignments.some((a) => a.id === assignmentId)).toBe(true);
    const emma = body.rows.find((r) => r.student.id === emmaId);
    expect(emma?.percentage).not.toBeNull();
    await request(server)
      .get(`/api/v1/classes/${classId}/gradebook`)
      .set(as('principal'))
      .expect(200);
    await request(server)
      .get(`/api/v1/classes/${classId}/gradebook`)
      .set(as('student'))
      .expect(403);
    const csv = await request(server)
      .get(`/api/v1/classes/${classId}/gradebook/export`)
      .set(as('teacher'))
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('S2026-000001');
  });

  it('takes attendance in bulk, corrects one record, and summarises by class and by student', async () => {
    const roster = await request(server)
      .get(`/api/v1/classes/${classId}/enrollments`)
      .set(as('teacher'))
      .expect(200);
    const ids = (
      roster.body as { data: Array<{ studentId: string; status: string }> }
    ).data
      .filter((e) => e.status === 'enrolled')
      .map((e) => e.studentId);
    // Only seeded students: parallel suites enrol students of their own in this class and delete them again,
    // and a row for a student removed mid-test fails the insert.
    const seeded = new Set(
      (
        await prisma.student.findMany({
          where: { id: { in: ids }, studentNumber: { startsWith: 'S2026-' } },
          select: { id: true },
        })
      ).map((st) => st.id),
    );
    ids.splice(0, ids.length, ...ids.filter((id) => seeded.has(id)));
    const bulk = await request(server)
      .post('/api/v1/attendance/bulk')
      .set(as('teacher'))
      .send({
        classId,
        date: '2030-01-15',
        records: ids.map((studentId, i) => ({
          studentId,
          status: i === 0 ? 'absent' : 'present',
        })),
      })
      .expect(200);
    const saved = bulk.body as {
      saved: number;
      records: Array<{ id: string; studentId: string; status: string }>;
    };
    expect(saved.saved).toBe(ids.length);
    const first = saved.records[0];
    const fixed = await request(server)
      .patch(`/api/v1/attendance/${first.id}`)
      .set(as('teacher'))
      .send({ status: 'excused', notes: 'Doctor' })
      .expect(200);
    expect((fixed.body as { status: string }).status).toBe('excused');
    const summary = await request(server)
      .get(
        `/api/v1/classes/${classId}/attendance/summary?from=2030-01-01&to=2030-01-31`,
      )
      .set(as('teacher'))
      .expect(200);
    expect((summary.body as { daysRecorded: number }).daysRecorded).toBe(1);
    const mine = await request(server)
      .get(`/api/v1/students/${emmaId}/attendance/summary`)
      .set(as('student'))
      .expect(200);
    expect(
      (mine.body as { counts: { total: number } }).counts.total,
    ).toBeGreaterThan(0);
    await request(server)
      .post('/api/v1/attendance')
      .set(as('student'))
      .send({
        classId,
        studentId: emmaId,
        date: '2030-01-16',
        status: 'present',
      })
      .expect(403);
    const own = await request(server)
      .get('/api/v1/attendance?from=2030-01-01&to=2030-01-31')
      .set(as('student'))
      .expect(200);
    expect(
      (own.body as { data: Array<{ studentId: string }> }).data.every(
        (r) => r.studentId === emmaId,
      ),
    ).toBe(true);
  });
});
