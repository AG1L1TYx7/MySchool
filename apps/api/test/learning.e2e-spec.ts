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
import { retryWrite } from './retry';

interface Record_ {
  id: string;
  verb: string;
  objectType: string;
  objectId: string;
  scaled: number | null;
  success: boolean | null;
  completion: boolean | null;
}
interface Card {
  id: string;
  front: string;
  back: string;
  hint: string | null;
  intervalDays: number;
  repetitions: number;
  dueOn: string;
  status: string;
  suspended: boolean;
}
interface Mastery {
  standards: Array<{
    standardId: string;
    code: string;
    level: number;
    band: string;
    trend: string;
    evidenceCount: number;
  }>;
  average: number | null;
  counts: {
    advanced: number;
    proficient: number;
    developing: number;
    beginning: number;
  };
}
interface Problem {
  code: string;
}

const PASSWORD = 'SmartSchool!Demo2026';

/** Learning records (xAPI), spaced repetition, mastery per standard and learning curves (slice 16). */
describe('Learning records and science (e2e)', () => {
  // Listener-driven steps poll for up to eight seconds when every suite runs at once.
  jest.setTimeout(20_000);
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  let orgId = '';
  let classId = '';
  let courseId = '';
  let studentId = '';
  let otherStudentId = '';
  let lessonId = '';
  let standardId = '';
  let contentId = '';
  let cardId = '';

  const login = async (role: string, email = `${role}@smartschool.local`) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    tokens[role] = (res.body as { accessToken: string }).accessToken;
  };
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
  // Listeners run after the response; poll until they have written what we expect (parallel suites slow them down).
  const until = async <T>(
    read: () => Promise<T>,
    ok: (v: T) => boolean,
    ms = 8000,
  ): Promise<T> => {
    const end = Date.now() + ms;
    let v = await read();
    while (!ok(v) && Date.now() < end) {
      await new Promise((r) => setTimeout(r, 250));
      v = await read();
    }
    return v;
  };
  const records = async (who = 'teacher'): Promise<Record_[]> =>
    (
      (
        await request(server)
          .get(`/api/v1/students/${studentId}/learning/records`)
          .set(as(who))
          .expect(200)
      ).body as { data: Record_[] }
    ).data;

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
      ['teacher', 'parent', 'principal', 'counselor'].map((r) => login(r)),
    );
    const klass = await prisma.class.findFirstOrThrow({
      where: { name: 'Algebra I - Section A', deletedAt: null },
      include: { course: true },
    });
    classId = klass.id;
    orgId = klass.organizationId;
    courseId = klass.courseId;
    const passwordHash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    const email = `learning-student-${stamp}@smartschool.local`;
    const user = await prisma.user.create({
      data: {
        id: newId(),
        email,
        passwordHash,
        passwordChangedAt: new Date(),
        firstName: 'Lena',
        lastName: 'Learning',
        role: 'STUDENT',
        organizationId: orgId,
        emailVerifiedAt: new Date(),
      },
    });
    const own = await prisma.student.create({
      data: {
        id: newId(),
        organizationId: orgId,
        userId: user.id,
        studentNumber: `E2E-L-${stamp}`,
        firstName: 'Lena',
        lastName: 'Learning',
        gradeLevel: '9',
        enrollmentStatus: 'ACTIVE',
      },
    });
    studentId = own.id;
    await prisma.classEnrollment.create({
      data: { id: newId(), classId, studentId, status: 'ENROLLED' },
    });
    const parent = await prisma.user.findUniqueOrThrow({
      where: { email: 'parent@smartschool.local' },
    });
    await prisma.studentGuardian.create({
      data: {
        id: newId(),
        studentId,
        guardianUserId: parent.id,
        relationship: 'GUARDIAN',
      },
    });
    await login('student', email);
    const other = await prisma.student.findFirstOrThrow({
      where: {
        organizationId: orgId,
        deletedAt: null,
        id: { not: studentId },
        guardians: { none: { guardianUserId: parent.id } },
        studentNumber: { startsWith: 'S2026-' }, // seeded, so no parallel suite deletes them
        enrollments: { none: { classId } },
      },
    });
    otherStudentId = other.id;
    // A published lesson of the course, tagged with a seeded standard so completing it is mastery evidence.
    // A lesson of our own at the end of the course: other suites retag the seeded first lesson and the motivation suite completes the first three.
    const firstModule = await prisma.module.findFirstOrThrow({
      where: { courseId, isPublished: true },
      orderBy: { sortOrder: 'desc' }, // the last module, past the lessons the motivation suite takes
    });
    const lesson = await prisma.lesson.create({
      data: {
        id: newId(),
        moduleId: firstModule.id,
        title: `Solving two-step equations (e2e ${stamp})`,
        lessonType: 'TEXT',
        content: 'Undo addition first, then undo multiplication.',
        sortOrder: 999,
        isPublished: true,
      },
    });
    lessonId = lesson.id;
    const standard = await prisma.standard.findFirstOrThrow({
      where: { code: 'CCSS.MATH.CONTENT.7.EE.B.4' },
    });
    standardId = standard.id;
    await prisma.lessonStandard.upsert({
      where: { lessonId_standardId: { lessonId, standardId } },
      update: {},
      create: { lessonId, standardId },
    });
    await retryWrite(() =>
      prisma.organization.update({
        where: { id: orgId },
        data: { motivationEnabled: true },
      }),
    );
  });

  afterAll(async () => {
    await prisma.lessonCompletion.deleteMany({ where: { lessonId } });
    await prisma.lesson.deleteMany({ where: { id: lessonId } });
    await prisma.xapiStatement.deleteMany({ where: { studentId } });
    await prisma.srsCard.deleteMany({ where: { studentId } });
    await prisma.masteryLevel.deleteMany({ where: { studentId } });
    await prisma.lessonCompletion.deleteMany({ where: { studentId } });
    if (contentId)
      await prisma.h5PContent.deleteMany({ where: { id: contentId } });
    await prisma.student.delete({ where: { id: studentId } });
    await app.close();
    stub.server.close();
  });

  it('a teacher publishes a flashcard set', async () => {
    const res = await request(server)
      .post('/api/v1/h5p/contents')
      .set(as('teacher'))
      .send({
        title: `Linear equations vocabulary ${stamp}`,
        library: 'H5P.Dialogcards 1.9',
        parameters: {
          dialogs: [
            {
              text: '<p>Coefficient</p>',
              answer: 'The number multiplied by a variable',
              tips: { front: 'In 3x it is 3' },
            },
            { text: 'Constant', answer: 'A term with no variable' },
            {
              text: 'Variable',
              answer: 'A letter standing for an unknown number',
            },
          ],
        },
      })
      .expect(201);
    contentId = (res.body as { id: string }).id;
    await request(server)
      .post(`/api/v1/h5p/contents/${contentId}/publish`)
      .set(as('teacher'))
      .expect(200);
  });

  it('an H5P result becomes xAPI statements and practice XP', async () => {
    const before = (
      await request(server)
        .get('/api/v1/me/motivation')
        .set(as('student'))
        .expect(200)
    ).body as { xp: number };
    await request(server)
      .post(`/api/v1/h5p/contents/${contentId}/results`)
      .set(as('student'))
      .send({ score: 3, maxScore: 3, completed: true, timeSpentSeconds: 95 })
      .expect(201);
    const rows = await until(
      records,
      (r) => r.filter((x) => x.objectId === contentId).length >= 2,
    );
    const mine = rows.filter((r) => r.objectId === contentId);
    expect(mine.map((r) => r.verb).sort()).toEqual(['completed', 'passed']);
    expect(mine.find((r) => r.verb === 'passed')?.scaled).toBe(1);
    const after = await until(
      async () =>
        (
          await request(server)
            .get('/api/v1/me/motivation')
            .set(as('student'))
            .expect(200)
        ).body as { xp: number; recent: Array<{ reason: string }> },
      (m) => m.xp > before.xp,
    );
    expect(after.xp).toBe(before.xp + 10);
    expect(after.recent.some((r) => r.reason === 'practice.completed')).toBe(
      true,
    );
    // The stored statement is real xAPI: an actor account, a verb IRI, a scaled score.
    const full = await prisma.xapiStatement.findFirstOrThrow({
      where: { studentId, objectId: contentId, verb: 'passed' },
    });
    const statement = JSON.parse(full.statement) as {
      actor: { account: { homePage: string } };
      verb: { id: string };
      result: { score: { scaled: number } };
    };
    expect(statement.verb.id).toBe('http://adlnet.gov/expapi/verbs/passed');
    expect(statement.result.score.scaled).toBe(1);
    expect(statement.actor.account.homePage).toContain('smartschool');
  });

  it('completing a tagged lesson records a statement and mastery evidence', async () => {
    await request(server)
      .post(`/api/v1/lessons/${lessonId}/complete`)
      .set(as('student'))
      .expect(200);
    const rows = await until(records, (r) =>
      r.some((x) => x.objectType === 'lesson' && x.objectId === lessonId),
    );
    expect(
      rows.some(
        (r) =>
          r.objectType === 'lesson' &&
          r.objectId === lessonId &&
          r.verb === 'completed',
      ),
    ).toBe(true);
    const mastery = await until(
      async () =>
        (
          await request(server)
            .get('/api/v1/me/mastery')
            .set(as('student'))
            .expect(200)
        ).body as Mastery,
      (m) => m.standards.some((s) => s.standardId === standardId),
    );
    const row = mastery.standards.find((s) => s.standardId === standardId);
    expect(row).toBeDefined();
    expect(row?.code).toBe('CCSS.MATH.CONTENT.7.EE.B.4');
    expect(row?.evidenceCount).toBeGreaterThanOrEqual(1);
    expect(row?.level).toBeGreaterThan(0.9);
    expect(row?.band).toBe('advanced');
  });

  it('turns the flashcard set into practice cards once', async () => {
    const first = (
      await request(server)
        .post(`/api/v1/practice/cards/from-content/${contentId}`)
        .set(as('student'))
        .expect(201)
    ).body as { created: number; skipped: number };
    expect(first).toMatchObject({ created: 3, skipped: 0 });
    const again = (
      await request(server)
        .post(`/api/v1/practice/cards/from-content/${contentId}`)
        .set(as('student'))
        .expect(201)
    ).body as { created: number; skipped: number };
    expect(again).toMatchObject({ created: 0, skipped: 3 });
    const cards = (
      (
        await request(server)
          .get('/api/v1/practice/cards')
          .set(as('student'))
          .expect(200)
      ).body as { data: Card[] }
    ).data;
    const coefficient = cards.find((c) => c.front === 'Coefficient');
    expect(coefficient).toMatchObject({
      back: 'The number multiplied by a variable',
      hint: 'In 3x it is 3',
      status: 'new',
    });
    cardId = coefficient!.id;
    expect(cards.some((c) => c.front.includes('<'))).toBe(false);
  });

  it('queues due and new cards and schedules the next review with SM-2', async () => {
    const queue = (
      await request(server)
        .get('/api/v1/practice/queue')
        .set(as('student'))
        .expect(200)
    ).body as { data: Card[]; newCards: number; due: number };
    expect(queue.data.length).toBe(3);
    expect(queue.newCards).toBe(3);
    const good = (
      await request(server)
        .post(`/api/v1/practice/cards/${cardId}/review`)
        .set(as('student'))
        .send({ quality: 4, durationMs: 4200 })
        .expect(200)
    ).body as { card: Card; reviewedToday: number; sessionGoal: number };
    expect(good.card.intervalDays).toBe(1);
    expect(good.card.repetitions).toBe(1);
    expect(good.card.status).toBe('learning');
    expect(good.reviewedToday).toBe(1);
    expect(good.sessionGoal).toBe(10);
    const later = (
      await request(server)
        .get('/api/v1/practice/queue')
        .set(as('student'))
        .expect(200)
    ).body as { data: Card[] };
    expect(later.data.some((c) => c.id === cardId)).toBe(false);
    // Forgetting sends the card back to the start.
    const forgot = (
      await request(server)
        .post(`/api/v1/practice/cards/${cardId}/review`)
        .set(as('student'))
        .send({ quality: 1 })
        .expect(200)
    ).body as { card: Card };
    expect(forgot.card.repetitions).toBe(0);
    expect(forgot.card.intervalDays).toBe(1);
    await request(server)
      .post(`/api/v1/practice/cards/${cardId}/review`)
      .set(as('student'))
      .send({ quality: 7 })
      .expect(400);
    const stats = (
      await request(server)
        .get('/api/v1/me/practice')
        .set(as('student'))
        .expect(200)
    ).body as {
      total: number;
      reviewedToday: number;
      retentionLast30Days: number | null;
    };
    expect(stats.total).toBe(3);
    expect(stats.reviewedToday).toBe(2);
    expect(stats.retentionLast30Days).toBe(50);
    const answered = await until(
      records,
      (r) => r.filter((x) => x.objectType === 'srs-card').length >= 2,
    );
    expect(answered.filter((r) => r.objectType === 'srs-card').length).toBe(2);
  });

  it('students manage their own cards only', async () => {
    await request(server)
      .post('/api/v1/practice/cards')
      .set(as('student'))
      .send({ front: 'Slope', back: 'Rise over run' })
      .expect(201);
    const sus = (
      await request(server)
        .post(`/api/v1/practice/cards/${cardId}/suspend`)
        .set(as('student'))
        .send({ suspended: true })
        .expect(200)
    ).body as Card;
    expect(sus.suspended).toBe(true);
    const queue = (
      await request(server)
        .get('/api/v1/practice/queue')
        .set(as('student'))
        .expect(200)
    ).body as { data: Card[] };
    expect(queue.data.some((c) => c.id === cardId)).toBe(false);
    await request(server)
      .get('/api/v1/practice/queue')
      .set(as('teacher'))
      .expect(403);
    await request(server)
      .post(`/api/v1/practice/cards/${cardId}/review`)
      .set(as('parent'))
      .send({ quality: 5 })
      .expect(403);
  });

  it('shows mastery and curves to the family and the student’s teachers, not to others', async () => {
    for (const who of ['parent', 'teacher', 'counselor', 'principal']) {
      const res = (
        await request(server)
          .get(`/api/v1/students/${studentId}/mastery`)
          .set(as(who))
          .expect(200)
      ).body as Mastery;
      expect(res.standards.length).toBeGreaterThanOrEqual(1);
      await request(server)
        .get(`/api/v1/students/${studentId}/learning/curve`)
        .set(as(who))
        .expect(200);
    }
    const curve = (
      await request(server)
        .get('/api/v1/me/learning/curve')
        .set(as('student'))
        .expect(200)
    ).body as {
      weeks: Array<{
        weekStart: string;
        items: number;
        retention: number | null;
      }>;
    };
    expect(curve.weeks.length).toBe(12);
    const thisWeek = curve.weeks[curve.weeks.length - 1];
    expect(thisWeek.items).toBeGreaterThanOrEqual(2);
    expect(thisWeek.retention).toBe(50);
    const problem = (
      await request(server)
        .get(`/api/v1/students/${otherStudentId}/mastery`)
        .set(as('parent'))
        .expect(403)
    ).body as Problem;
    expect(problem.code).toBe('authz.forbidden');
    await request(server)
      .get(`/api/v1/students/${otherStudentId}/learning/records`)
      .set(as('student'))
      .expect(403);
    const course = (
      await request(server)
        .get(`/api/v1/courses/${courseId}/mastery`)
        .set(as('student'))
        .expect(200)
    ).body as { level: number | null; modules: Array<{ measured: number }> };
    expect(course.level).not.toBeNull();
    expect({
      modules: course.modules,
      measured: course.modules.some((m) => m.measured >= 1),
    }).toMatchObject({ measured: true });
    await request(server)
      .get(`/api/v1/courses/${courseId}/mastery?studentId=${studentId}`)
      .set(as('parent'))
      .expect(200);
  });

  it('gives teachers the class picture and content analytics', async () => {
    const klass = (
      await request(server)
        .get(`/api/v1/classes/${classId}/mastery`)
        .set(as('teacher'))
        .expect(200)
    ).body as {
      students: number;
      standards: Array<{
        standardId: string;
        measured: number;
        average: number;
        needsHelp: unknown[];
      }>;
    };
    expect(klass.students).toBeGreaterThanOrEqual(1);
    const row = klass.standards.find((s) => s.standardId === standardId);
    expect(row).toBeDefined();
    expect(row?.measured).toBeGreaterThanOrEqual(1);
    await request(server)
      .get(`/api/v1/classes/${classId}/learning/curve`)
      .set(as('teacher'))
      .expect(200);
    await request(server)
      .get(`/api/v1/classes/${classId}/mastery`)
      .set(as('student'))
      .expect(403);
    await request(server)
      .get(`/api/v1/classes/${classId}/mastery`)
      .set(as('parent'))
      .expect(403);
    const analytics = (
      await request(server)
        .get(`/api/v1/h5p/contents/${contentId}/analytics`)
        .set(as('teacher'))
        .expect(200)
    ).body as {
      attempts: number;
      completed: number;
      passRate: number | null;
      averageSeconds: number | null;
      students: number;
    };
    expect(analytics).toMatchObject({
      attempts: 1,
      completed: 1,
      passRate: 100,
      averageSeconds: 95,
      students: 1,
    });
    const query = (
      (
        await request(server)
          .get(`/api/v1/xapi/statements?studentId=${studentId}&verb=answered`)
          .set(as('teacher'))
          .expect(200)
      ).body as { data: Record_[] }
    ).data;
    expect(query.length).toBe(2);
    expect(query.every((r) => r.verb === 'answered')).toBe(true);
    await request(server)
      .get('/api/v1/xapi/statements?verb=nope')
      .set(as('teacher'))
      .expect(400);
  });

  it('exports full statements to administrators only, resumable by stored time', async () => {
    await request(server)
      .get(`/api/v1/organizations/${orgId}/xapi/export`)
      .set(as('teacher'))
      .expect(403);
    const page = (
      await request(server)
        .get(`/api/v1/organizations/${orgId}/xapi/export?limit=2`)
        .set(as('principal'))
        .expect(200)
    ).body as {
      data: Array<{
        id: string;
        stored: string;
        actor: unknown;
        verb: { id: string };
      }>;
      next: string | null;
    };
    expect(page.data.length).toBe(2);
    expect(page.data[0].verb.id).toContain('adlnet.gov');
    expect(page.next).not.toBeNull();
    const rest = (
      await request(server)
        .get(
          `/api/v1/organizations/${orgId}/xapi/export?since=${encodeURIComponent(page.next!)}`,
        )
        .set(as('principal'))
        .expect(200)
    ).body as { data: Array<{ id: string }> };
    expect(rest.data.some((r) => r.id === page.data[0].id)).toBe(false);
  });
});
