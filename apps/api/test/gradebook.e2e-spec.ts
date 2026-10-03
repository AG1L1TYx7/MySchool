import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { newId } from '../src/common/utils/ids';
import { PrismaService } from '../src/infra/prisma/prisma.service';

interface Problem {
  code: string;
  detail: string;
}
interface Grading {
  gradingMode: string;
  categories: Array<{
    id: string;
    name: string;
    weight: number;
    dropLowest: number;
  }>;
  weightWarning: string | null;
  latePolicy: string | null;
  scale: { id: string; levels: Array<{ level: number; label: string }> } | null;
  canManage: boolean;
}
interface Book {
  mode: string;
  gradingMode: string;
  categories: Array<{ id: string; name: string }>;
  assignments: Array<{
    id: string;
    title: string;
    categoryId: string | null;
    isExtraCredit: boolean;
  }>;
  rows: Array<{
    student: { id: string };
    cells: Record<
      string,
      { score: number | null; mark: string; dropped: boolean }
    >;
    categories: Array<{ name: string; percentage: number | null }>;
    percentage: number | null;
    letter: string | null;
    missing: number;
  }>;
  standards: {
    standards: Array<{ id: string; code: string }>;
    rows: Array<{
      studentId: string;
      levels: Record<
        string,
        { latest: number | null; label: string | null } | null
      >;
    }>;
  } | null;
}
interface SubmissionRow {
  student: { id: string };
  submission: { id: string } | null;
  grade: {
    score: number;
    standardScores: Array<{ standardId: string; level: number; label: string }>;
  } | null;
  mark: string;
}
interface Card {
  id: string;
  status: string;
  gpa: number | null;
  lines: Array<{
    id: string;
    className: string;
    percentage: number | null;
    letter: string | null;
    comment: string | null;
    canComment: boolean;
    standards: Array<{ code: string }>;
  }>;
  canPublish: boolean;
  attendance: { daysPresent: number } | null;
}

const PASSWORD = 'SmartSchool!Demo2026';

