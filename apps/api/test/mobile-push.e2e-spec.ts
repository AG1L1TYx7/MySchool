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

interface Home {
  serverTime: string;
  unread: number;
  todayClasses: Array<{ id: string; name: string }>;
  work: { overdue: unknown[]; dueSoon: unknown[]; recentlyGraded: unknown[] };
  attendance: { toTake: Array<{ classId: string }> } | null;
  motivation: { xp: number; level: number } | null;
  children: Array<{ id: string }>;
  announcements: Array<{ id: string; title: string }>;
}
interface Sync {
  serverTime: string;
  since: string | null;
  next: string;
  classes: Array<{ id: string }>;
  assignments: Array<{ id: string; updatedAt: string }>;
  grades: unknown[];
  announcements: unknown[];
  notifications: Array<{ id: string }>;
  conversations: Array<{ id: string }>;
}
interface Device {
  id: string;
  platform: string;
  active: boolean;
}
interface Problem {
  code: string;
}

const PASSWORD = 'SmartSchool!Demo2026';
const TOKEN = `e2e-token-${Date.now()}-abcdefghijklmnopqrstuvwxyz`;

/** Mobile and push (slice 18): the compact home and sync calls, device registration, simulated push, offline-safe tutor replays. */
describe('Mobile and push (e2e)', () => {
  // The push test polls for the listener-driven log for up to eight seconds.
  jest.setTimeout(20_000);
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  let orgId = '';
  let classId = '';
  let studentId = '';
  let userId = '';
  let deviceId = '';
  let conversationId = '';

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
    await Promise.all(['teacher', 'parent', 'principal'].map((r) => login(r)));
    const klass = await prisma.class.findFirstOrThrow({
      where: { name: 'Algebra I - Section A', deletedAt: null },
    });
    classId = klass.id;
    orgId = klass.organizationId;
    const passwordHash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    const email = `mobile-student-${stamp}@smartschool.local`;
    const user = await prisma.user.create({
      data: {
        id: newId(),
        email,
        passwordHash,
        passwordChangedAt: new Date(),
        firstName: 'Mia',
        lastName: 'Mobile',
        role: 'STUDENT',
        organizationId: orgId,
        emailVerifiedAt: new Date(),
      },
    });
    userId = user.id;
    const own = await prisma.student.create({
      data: {
        id: newId(),
        organizationId: orgId,
        userId: user.id,
        studentNumber: `E2E-MOB-${stamp}`,
        firstName: 'Mia',
        lastName: 'Mobile',
        gradeLevel: '9',
        enrollmentStatus: 'ACTIVE',
      },
    });
    studentId = own.id;
    await prisma.classEnrollment.create({
      data: { id: newId(), classId, studentId, status: 'ENROLLED' },
    });
    await login('student', email);
  });

  afterAll(async () => {
    await prisma.pushDevice.deleteMany({ where: { userId } });
    if (conversationId)
      await prisma.aiConversation.deleteMany({ where: { id: conversationId } });
    await prisma.student.delete({ where: { id: studentId } });
    await prisma.user.delete({ where: { id: userId } });
    await app.close();
    stub.server.close();
  });

  it('serves the compact home for a student, a teacher and a parent, compressed', async () => {
    const res = await request(server)
      .get('/api/v1/mobile/home')
      .set(as('student'))
      .set('Accept-Encoding', 'gzip')
      .expect(200);
    const home = res.body as Home;
    expect(home.serverTime).toMatch(/^\d{4}-/);
    expect(home.todayClasses.length).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(home.work.overdue)).toBe(true);
    expect(Array.isArray(home.work.dueSoon)).toBe(true);
    expect(Array.isArray(home.work.recentlyGraded)).toBe(true);
    expect(home.motivation).not.toBeNull();
    expect(home.children).toEqual([]);
    const teacher = (
      await request(server)
        .get('/api/v1/mobile/home')
        .set(as('teacher'))
        .expect(200)
    ).body as Home;
    expect(teacher.attendance).not.toBeNull();
    expect(teacher.motivation).toBeNull();
    const parent = (
      await request(server)
        .get('/api/v1/mobile/home')
        .set(as('parent'))
        .expect(200)
    ).body as Home;
    expect(parent.children.length).toBeGreaterThanOrEqual(1);
    // A big enough body comes back gzip-compressed for phones.
    const big = await request(server)
      .get('/api/v1/mobile/sync')
      .set(as('teacher'))
      .set('Accept-Encoding', 'gzip')
      .expect(200);
    expect(big.headers['content-encoding']).toBe('gzip');
  });

  it('syncs everything first, then only what changed since the cursor', async () => {
    const first = (
      await request(server)
        .get('/api/v1/mobile/sync')
        .set(as('student'))
        .expect(200)
    ).body as Sync;
    expect(first.since).toBeNull();
    expect(first.classes.some((c) => c.id === classId)).toBe(true);
    expect(first.assignments.length).toBeGreaterThanOrEqual(1);
    expect(new Date(first.next).getTime()).toBeLessThan(
      new Date(first.serverTime).getTime(),
    );
    const again = (
      await request(server)
        .get(`/api/v1/mobile/sync?since=${encodeURIComponent(first.next)}`)
        .set(as('student'))
        .expect(200)
    ).body as Sync;
    expect(again.since).toBe(new Date(first.next).toISOString());
    expect(again.assignments.length).toBeLessThanOrEqual(
      first.assignments.length,
    );
    const lists = await Promise.all([
      request(server)
        .get('/api/v1/mobile/classes')
        .set(as('student'))
        .expect(200),
      request(server)
        .get('/api/v1/mobile/assignments?pageSize=5')
        .set(as('student'))
        .expect(200),
      request(server)
        .get('/api/v1/mobile/grades')
        .set(as('student'))
        .expect(200),
      request(server)
        .get('/api/v1/mobile/attendance')
        .set(as('student'))
        .expect(200),
    ]);
    for (const l of lists)
      expect(Array.isArray((l.body as { data: unknown[] }).data)).toBe(true);
    expect(
      (lists[1].body as { data: unknown[] }).data.length,
    ).toBeLessThanOrEqual(5);
  });

  it('registers a device, pushes a simulated test, honours the push switch and removes the device', async () => {
    const bad = (
      await request(server)
        .post('/api/v1/me/devices')
        .set(as('student'))
        .send({ platform: 'android', token: 'short' })
        .expect(400)
    ).body as Problem;
    expect(bad.code).toBe('validation.failed');
    const created = (
      await request(server)
        .post('/api/v1/me/devices')
        .set(as('student'))
        .send({
          platform: 'android',
          token: TOKEN,
          name: 'Pixel',
          appVersion: '1.0.0',
          locale: 'es',
        })
        .expect(201)
    ).body as Device;
    deviceId = created.id;
    expect(created.active).toBe(true);
    // The same token again is a check-in, not a second device.
    const again = (
      await request(server)
        .post('/api/v1/me/devices')
        .set(as('student'))
        .send({ platform: 'android', token: TOKEN })
        .expect(201)
    ).body as Device;
    expect(again.id).toBe(deviceId);
    const list = (
      await request(server)
        .get('/api/v1/me/devices')
        .set(as('student'))
        .expect(200)
    ).body as { data: Device[]; configured: boolean };
    expect(list.data.length).toBe(1);
    expect(list.configured).toBe(false);
    const test = (
      await request(server)
        .post('/api/v1/me/devices/test')
        .set(as('student'))
        .expect(200)
    ).body as {
      configured: boolean;
      devices: number;
      simulated: number;
      sent: number;
    };
    expect(test).toMatchObject({
      configured: false,
      devices: 1,
      simulated: 1,
      sent: 0,
    });
    // A real notification reaches the device too (simulated), unless push is off for that category.
    const prefsBefore = (
      await request(server)
        .get('/api/v1/notifications/preferences')
        .set(as('student'))
        .expect(200)
    ).body as {
      data: Array<{
        category: string;
        inApp: boolean;
        email: boolean;
        push: boolean;
      }>;
    };
    expect(prefsBefore.data.every((p) => typeof p.push === 'boolean')).toBe(
      true,
    );
    const off = prefsBefore.data.map((p) =>
      p.category === 'announcement' ? { ...p, push: false } : p,
    );
    await request(server)
      .put('/api/v1/notifications/preferences')
      .set(as('student'))
      .send({ preferences: off })
      .expect(200);
    // Other suites notify this class too, so only this test's own announcements are counted, by title.
    const own = (title: string) =>
      prisma.pushLog.count({ where: { userId, title: { contains: title } } });
    await request(server)
      .post('/api/v1/announcements')
      .set(as('teacher'))
      .send({
        title: `Mobile push test ${stamp}`,
        content: 'Bring a charged phone.',
        classId,
        publish: true,
      })
      .expect(201);
    await new Promise((r) => setTimeout(r, 1500)); // long enough for the listener to have pushed if it were going to
    expect(await own(`Mobile push test ${stamp}`)).toBe(0);
    const on = prefsBefore.data.map((p) =>
      p.category === 'announcement' ? { ...p, push: true } : p,
    );
    await request(server)
      .put('/api/v1/notifications/preferences')
      .set(as('student'))
      .send({ preferences: on })
      .expect(200);
    await request(server)
      .post('/api/v1/announcements')
      .set(as('teacher'))
      .send({
        title: `Mobile push test two ${stamp}`,
        content: 'Charged phone, again.',
        classId,
        publish: true,
      })
      .expect(201);
    const until = Date.now() + 8000;
    let logs = 0;
    while (Date.now() < until) {
      logs = await own(`Mobile push test two ${stamp}`);
      if (logs > 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    expect(logs).toBe(1);
    const status = (
      await request(server)
        .get(`/api/v1/organizations/${orgId}/push/status`)
        .set(as('principal'))
        .expect(200)
    ).body as {
      configured: boolean;
      devices: number;
      last7Days: Record<string, number>;
    };
    expect(status.configured).toBe(false);
    expect(status.devices).toBeGreaterThanOrEqual(1);
    expect(status.last7Days.simulated).toBeGreaterThanOrEqual(2);
    await request(server)
      .get(`/api/v1/organizations/${orgId}/push/status`)
      .set(as('student'))
      .expect(403);
    await request(server)
      .delete(`/api/v1/me/devices/${deviceId}`)
      .set(as('teacher'))
      .expect(404);
    await request(server)
      .delete(`/api/v1/me/devices/${deviceId}`)
      .set(as('student'))
      .expect(204);
  });

  it('replays an offline tutor message by its client id instead of answering twice', async () => {
    const lesson = await prisma.lesson.findFirstOrThrow({
      where: {
        isPublished: true,
        module: {
          course: { classes: { some: { id: classId } } },
          isPublished: true,
        },
      },
    });
    const created = await request(server)
      .post('/api/v1/ai/tutor/conversations')
      .set(as('student'))
      .send({ mode: 'homework', lessonId: lesson.id })
      .expect(201);
    conversationId = (created.body as { id: string }).id;
    const clientMessageId = newId();
    const first = (
      await request(server)
        .post(`/api/v1/ai/tutor/conversations/${conversationId}/messages`)
        .set(as('student'))
        .send({ content: 'What is a coefficient?', clientMessageId })
        .expect(200)
    ).body as {
      userMessage: { id: string };
      assistantMessage: { id: string };
      replayed?: boolean;
    };
    expect(first.replayed).toBeUndefined();
    const second = (
      await request(server)
        .post(`/api/v1/ai/tutor/conversations/${conversationId}/messages`)
        .set(as('student'))
        .send({ content: 'What is a coefficient?', clientMessageId })
        .expect(200)
    ).body as {
      userMessage: { id: string };
      assistantMessage: { id: string };
      replayed?: boolean;
    };
    expect(second.replayed).toBe(true);
    expect(second.userMessage.id).toBe(first.userMessage.id);
    expect(second.assistantMessage.id).toBe(first.assistantMessage.id);
    expect(await prisma.aiMessage.count({ where: { conversationId } })).toBe(2);
    const since = (
      await request(server)
        .get(
          `/api/v1/ai/tutor/conversations/${conversationId}/messages?since=${encodeURIComponent(new Date(Date.now() - 60_000).toISOString())}`,
        )
        .set(as('student'))
        .expect(200)
    ).body as { data: unknown[]; serverTime: string };
    expect(since.data.length).toBe(2);
    const none = (
      await request(server)
        .get(
          `/api/v1/ai/tutor/conversations/${conversationId}/messages?since=${encodeURIComponent(since.serverTime)}`,
        )
        .set(as('student'))
        .expect(200)
    ).body as { data: unknown[] };
    expect(none.data.length).toBe(0);
    await request(server)
      .post(`/api/v1/ai/tutor/conversations/${conversationId}/messages`)
      .set(as('student'))
      .send({ content: 'x', clientMessageId: 'not-a-uuid' })
      .expect(400);
  });
});
