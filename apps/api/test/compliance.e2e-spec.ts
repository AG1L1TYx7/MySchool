import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { unzipSync, strFromU8 } from 'fflate';
import type { Server } from 'node:http';
import argon2 from 'argon2';
import request from 'supertest';
import { AI_STUB_PORT, AI_STUB_TOKEN } from './ai-env';
import { AppModule } from '../src/app.module';
import { newId } from '../src/common/utils/ids';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { startAiStub } from './ai-stub';

interface Problem {
  code: string;
}
interface DeletionRequest {
  id: string;
  status: string;
  scheduledFor: string | null;
  summary: unknown;
}
interface Incident {
  id: string;
  status: string;
  severity: string;
  notifiedAt: string | null;
  timeline: Array<{ note: string }>;
  deadlines: { districtBy: string; notifyBy: string };
}

const PASSWORD = 'SmartSchool!Demo2026';
/** supertest does not buffer application/zip on its own. */
interface Chunked {
  on(event: 'data' | 'end', fn: (chunk: Buffer) => void): unknown;
}
const binary = (
  res: Chunked,
  cb: (err: Error | null, body: Buffer) => void,
) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

/** Compliance (slice 19): data map, retention, deletion requests with a grace period, FERPA records export, incidents. */
describe('Compliance (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  let orgId = '';
  let studentId = '';
  let userId = '';
  let parentId = '';
  let parentUserId = '';
  let requestId = '';
  let incidentId = '';

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
      ['teacher', 'parent', 'principal', 'counselor', 'superadmin'].map((r) =>
        login(r),
      ),
    );
    const klass = await prisma.class.findFirstOrThrow({
      where: { name: 'English 7 - Section A', deletedAt: null },
    });
    orgId = klass.organizationId;
    const passwordHash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    // A student and a guardian of our own, so the erasure touches nobody else's data.
    const user = await prisma.user.create({
      data: {
        id: newId(),
        email: `erase-student-${stamp}@smartschool.local`,
        passwordHash,
        passwordChangedAt: new Date(),
        firstName: 'Eli',
        lastName: 'Erase',
        role: 'STUDENT',
        organizationId: orgId,
        emailVerifiedAt: new Date(),
      },
    });
    userId = user.id;
    const student = await prisma.student.create({
      data: {
        id: newId(),
        organizationId: orgId,
        userId: user.id,
        studentNumber: `E2E-ERASE-${stamp}`,
        firstName: 'Eli',
        lastName: 'Erase',
        gradeLevel: '7',
        enrollmentStatus: 'ACTIVE',
      },
    });
    studentId = student.id;
    const parent = await prisma.user.create({
      data: {
        id: newId(),
        email: `erase-parent-${stamp}@smartschool.local`,
        passwordHash,
        passwordChangedAt: new Date(),
        firstName: 'Pat',
        lastName: 'Erase',
        role: 'PARENT',
        organizationId: orgId,
        emailVerifiedAt: new Date(),
      },
    });
    parentUserId = parent.id;
    await prisma.studentGuardian.create({
      data: {
        id: newId(),
        studentId,
        guardianUserId: parent.id,
        relationship: 'GUARDIAN',
      },
    });
    parentId = parent.id;
    await login('parent2', parent.email);
    await login('student2', user.email);
    // Something to export: one AI conversation.
    await prisma.aiConversation.create({
      data: {
        id: newId(),
        organizationId: orgId,
        userId: user.id,
        capability: 'tutor.chat',
        title: `Erase me ${stamp}`,
        messages: { create: [{ id: newId(), role: 'USER', content: 'hello' }] },
      },
    });
  });

  afterAll(async () => {
    await prisma.securityIncident.deleteMany({
      where: { title: { contains: `${stamp}` } },
    });
    await prisma.deletionRequest.deleteMany({
      where: { studentNumber: `E2E-ERASE-${stamp}` },
    });
    await prisma.student.deleteMany({ where: { id: studentId } });
    await prisma.user.deleteMany({
      where: { id: { in: [userId, parentUserId] } },
    });
    await app.close();
    stub.server.close();
  });

  it('publishes the data map with live counts and the retention policy, to administrators only', async () => {
    const res = await request(server)
      .get(`/api/v1/organizations/${orgId}/compliance/data-map`)
      .set(as('principal'))
      .expect(200);
    const map = res.body as {
      entries: Array<{
        table: string;
        rows: number;
        subject: string;
        retentionDays: number | null;
      }>;
      retention: Record<string, number>;
    };
    expect(map.entries.length).toBeGreaterThan(15);
    const students = map.entries.find((e) => e.table === 'Students');
    expect(students?.rows).toBeGreaterThan(0);
    expect(students?.subject).toBe('student');
    expect(
      map.entries.find((e) => e.table === 'AiConversations')?.retentionDays,
    ).toBe(365);
    expect(map.retention.auditLogs).toBe(1095);
    await request(server)
      .get(`/api/v1/organizations/${orgId}/compliance/data-map`)
      .set(as('teacher'))
      .expect(403);
    await request(server)
      .get(`/api/v1/organizations/${orgId}/compliance/data-map`)
      .set(as('counselor'))
      .expect(403);
  });

  it('lets administrators set retention within bounds and apply it now', async () => {
    const set = (
      await request(server)
        .put(`/api/v1/organizations/${orgId}/compliance/retention`)
        .set(as('principal'))
        .send({ aiConversations: 30, notifications: 10 })
        .expect(200)
    ).body as { retention: Record<string, number> };
    expect(set.retention.aiConversations).toBe(30);
    expect(set.retention.notifications).toBe(30); // clamped to the minimum
    // An old conversation of our student goes; a fresh one stays.
    await prisma.aiConversation.create({
      data: {
        id: newId(),
        organizationId: orgId,
        userId,
        capability: 'tutor.chat',
        title: `Old ${stamp}`,
        createdAt: new Date('2025-01-01T00:00:00Z'),
        updatedAt: new Date('2025-01-01T00:00:00Z'),
      },
    });
    const run = (
      await request(server)
        .post(`/api/v1/organizations/${orgId}/compliance/retention/run`)
        .set(as('principal'))
        .expect(200)
    ).body as { removed: Record<string, number> };
    expect(run.removed.aiConversations).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.aiConversation.count({
        where: { userId, title: { startsWith: 'Old' } },
      }),
    ).toBe(0);
    expect(
      await prisma.aiConversation.count({
        where: { userId, title: { startsWith: 'Erase me' } },
      }),
    ).toBe(1);
    await request(server)
      .put(`/api/v1/organizations/${orgId}/compliance/retention`)
      .set(as('principal'))
      .send({ aiConversations: 365 })
      .expect(200);
    await request(server)
      .put(`/api/v1/organizations/${orgId}/compliance/retention`)
      .set(as('teacher'))
      .send({ aiConversations: 30 })
      .expect(403);
  });

  it('exports the education records as a zip for the family and administrators, never for other families', async () => {
    const res = await request(server)
      .get(`/api/v1/students/${studentId}/records-export.zip`)
      .set(as('parent2'))
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(res.headers['content-type']).toContain('application/zip');
    const files = unzipSync(new Uint8Array(res.body as Buffer));
    expect(Object.keys(files).sort()).toEqual(
      expect.arrayContaining([
        'manifest.json',
        'profile.json',
        'attendance.json',
        'ai-conversations.json',
        'README.txt',
      ]),
    );
    const profile = JSON.parse(strFromU8(files['profile.json'])) as {
      studentNumber: string;
    };
    expect(profile.studentNumber).toBe(`E2E-ERASE-${stamp}`);
    const attendance = JSON.parse(
      strFromU8(files['attendance.json']),
    ) as unknown[];
    expect(Array.isArray(attendance)).toBe(true);
    const conversations = JSON.parse(
      strFromU8(files['ai-conversations.json']),
    ) as Array<{ messages: unknown[] }>;
    expect(conversations[0].messages.length).toBe(1);
    expect(Object.keys(files).some((f) => /counselor/i.test(f))).toBe(false);
    await request(server)
      .get(`/api/v1/students/${studentId}/records-export.zip`)
      .set(as('student2'))
      .expect(200);
    await request(server)
      .get(`/api/v1/students/${studentId}/records-export.zip`)
      .set(as('principal'))
      .expect(200);
    await request(server)
      .get(`/api/v1/students/${studentId}/records-export.zip`)
      .set(as('counselor'))
      .expect(200);
    await request(server)
      .get(`/api/v1/students/${studentId}/records-export.zip`)
      .set(as('teacher'))
      .expect(403);
    await request(server)
      .get(`/api/v1/students/${studentId}/records-export.zip`)
      .set(as('parent'))
      .expect(403);
    expect(
      await prisma.auditLog.count({
        where: { action: 'compliance.records.export', entityId: studentId },
      }),
    ).toBeGreaterThanOrEqual(4);
  });

  it('takes a deletion request from the family, approves it with a grace period, respects a legal hold, then erases everything', async () => {
    await request(server)
      .post(`/api/v1/students/${studentId}/deletion-requests`)
      .set(as('parent'))
      .send({ reason: 'not my child' })
      .expect(403);
    const created = (
      await request(server)
        .post(`/api/v1/students/${studentId}/deletion-requests`)
        .set(as('parent2'))
        .send({ reason: 'We are moving abroad.' })
        .expect(201)
    ).body as DeletionRequest;
    requestId = created.id;
    expect(created.status).toBe('pending');
    const dup = (
      await request(server)
        .post(`/api/v1/students/${studentId}/deletion-requests`)
        .set(as('parent2'))
        .send({})
        .expect(400)
    ).body as Problem;
    expect(dup.code).toBe('compliance.request_exists');
    const mine = (
      await request(server)
        .get(`/api/v1/students/${studentId}/deletion-requests`)
        .set(as('parent2'))
        .expect(200)
    ).body as {
      data: DeletionRequest[];
      plan: { graceDays: number; removes: unknown[] };
    };
    expect(mine.data[0].id).toBe(requestId);
    expect(mine.plan.graceDays).toBe(30);
    const list = (
      await request(server)
        .get(`/api/v1/organizations/${orgId}/compliance/deletion-requests`)
        .set(as('principal'))
        .expect(200)
    ).body as { data: DeletionRequest[] };
    expect(list.data.some((r) => r.id === requestId)).toBe(true);
    await request(server)
      .post(`/api/v1/deletion-requests/${requestId}/execute`)
      .set(as('principal'))
      .expect(400);
    const approved = (
      await request(server)
        .post(`/api/v1/deletion-requests/${requestId}/decide`)
        .set(as('principal'))
        .send({ decision: 'approve' })
        .expect(200)
    ).body as DeletionRequest;
    expect(approved.status).toBe('approved');
    expect(new Date(approved.scheduledFor!).getTime()).toBeGreaterThan(
      Date.now() + 29 * 86_400_000,
    );
    await request(server)
      .put(`/api/v1/students/${studentId}/legal-hold`)
      .set(as('principal'))
      .send({ legalHold: true })
      .expect(200);
    const held = (
      await request(server)
        .post(`/api/v1/deletion-requests/${requestId}/execute`)
        .set(as('principal'))
        .expect(403)
    ).body as Problem;
    expect(held.code).toBe('compliance.legal_hold');
    await request(server)
      .put(`/api/v1/students/${studentId}/legal-hold`)
      .set(as('principal'))
      .send({ legalHold: false })
      .expect(200);
    await request(server)
      .post(`/api/v1/deletion-requests/${requestId}/execute`)
      .set(as('teacher'))
      .expect(403);
    const done = (
      await request(server)
        .post(`/api/v1/deletion-requests/${requestId}/execute`)
        .set(as('principal'))
        .expect(200)
    ).body as DeletionRequest;
    expect(done.status).toBe('completed');
    expect((done.summary as { ai: number; profile: number }).ai).toBe(1);
    expect((done.summary as { ai: number; profile: number }).profile).toBe(1);
    expect(await prisma.student.count({ where: { id: studentId } })).toBe(0);
    expect(await prisma.user.count({ where: { id: userId } })).toBe(0);
    expect(await prisma.attendance.count({ where: { studentId } })).toBe(0);
    expect(await prisma.aiConversation.count({ where: { userId } })).toBe(0);
    // The guardian keeps their own account; the request keeps the name for the record.
    expect(await prisma.user.count({ where: { id: parentId } })).toBe(1);
    const after = (
      await request(server)
        .get(`/api/v1/organizations/${orgId}/compliance/deletion-requests`)
        .set(as('principal'))
        .expect(200)
    ).body as {
      data: Array<{
        id: string;
        studentId: string | null;
        studentName: string;
      }>;
    };
    const row = after.data.find((r) => r.id === requestId);
    expect(row?.studentId).toBeNull();
    expect(row?.studentName).toBe('Eli Erase');
  });

  it('tracks a security incident on the breach clock and notifies administrators', async () => {
    const created = (
      await request(server)
        .post('/api/v1/compliance/incidents')
        .set(as('principal'))
        .send({
          title: `Lost laptop ${stamp}`,
          severity: 'high',
          summary: 'A staff laptop with a cached roster was lost.',
          affectedCount: 120,
          dataCategories: 'names, student numbers',
          detectedAt: '2026-10-07T09:00:00Z',
        })
        .expect(201)
    ).body as Incident;
    incidentId = created.id;
    expect(created.status).toBe('open');
    expect(created.deadlines.districtBy).toBe('2026-10-08T09:00:00.000Z');
    expect(created.deadlines.notifyBy).toBe('2026-10-10T09:00:00.000Z');
    const contained = (
      await request(server)
        .patch(`/api/v1/compliance/incidents/${incidentId}`)
        .set(as('principal'))
        .send({ status: 'contained', note: 'Laptop remotely wiped.' })
        .expect(200)
    ).body as Incident;
    expect(contained.status).toBe('contained');
    expect(contained.timeline.some((t) => /wiped/.test(t.note))).toBe(true);
    const back = (
      await request(server)
        .patch(`/api/v1/compliance/incidents/${incidentId}`)
        .set(as('principal'))
        .send({ status: 'open' })
        .expect(400)
    ).body as Problem;
    expect(back.code).toBe('compliance.incident_status');
    const notified = (
      await request(server)
        .post(`/api/v1/compliance/incidents/${incidentId}/notify`)
        .set(as('principal'))
        .expect(200)
    ).body as Incident & { notified: number };
    expect(notified.status).toBe('notified');
    expect(notified.notifiedAt).not.toBeNull();
    expect(notified.notified).toBeGreaterThanOrEqual(1);
    const list = (
      await request(server)
        .get('/api/v1/compliance/incidents')
        .set(as('superadmin'))
        .expect(200)
    ).body as { data: Incident[] };
    expect(list.data.some((i) => i.id === incidentId)).toBe(true);
    await request(server)
      .get('/api/v1/compliance/incidents')
      .set(as('teacher'))
      .expect(403);
    await request(server)
      .post('/api/v1/compliance/incidents')
      .set(as('counselor'))
      .send({ title: 'x', severity: 'low', summary: 'y' })
      .expect(403);
    await request(server)
      .patch(`/api/v1/compliance/incidents/${incidentId}`)
      .set(as('principal'))
      .send({ status: 'closed' })
      .expect(200);
  });
});