/** Weighted categories, marks, standards tagging and standards-based grading, scales and report cards. */
describe('Gradebook, standards and report cards (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  let orgId = '';
  let classId = '';
  let emmaId = '';
  let homeworkId = '';
  let testsId = '';
  let quizId = '';
  let bonusId = '';
  let standardId = '';
  let q1Id = '';
  let cardId = '';
  let lineId = '';
  let setId = '';

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
    await Promise.all(
      ['teacher', 'student', 'parent', 'principal', 'superadmin'].map(login),
    );
    const seeded = await prisma.class.findFirstOrThrow({
      where: { name: 'English 7 - Section A', deletedAt: null },
    });
    orgId = seeded.organizationId;
    emmaId = (
      await prisma.student.findFirstOrThrow({
        where: { studentNumber: 'S2026-000001' },
      })
    ).id;
    const teacher = await prisma.user.findFirstOrThrow({
      where: { email: 'teacher@smartschool.local' },
    });
    // An isolated class so other specs running at the same time cannot change the numbers.
    const klass = await prisma.class.create({
      data: {
        id: newId(),
        organizationId: orgId,
        courseId: seeded.courseId,
        name: `E2E grading class ${stamp}`,
        term: 'Fall 2026',
        status: 'IN_PROGRESS',
        teachers: {
          create: { id: newId(), teacherId: teacher.id, isPrimary: true },
        },
        enrollments: {
          create: { id: newId(), studentId: emmaId, status: 'ENROLLED' },
        },
      },
    });
    classId = klass.id;
    q1Id = (
      await prisma.gradingPeriod.findFirstOrThrow({
        where: {
          name: 'Q1',
          term: { academicYear: { organizationId: orgId } },
        },
      })
    ).id;
    standardId = (
      await prisma.standard.findFirstOrThrow({
        where: { code: 'CCSS.ELA-LITERACY.W.7.3' },
      })
    ).id;
    await prisma.reportCard.deleteMany({ where: { studentId: emmaId } });
  });

  afterAll(async () => {
    await prisma.reportCard.deleteMany({ where: { studentId: emmaId } });
    await prisma.class.deleteMany({ where: { id: classId } });
    if (setId) await prisma.standardSet.deleteMany({ where: { id: setId } });
    await app.close();
  });

  it('shows class grading settings to members and lets the teacher edit them', async () => {
    const res = await request(server)
      .get(`/api/v1/classes/${classId}/grading`)
      .set(as('student'))
      .expect(200);
    const body = res.body as Grading;
    expect(body.gradingMode).toBe('points');
    expect(body.categories).toHaveLength(0);
    expect(body.canManage).toBe(false);
    const add = async (name: string, weight: number, dropLowest = 0) =>
      (
        (
          await request(server)
            .post(`/api/v1/classes/${classId}/grading/categories`)
            .set(as('teacher'))
            .send({ name, weight, dropLowest })
            .expect(201)
        ).body as { id: string }
      ).id;
    homeworkId = await add('Homework', 30, 1);
    quizId = await add('Quizzes', 30);
    const partial = (
      await request(server)
        .get(`/api/v1/classes/${classId}/grading`)
        .set(as('teacher'))
        .expect(200)
    ).body as Grading;
    expect(partial.weightWarning).toContain('60');
    expect(partial.canManage).toBe(true);
    testsId = await add('Tests', 40);
    const full = (
      await request(server)
        .get(`/api/v1/classes/${classId}/grading`)
        .set(as('teacher'))
        .expect(200)
    ).body as Grading;
    expect(full.weightWarning).toBeNull();
    expect(full.categories.map((c) => c.name)).toEqual([
      'Homework',
      'Quizzes',
      'Tests',
    ]);
    await request(server)
      .put(`/api/v1/classes/${classId}/grading`)
      .set(as('student'))
      .send({ latePolicy: 'none' })
      .expect(403);
    const saved = await request(server)
      .put(`/api/v1/classes/${classId}/grading`)
      .set(as('teacher'))
      .send({ latePolicy: `Late work loses 10% per day. ${stamp}` })
      .expect(200);
    expect((saved.body as Grading).latePolicy).toContain(String(stamp));
    const dup = await request(server)
      .post(`/api/v1/classes/${classId}/grading/categories`)
      .set(as('teacher'))
      .send({ name: 'Homework', weight: 10 })
      .expect(409);
    expect((dup.body as Problem).code).toBe('grading.category_exists');
  });

  it('weights categories, drops the lowest homework, counts missing as zero and leaves excused out', async () => {
    const make = async (
      title: string,
      categoryId: string | null,
      maxPoints: number,
      extra = false,
    ) => {
      const res = await request(server)
        .post('/api/v1/assignments')
        .set(as('teacher'))
        .send({
          classId,
          title,
          categoryId: categoryId ?? undefined,
          maxPoints,
          isExtraCredit: extra,
          standardIds: [standardId],
          gradingPeriodId: q1Id,
          dueAt: '2026-09-20T00:00:00Z',
        })
        .expect(201);
      const id = (res.body as { id: string }).id;
      await request(server)
        .post(`/api/v1/assignments/${id}/publish`)
        .set(as('teacher'))
        .expect(200);
      return id;
    };
    const h1 = await make(`E2E grading hw1 ${stamp}`, homeworkId, 10);
    const h2 = await make(`E2E grading hw2 ${stamp}`, homeworkId, 10);
    const t1 = await make(`E2E grading test ${stamp}`, testsId, 100);
    const ex = await make(`E2E grading excused ${stamp}`, testsId, 50);
    bonusId = await make(`E2E grading bonus ${stamp}`, homeworkId, 5, true);
    const created = await request(server)
      .get(`/api/v1/assignments/${h1}`)
      .set(as('teacher'))
      .expect(200);
    expect(
      (created.body as { category: string; standards: Array<{ code: string }> })
        .category,
    ).toBe('Homework');
    expect(
      (created.body as { standards: Array<{ code: string }> }).standards[0]
        .code,
    ).toBe('CCSS.ELA-LITERACY.W.7.3');
    // Emma submits and is graded on each; hw2 is marked missing, the excused test is excused.
    const gradeDirect = async (assignmentId: string, score: number) => {
      const sub = await prisma.assignmentSubmission.create({
        data: {
          id: newId(),
          assignmentId,
          studentId: emmaId,
          attemptNumber: 1,
          status: 'SUBMITTED',
          textContent: 'done',
        },
      });
      await request(server)
        .post(`/api/v1/submissions/${sub.id}/grade`)
        .set(as('teacher'))
        .send({ score })
        .expect(200);
    };
    await gradeDirect(h1, 9);
    await gradeDirect(t1, 70);
    await gradeDirect(bonusId, 3);
    await request(server)
      .put(`/api/v1/assignments/${h2}/marks/${emmaId}`)
      .set(as('teacher'))
      .send({ mark: 'missing', note: 'Not turned in' })
      .expect(200);
    await request(server)
      .put(`/api/v1/assignments/${ex}/marks/${emmaId}`)
      .set(as('teacher'))
      .send({ mark: 'excused' })
      .expect(200);
    await request(server)
      .put(`/api/v1/assignments/${ex}/marks/${emmaId}`)
      .set(as('student'))
      .send({ mark: 'excused' })
      .expect(403);

    const book = (
      await request(server)
        .get(`/api/v1/classes/${classId}/gradebook`)
        .set(as('teacher'))
        .expect(200)
    ).body as Book;
    expect(book.mode).toBe('categories');
    const row = book.rows.find((r) => r.student.id === emmaId);
    expect(row?.cells[h2]).toMatchObject({ score: 0, mark: 'missing' });
    expect(row?.cells[ex]).toMatchObject({ score: null, mark: 'excused' });
    expect(row?.cells[h2]?.dropped).toBe(true); // the lowest homework (0) is dropped
    const hw = row?.categories.find((c) => c.name === 'Homework');
    // 9/10 + 3 bonus = 12/10 -> capped at the category: (9+3)/10 = 120 -> we report the raw 120; final grade capped at 100
    expect(hw?.percentage).toBe(120);
    expect(row?.missing).toBe(1);
    expect(row?.cells[bonusId]).toMatchObject({ extraCredit: true });
    // Tests 70 (excused one left out). Weighted 0.3 * 120 + 0.4 * 70 over 0.7 = 91.43 -> A
    expect(row?.percentage).toBe(91.43);
    expect(row?.letter).toBe('A');

    const subs = (
      await request(server)
        .get(`/api/v1/assignments/${h2}/submissions`)
        .set(as('teacher'))
        .expect(200)
    ).body as { data: SubmissionRow[] };
    expect(subs.data.find((s) => s.student.id === emmaId)?.mark).toBe(
      'missing',
    );
    const mine = (
      await request(server)
        .get(`/api/v1/assignments/${h2}`)
        .set(as('student'))
        .expect(200)
    ).body as { myMark: string };
    expect(mine.myMark).toBe('missing');
    const csv = await request(server)
      .get(`/api/v1/classes/${classId}/gradebook/export`)
      .set(as('teacher'))
      .expect(200);
    expect(csv.text).toContain('Homework %');
    expect(csv.text).toContain(',M,');
  });

  it('switches a class to standards-based grading and records levels per standard', async () => {
    const scales = (
      await request(server)
        .get(`/api/v1/organizations/${orgId}/proficiency-scales`)
        .set(as('teacher'))
        .expect(200)
    ).body as { data: Array<{ id: string; isDefault: boolean }> };
    const scaleId = scales.data.find((s) => s.isDefault)?.id;
    expect(scaleId).toBeTruthy();
    await request(server)
      .put(`/api/v1/classes/${classId}/grading`)
      .set(as('teacher'))
      .send({ gradingMode: 'standards', proficiencyScaleId: scaleId })
      .expect(200);
    const a = await request(server)
      .post('/api/v1/assignments')
      .set(as('teacher'))
      .send({
        classId,
        title: `E2E grading standards ${stamp}`,
        categoryId: quizId,
        maxPoints: 20,
        standardIds: [standardId],
      })
      .expect(201);
    const assignmentId = (a.body as { id: string }).id;
    await request(server)
      .post(`/api/v1/assignments/${assignmentId}/publish`)
      .set(as('teacher'))
      .expect(200);
    const sub = await prisma.assignmentSubmission.create({
      data: {
        id: newId(),
        assignmentId,
        studentId: emmaId,
        attemptNumber: 1,
        status: 'SUBMITTED',
        textContent: 'done',
      },
    });
    const badLevel = await request(server)
      .post(`/api/v1/submissions/${sub.id}/grade`)
      .set(as('teacher'))
      .send({ score: 18, standardScores: [{ standardId, level: 9 }] })
      .expect(400);
    expect((badLevel.body as Problem).code).toBe('request.invalid');
    const graded = await request(server)
      .post(`/api/v1/submissions/${sub.id}/grade`)
      .set(as('teacher'))
      .send({ score: 18, standardScores: [{ standardId, level: 3 }] })
      .expect(200);
    expect(
      (
        graded.body as {
          standardScores: Array<{ level: number; label: string }>;
        }
      ).standardScores,
    ).toEqual([{ standardId, level: 3, label: 'Proficient' }]);
    const book = (
      await request(server)
        .get(`/api/v1/classes/${classId}/gradebook`)
        .set(as('principal'))
        .expect(200)
    ).body as Book;
    expect(book.gradingMode).toBe('standards');
    expect(
      book.standards?.standards.some(
        (s) => s.code === 'CCSS.ELA-LITERACY.W.7.3',
      ),
    ).toBe(true);
    const emma = book.standards?.rows.find((r) => r.studentId === emmaId);
    expect(emma?.levels[standardId]).toMatchObject({
      latest: 3,
      label: 'Proficient',
    });
  });

  it('lists shared standard sets, imports a CASE package and tags a lesson', async () => {
    const sets = (
      await request(server)
        .get('/api/v1/standards/sets')
        .set(as('teacher'))
        .expect(200)
    ).body as {
      data: Array<{ code: string; shared: boolean; standardCount: number }>;
    };
    expect(
      sets.data.some(
        (s) => s.code === 'CCSS-MATH' && s.shared && s.standardCount >= 5,
      ),
    ).toBe(true);
    const search = (
      await request(server)
        .get('/api/v1/standards')
        .query({ search: 'linear', gradeLevel: '7' })
        .set(as('teacher'))
        .expect(200)
    ).body as { data: Array<{ code: string }> };
    expect(
      search.data.some((s) => s.code === 'CCSS.MATH.CONTENT.7.EE.A.1'),
    ).toBe(true);
    const pkg = {
      CFDocument: {
        identifier: `doc-${stamp}`,
        title: `E2E Framework ${stamp}`,
        subjectTitle: ['Science'],
        creator: 'E2E',
      },
      CFItems: [
        {
          identifier: `p-${stamp}`,
          humanCodingScheme: `E2E.${stamp}.1`,
          fullStatement: 'Parent strand',
          educationLevel: ['07'],
        },
        {
          identifier: `c-${stamp}`,
          humanCodingScheme: `E2E.${stamp}.1.A`,
          fullStatement: 'Child standard about plants',
          educationLevel: ['07'],
        },
      ],
      CFAssociations: [
        {
          associationType: 'isChildOf',
          originNodeURI: { identifier: `c-${stamp}` },
          destinationNodeURI: { identifier: `p-${stamp}` },
        },
      ],
    };
    const imported = await request(server)
      .post('/api/v1/standards/sets/import')
      .set(as('principal'))
      .field('code', `E2E-${stamp % 10000}`)
      .attach('file', Buffer.from(JSON.stringify(pkg)), 'framework.json')
      .expect(201);
    const body = imported.body as {
      id: string;
      imported: number;
      shared: boolean;
      organizationId: string;
    };
    setId = body.id;
    expect(body.imported).toBe(2);
    expect(body.shared).toBe(false);
    expect(body.organizationId).toBe(orgId);
    const again = await request(server)
      .post('/api/v1/standards/sets/import')
      .set(as('principal'))
      .field('code', `E2E-${stamp % 10000}`)
      .attach('file', Buffer.from(JSON.stringify(pkg)), 'framework.json')
      .expect(201);
    expect((again.body as { imported: number; skipped: number }).skipped).toBe(
      2,
    );
    const child = await prisma.standard.findFirstOrThrow({
      where: { setId, code: `E2E.${stamp}.1.A` },
    });
    expect(child.parentId).not.toBeNull();
    const notJson = await request(server)
      .post('/api/v1/standards/sets/import')
      .set(as('principal'))
      .attach('file', Buffer.from('nope'), 'x.json')
      .expect(400);
    expect((notJson.body as Problem).code).toBe('standards.invalid_case');
    await request(server)
      .post('/api/v1/standards/sets')
      .set(as('student'))
      .send({ code: 'X', name: 'No' })
      .expect(403);
    // Tag a lesson with the imported child standard.
    const lesson = await prisma.lesson.findFirstOrThrow({
      where: { module: { course: { organizationId: orgId } } },
    });
    const tagged = await request(server)
      .patch(`/api/v1/lessons/${lesson.id}`)
      .set(as('teacher'))
      .send({ standardIds: [child.id] })
      .expect(200);
    expect(
      (tagged.body as { standards: Array<{ code: string }> }).standards[0].code,
    ).toBe(`E2E.${stamp}.1.A`);
    await request(server)
      .patch(`/api/v1/lessons/${lesson.id}`)
      .set(as('teacher'))
      .send({ standardIds: [] })
      .expect(200);
  });

  it('sets the district letter and GPA scales', async () => {
    const bad = await request(server)
      .put(`/api/v1/organizations/${orgId}/structure/settings`)
      .set(as('principal'))
      .send({
        gradingScale: [
          { letter: 'A', min: 90 },
          { letter: 'B', min: 50 },
        ],
      })
      .expect(400);
    expect((bad.body as Problem).detail).toContain('lowest');
    const ok = await request(server)
      .put(`/api/v1/organizations/${orgId}/structure/settings`)
      .set(as('principal'))
      .send({
        gradingScale: [
          { letter: 'A', min: 90 },
          { letter: 'B', min: 80 },
          { letter: 'C', min: 70 },
          { letter: 'D', min: 60 },
          { letter: 'F', min: 0 },
        ],
        gpaScale: [
          { letter: 'A', points: 4 },
          { letter: 'B', points: 3 },
          { letter: 'C', points: 2 },
          { letter: 'D', points: 1 },
          { letter: 'F', points: 0 },
        ],
      })
      .expect(200);
    expect(
      (ok.body as { gradingScale: Array<{ letter: string }> }).gradingScale[0]
        .letter,
    ).toBe('A');
  });

  it('generates report cards for a grading period, takes teacher comments, publishes and renders a PDF', async () => {
    await request(server)
      .put(`/api/v1/classes/${classId}/grading`)
      .set(as('teacher'))
      .send({ gradingMode: 'points' })
      .expect(200);
    const teacherAll = await request(server)
      .post('/api/v1/report-cards/generate')
      .set(as('teacher'))
      .send({ gradingPeriodId: q1Id })
      .expect(400);
    expect((teacherAll.body as Problem).code).toBe('request.invalid');
    const gen = await request(server)
      .post('/api/v1/report-cards/generate')
      .set(as('principal'))
      .send({ gradingPeriodId: q1Id })
      .expect(200);
    expect((gen.body as { students: number }).students).toBeGreaterThan(0);
    await request(server)
      .get('/api/v1/report-cards')
      .set(as('student'))
      .expect(200)
      .then((r) => expect((r.body as { data: Card[] }).data).toHaveLength(0));
    const list = (
      await request(server)
        .get('/api/v1/report-cards')
        .query({ studentId: emmaId, gradingPeriodId: q1Id })
        .set(as('teacher'))
        .expect(200)
    ).body as { data: Card[] };
    expect(list.data).toHaveLength(1);
    cardId = list.data[0].id;
    const line = list.data[0].lines.find(
      (l) => l.className === `E2E grading class ${stamp}`,
    );
    expect(line?.canComment).toBe(true);
    expect(line?.letter).toBeTruthy();
    expect(list.data[0].gpa).not.toBeNull();
    lineId = line?.id ?? '';
    const commented = await request(server)
      .patch(`/api/v1/report-cards/${cardId}/lines/${lineId}`)
      .set(as('teacher'))
      .send({
        comment: 'Emma writes with real voice. Keep reading every night.',
      })
      .expect(200);
    expect(
      (commented.body as Card).lines.find((l) => l.id === lineId)?.comment,
    ).toContain('real voice');
    await request(server)
      .post(`/api/v1/report-cards/${cardId}/publish`)
      .set(as('teacher'))
      .expect(403);
    const published = await request(server)
      .post('/api/v1/report-cards/publish')
      .set(as('principal'))
      .send({ gradingPeriodId: q1Id })
      .expect(200);
    expect((published.body as { published: number }).published).toBeGreaterThan(
      0,
    );
    const own = (
      await request(server)
        .get('/api/v1/report-cards')
        .set(as('student'))
        .expect(200)
    ).body as { data: Card[] };
    expect(
      own.data.some((c) => c.id === cardId && c.status === 'published'),
    ).toBe(true);
    const parent = await request(server)
      .get(`/api/v1/report-cards/${cardId}`)
      .set(as('parent'))
      .expect(200);
    expect(
      (parent.body as Card).lines.some((l) =>
        l.comment?.includes('real voice'),
      ),
    ).toBe(true);
    const locked = await request(server)
      .patch(`/api/v1/report-cards/${cardId}/lines/${lineId}`)
      .set(as('teacher'))
      .send({ comment: 'late edit' })
      .expect(409);
    expect((locked.body as Problem).code).toBe('report-cards.published');
    const pdf = await request(server)
      .get(`/api/v1/report-cards/${cardId}/pdf`)
      .set(as('parent'))
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
    const student = await prisma.student.findUniqueOrThrow({
      where: { id: emmaId },
    });
    expect(student.gpa).not.toBeNull();
  });
});
