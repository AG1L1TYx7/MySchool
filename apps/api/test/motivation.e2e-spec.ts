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
import { MotivationService } from '../src/modules/motivation/motivation.service';
import { startAiStub } from './ai-stub';
import { retryWrite } from './retry';

interface Summary {
  enabled: boolean;
  xp: number;
  level: number;
  title: string;
  streak: { days: number; alive: boolean };
  badges: Array<{ code: string; reason: string | null }>;
  quests: Array<{
    id: string;
    kind: string;
    auto: boolean;
    status: string;
    progress: number;
    classTotal: number | null;
  }>;
  recent: Array<{ reason: string; amount: number }>;
}
interface Completion {
  completed: boolean;
  alreadyCompleted: boolean;
  reward: { granted: number; badges: string[]; streakDays: number } | null;
}
interface Problem {
  code: string;
}

const PASSWORD = 'SmartSchool!Demo2026';

/** Private XP, streaks, badges, quests and progress maps awarded from learning events; never a ranking. */
describe('Motivation (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  let orgId = '';
  let classId = '';
  let studentId = '';
  let otherStudentId = '';
  let courseId = '';
  let lessonIds: string[] = [];
  let assignmentId = '';
  let submissionId = '';
  let questId = '';

  const login = async (role: string, email = `${role}@smartschool.local`) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    tokens[role] = (res.body as { accessToken: string }).accessToken;
  };
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
  const mine = async (): Promise<Summary> =>
    (
      await request(server)
        .get('/api/v1/me/motivation')
        .set(as('student'))
        .expect(200)
    ).body as Summary;
  // Listeners run after the response; give them a moment.
  const settle = () => new Promise((r) => setTimeout(r, 400));

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
      where: { name: 'English 7 - Section A', deletedAt: null },
    });
    classId = klass.id;
    orgId = klass.organizationId;
    const emma = await prisma.student.findFirstOrThrow({
      where: { studentNumber: 'S2026-000001' },
    });
    // A student of our own, enrolled in the class and linked to the demo parent, so parallel suites
    // that submit and grade as the demo student cannot change the numbers asserted below.
    const passwordHash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    const email = `motivation-student-${stamp}@smartschool.local`;
    const user = await prisma.user.create({
      data: {
        id: newId(),
        email,
        passwordHash,
        passwordChangedAt: new Date(),
        firstName: 'Max',
        lastName: 'Motivation',
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
        studentNumber: `E2E-M-${stamp}`,
        firstName: 'Max',
        lastName: 'Motivation',
        gradeLevel: '7',
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
    // Someone this parent does not guard and this student is not: nobody in the family may see them.
    const other = await prisma.student.findFirstOrThrow({
      where: {
        organizationId: orgId,
        deletedAt: null,
        id: { notIn: [emma.id, studentId] },
        guardians: { none: { guardianUserId: parent.id } },
        studentNumber: { startsWith: 'S2026-' }, // seeded, so no parallel suite deletes them
      },
    });
    otherStudentId = other.id;
    // Lessons come from the published Algebra course, which has four; the progress map is checked on it.
    const algebra = await prisma.course.findFirstOrThrow({
      where: { courseCode: 'MATH-ALG1', deletedAt: null },
    });
    courseId = algebra.id;
    lessonIds = (
      await prisma.lesson.findMany({
        where: { isPublished: true, module: { courseId, isPublished: true } },
        orderBy: [{ module: { sortOrder: 'asc' } }, { sortOrder: 'asc' }],
        select: { id: true },
        take: 3,
      })
    ).map((l) => l.id);
    expect(lessonIds.length).toBeGreaterThanOrEqual(3);
    // A clean slate for the demo student so the numbers below are exact.
    await prisma.lessonCompletion.deleteMany({
      where: { studentId: studentId },
    });
    await prisma.rewardTransaction.deleteMany({
      where: { studentId: studentId },
    });
    await prisma.studentBadge.deleteMany({ where: { studentId: studentId } });
    await prisma.questProgress.deleteMany({ where: { studentId: studentId } });
    await prisma.quest.deleteMany({
      where: {
        OR: [{ studentId: studentId }, { title: { startsWith: 'E2E quest' } }],
      },
    });
    await prisma.studentPoints.deleteMany({ where: { studentId: studentId } });
    await retryWrite(() =>
      prisma.organization.update({
        where: { id: orgId },
        data: { motivationEnabled: true },
      }),
    );
  });

  afterAll(async () => {
    await retryWrite(() =>
      prisma.organization.update({
        where: { id: orgId },
        data: { motivationEnabled: true },
      }),
    );
    await app.close();
    stub.server.close();
  });

  it('starts every student at level 1 and keeps the page to students', async () => {
    const s = await mine();
    expect(s.enabled).toBe(true);
    expect(s.level).toBe(1);
    expect(s.xp).toBe(0);
    expect(s.title).toBe('newcomer');
    expect(s.streak.days).toBe(0);
    await request(server)
      .get('/api/v1/me/motivation')
      .set(as('teacher'))
      .expect(403);
  });

  it('rewards a finished lesson once, starts the streak and the first badge, and shows the progress map', async () => {
    const first = await request(server)
      .post(`/api/v1/lessons/${lessonIds[0]}/complete`)
      .set(as('student'))
      .expect(200);
    const body = first.body as Completion;
    expect(body.alreadyCompleted).toBe(false);
    expect(body.reward?.granted).toBe(10);
    expect(body.reward?.badges).toContain('first-steps');
    expect(body.reward?.streakDays).toBe(1);
    const again = await request(server)
      .post(`/api/v1/lessons/${lessonIds[0]}/complete`)
      .set(as('student'))
      .expect(200);
    expect((again.body as Completion).alreadyCompleted).toBe(true);
    const s = await mine();
    expect(s.xp).toBe(10);
    expect(s.badges.map((b) => b.code)).toContain('first-steps');
    expect(s.streak.days).toBe(1);
    const map = await request(server)
      .get(`/api/v1/courses/${courseId}/progress`)
      .set(as('student'))
      .expect(200);
    const progress = map.body as {
      completedLessons: number;
      nextLessonId: string | null;
      modules: Array<{ lessons: Array<{ id: string; completed: boolean }> }>;
    };
    expect(progress.completedLessons).toBe(1);
    expect(progress.nextLessonId).toBe(lessonIds[1]);
    expect(
      progress.modules
        .flatMap((m) => m.lessons)
        .find((l) => l.id === lessonIds[0])?.completed,
    ).toBe(true);
    await request(server)
      .post(`/api/v1/lessons/${lessonIds[0]}/complete`)
      .set(as('teacher'))
      .expect(403);
  });

  it('rewards a submission with an on-time bonus once, then a perfect score, and moves the class quest', async () => {
    const now = Date.now();
    const created = await request(server)
      .post('/api/v1/assignments')
      .set(as('teacher'))
      .send({
        classId,
        title: `E2E motivation ${stamp}`,
        maxPoints: 10,
        availableFrom: new Date(now - 60_000).toISOString(),
        dueAt: new Date(now + 2 * 86_400_000).toISOString(),
      })
      .expect(201);
    assignmentId = (created.body as { id: string }).id;
    await request(server)
      .post(`/api/v1/assignments/${assignmentId}/publish`)
      .set(as('teacher'))
      .expect(200);
    // A class quest of our own (the seeded one may already be complete): on-time work from everyone counts.
    const quest = await request(server)
      .post(`/api/v1/classes/${classId}/quests`)
      .set(as('teacher'))
      .send({
        title: `E2E quest on time ${stamp}`,
        metric: 'on_time',
        goal: 50,
        rewardXp: 0,
      })
      .expect(201);
    const onTimeQuestId = (quest.body as { id: string }).id;
    const submitted = await request(server)
      .post(`/api/v1/assignments/${assignmentId}/submissions`)
      .set(as('student'))
      .send({ textContent: 'My work.' })
      .expect(201);
    submissionId = (submitted.body as { id: string }).id;
    await settle();
    let s = await mine();
    expect(s.xp).toBe(40);
    expect(s.recent.map((r) => r.reason)).toEqual(
      expect.arrayContaining(['assignment.submitted', 'assignment.on_time']),
    );
    // A second attempt grants nothing more.
    await request(server)
      .post(`/api/v1/assignments/${assignmentId}/submissions`)
      .set(as('student'))
      .send({ textContent: 'My work, revised.' })
      .expect(201);
    await settle();
    s = await mine();
    expect(s.xp).toBe(40);
    // The seeded class quest counts on-time work from everyone, and the student sees only the total and their own part.
    const quests = await request(server)
      .get(`/api/v1/classes/${classId}/quests`)
      .set(as('student'))
      .expect(200);
    const classQuest = (quests.body as { data: Summary['quests'] }).data.find(
      (q) => q.id === onTimeQuestId,
    );
    expect(classQuest).toBeDefined();
    expect(classQuest?.progress).toBe(1);
    expect(classQuest?.classTotal ?? 0).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(quests.body)).not.toContain('"students"');

    const latest = await prisma.assignmentSubmission.findFirstOrThrow({
      where: { assignmentId, studentId: studentId },
      orderBy: { attemptNumber: 'desc' },
    });
    submissionId = latest.id;
    await request(server)
      .post(`/api/v1/submissions/${submissionId}/grade`)
      .set(as('teacher'))
      .send({ score: 10 })
      .expect(200);
    await settle();
    s = await mine();
    expect(s.recent.map((r) => r.reason)).toContain('score.perfect');
    expect(s.xp).toBeGreaterThanOrEqual(65);
  });

  it('lets a teacher award points and a kindness badge with a reason, once', async () => {
    const xp = await request(server)
      .post(`/api/v1/students/${studentId}/motivation/awards`)
      .set(as('teacher'))
      .send({ kind: 'xp', amount: 50, reason: 'Helped set up the lab.' })
      .expect(201);
    expect((xp.body as { reward: { granted: number } }).reward.granted).toBe(
      50,
    );
    await request(server)
      .post(`/api/v1/students/${studentId}/motivation/awards`)
      .set(as('teacher'))
      .send({
        kind: 'badge',
        badgeCode: 'kindness',
        reason: 'Welcomed a new classmate.',
      })
      .expect(201);
    const dup = await request(server)
      .post(`/api/v1/students/${studentId}/motivation/awards`)
      .set(as('teacher'))
      .send({ kind: 'badge', badgeCode: 'kindness', reason: 'Again.' })
      .expect(403);
    expect((dup.body as Problem).code).toBe('motivation.already_awarded');
    await request(server)
      .post(`/api/v1/students/${studentId}/motivation/awards`)
      .set(as('teacher'))
      .send({ kind: 'badge', badgeCode: 'first-steps', reason: 'Not allowed.' })
      .expect(403);
    await request(server)
      .post(`/api/v1/students/${studentId}/motivation/awards`)
      .set(as('student'))
      .send({ kind: 'xp', amount: 50, reason: 'Myself.' })
      .expect(403);
    const s = await mine();
    const kindness = s.badges.find((b) => b.code === 'kindness');
    expect(kindness?.reason).toBe('Welcomed a new classmate.');
    expect(s.recent.find((r) => r.reason === 'teacher.award')?.amount).toBe(50);
  });

  it('shows progress to the family, the teachers and the counselor, and to nobody else', async () => {
    const parent = await request(server)
      .get(`/api/v1/students/${studentId}/motivation`)
      .set(as('parent'))
      .expect(200);
    expect((parent.body as Summary).badges.map((b) => b.code)).toContain(
      'kindness',
    );
    await request(server)
      .get(`/api/v1/students/${studentId}/motivation`)
      .set(as('counselor'))
      .expect(200);
    await request(server)
      .get(`/api/v1/students/${otherStudentId}/motivation`)
      .set(as('student'))
      .expect(403);
    await request(server)
      .get(`/api/v1/students/${otherStudentId}/motivation`)
      .set(as('parent'))
      .expect(403);
    const console_ = await request(server)
      .get(`/api/v1/classes/${classId}/motivation`)
      .set(as('teacher'))
      .expect(200);
    const rows = (
      console_.body as {
        students: Array<{ id: string; level: number; lastName: string }>;
      }
    ).students;
    expect(rows.some((r) => r.id === studentId)).toBe(true);
    // Alphabetical, never by score.
    const names = rows.map((r) => r.lastName);
    expect(names).toEqual(
      [...names].sort((a, b) =>
        a.localeCompare(b, 'en', { sensitivity: 'base' }),
      ),
    );
    expect(JSON.stringify(console_.body)).not.toMatch(/"rank"/);
    await request(server)
      .get(`/api/v1/classes/${classId}/motivation`)
      .set(as('student'))
      .expect(403);
    await request(server)
      .get(`/api/v1/classes/${classId}/motivation`)
      .set(as('parent'))
      .expect(403);
  });

  it('runs a class quest to completion and shares the reward', async () => {
    const created = await request(server)
      .post(`/api/v1/classes/${classId}/quests`)
      .set(as('teacher'))
      .send({
        title: `E2E quest ${stamp}`,
        metric: 'lessons',
        goal: 1,
        rewardXp: 5,
      })
      .expect(201);
    questId = (created.body as { id: string }).id;
    const before = (await mine()).xp;
    await request(server)
      .post(`/api/v1/lessons/${lessonIds[1]}/complete`)
      .set(as('student'))
      .expect(200);
    const quests = await request(server)
      .get(`/api/v1/classes/${classId}/quests`)
      .set(as('student'))
      .expect(200);
    const q = (quests.body as { data: Summary['quests'] }).data.find(
      (x) => x.id === questId,
    );
    expect(q?.status).toBe('completed');
    expect(q?.progress).toBe(1);
    const after = await mine();
    expect(after.xp).toBe(before + 10 + 5);
    expect(after.recent.map((r) => r.reason)).toContain('quest.completed');
    await request(server)
      .delete(`/api/v1/quests/${questId}`)
      .set(as('student'))
      .expect(403);
    await request(server)
      .delete(`/api/v1/quests/${questId}`)
      .set(as('teacher'))
      .expect(204);
  });

  it('generates personal weekly quests and expires old ones', async () => {
    const service = app.get(MotivationService);
    const created = await service.generateWeeklyQuests();
    expect(created).toBeGreaterThanOrEqual(1);
    const s = await mine();
    expect(s.quests.some((q) => q.kind === 'personal' && q.auto)).toBe(true);
    expect(await service.generateWeeklyQuests()).toBe(0); // idempotent within the week
    expect(typeof (await service.expireQuests())).toBe('number');
  });

  it('stops rewarding when the school turns motivation off', async () => {
    await request(server)
      .put(`/api/v1/organizations/${orgId}/motivation/settings`)
      .set(as('principal'))
      .send({ motivationEnabled: false })
      .expect(200);
    const setting = await request(server)
      .get(`/api/v1/organizations/${orgId}/motivation/settings`)
      .set(as('student'))
      .expect(200);
    expect(
      (setting.body as { motivationEnabled: boolean }).motivationEnabled,
    ).toBe(false);
    const done = await request(server)
      .post(`/api/v1/lessons/${lessonIds[2]}/complete`)
      .set(as('student'))
      .expect(200);
    expect((done.body as Completion).reward).toBeNull();
    expect((await mine()).enabled).toBe(false);
    await request(server)
      .put(`/api/v1/organizations/${orgId}/motivation/settings`)
      .set(as('teacher'))
      .send({ motivationEnabled: true })
      .expect(403);
    await request(server)
      .put(`/api/v1/organizations/${orgId}/motivation/settings`)
      .set(as('principal'))
      .send({ motivationEnabled: true })
      .expect(200);
  });
});
