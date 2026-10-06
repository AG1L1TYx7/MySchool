import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import argon2 from 'argon2';
import request from 'supertest';
import { AI_STUB_PORT, AI_STUB_TOKEN } from './ai-env';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { newId } from '../src/common/utils/ids';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { startAiStub } from './ai-stub';

interface Problem {
  code: string;
  detail: string;
}
interface Accommodation {
  plan: string;
  extendedTimePercent: number;
  readAloud: boolean;
  largeText: boolean;
}
interface Behavior {
  id: string;
  kind: string;
  title: string;
  visibleToFamily: boolean;
}
interface Alert {
  id: string;
  status: string;
  student: { id: string } | null;
  categories: string[];
  excerpt: string;
}
interface Consent {
  under13: boolean;
  allowed: boolean;
  reason: string;
  status: string;
}

const PASSWORD = 'SmartSchool!Demo2026';

/** Accommodations applied in the product, counselor caseload and notes, wellness routing, behaviour and AI consent. */
describe('Support and safety (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  let orgId = '';
  let classId = '';
  let emmaId = '';
  let emmaBirth: Date | null = null;
  let assignmentId = '';
  let incidentId = '';
  let alertId = '';
  let supportUserId = '';
  let supportStudentId = '';

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
      ['teacher', 'student', 'parent', 'principal', 'counselor'].map((r) =>
        login(r),
      ),
    );
    const klass = await prisma.class.findFirstOrThrow({
      where: { name: 'English 7 - Section A', deletedAt: null },
    });
    classId = klass.id;
    orgId = klass.organizationId;
    const emma = await prisma.student.findFirstOrThrow({
      where: { studentNumber: 'S2026-000001' },
    });
    emmaId = emma.id;
    emmaBirth = emma.dateOfBirth;
    // The demo student is shared with the AI tutor suite: never delete their conversations here.
    await prisma.wellnessAlert.deleteMany({ where: { studentId: emmaId } });
    await prisma.aiConsent.deleteMany({ where: { studentId: emmaId } });
    await prisma.organization.update({
      where: { id: orgId },
      data: {
        behaviorVisibility: 'POSITIVE_ONLY',
        aiConsentDefault: 'SCHOOL',
        studentMessaging: false,
      },
    });
    // A student of our own for the tutor escalation, so the AI spec's quota tests cannot interfere.
    const passwordHash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    const supportUser = await prisma.user.create({
      data: {
        id: newId(),
        email: `support-student-${stamp}@smartschool.local`,
        passwordHash,
        passwordChangedAt: new Date(),
        firstName: 'Sky',
        lastName: 'Support',
        role: 'STUDENT',
        organizationId: orgId,
        emailVerifiedAt: new Date(),
      },
    });
    supportUserId = supportUser.id;
    const supportStudent = await prisma.student.create({
      data: {
        id: newId(),
        organizationId: orgId,
        userId: supportUser.id,
        studentNumber: `E2E-S-${stamp}`,
        firstName: 'Sky',
        lastName: 'Support',
        dateOfBirth: new Date('2010-01-01T00:00:00Z'),
      },
    });
    supportStudentId = supportStudent.id;
    await login('supportStudent', supportUser.email);
  });

  afterAll(async () => {
    if (assignmentId)
      await prisma.assignment.deleteMany({ where: { id: assignmentId } });
    await prisma.behaviorRecord.deleteMany({
      where: { studentId: emmaId, title: { startsWith: 'E2E' } },
    });
    await prisma.counselorNote.deleteMany({
      where: { studentId: emmaId, body: { startsWith: 'E2E' } },
    });
    await prisma.aiConsent.deleteMany({ where: { studentId: emmaId } });
    await prisma.student.update({
      where: { id: emmaId },
      data: { dateOfBirth: emmaBirth },
    });
    // Restore the seeded plan so the demo keeps its example.
    await prisma.accommodation.upsert({
      where: { studentId: emmaId },
      update: { extendedTimePercent: 50, readAloud: true, largeText: false },
      create: {
        id: newId(),
        organizationId: orgId,
        studentId: emmaId,
        plan: 'IEP',
        extendedTimePercent: 50,
        readAloud: true,
      },
    });
    if (supportStudentId) {
      await prisma.wellnessAlert.deleteMany({
        where: { studentId: supportStudentId },
      });
      await prisma.aiConversation.deleteMany({
        where: { userId: supportUserId },
      });
      await prisma.student.deleteMany({ where: { id: supportStudentId } });
      await prisma.user.deleteMany({ where: { id: supportUserId } });
    }
    await app.close();
    stub.server.close();
  });

  it('signs the counselor in with records access but no teaching features', async () => {
    const me = await request(server)
      .get('/api/v1/auth/me')
      .set(as('counselor'))
      .expect(200);
    const features = me.body as { role: string; features: string[] };
    expect(features.role).toBe('counselor');
    expect(features.features).toEqual(
      expect.arrayContaining([
        'students.view',
        'grades.view.all',
        'wellness.alerts',
        'support.notes',
        'support.counselor',
      ]),
    );
    expect(features.features).not.toContain('assignments.create');
    await request(server)
      .get('/api/v1/students')
      .set(as('counselor'))
      .expect(200);
    await request(server)
      .post('/api/v1/assignments')
      .set(as('counselor'))
      .send({ classId, title: 'no' })
      .expect(403);
  });

  it("records a support plan that only the student's teachers, counselors, admins and family can see", async () => {
    const saved = await request(server)
      .put(`/api/v1/students/${emmaId}/accommodations`)
      .set(as('teacher'))
      .send({
        plan: 'iep',
        extendedTimePercent: 100,
        readAloud: true,
        largeText: true,
        notes: 'E2E plan',
      })
      .expect(200);
    expect((saved.body as Accommodation).extendedTimePercent).toBe(100);
    const parent = await request(server)
      .get(`/api/v1/students/${emmaId}/accommodations`)
      .set(as('parent'))
      .expect(200);
    expect((parent.body as Accommodation).plan).toBe('iep');
    await request(server)
      .get(`/api/v1/students/${emmaId}/accommodations`)
      .set(as('counselor'))
      .expect(200);
    await request(server)
      .put(`/api/v1/students/${emmaId}/accommodations`)
      .set(as('student'))
      .send({ plan: 'other' })
      .expect(403);
    const mine = await request(server)
      .get('/api/v1/me/accommodations')
      .set(as('student'))
      .expect(200);
    expect(mine.body).toMatchObject({
      extendedTimePercent: 100,
      readAloud: true,
      largeText: true,
      reducedMotion: false,
    });
    const staffMine = await request(server)
      .get('/api/v1/me/accommodations')
      .set(as('teacher'))
      .expect(200);
    expect((staffMine.body as Accommodation).extendedTimePercent).toBe(0);
  });

  it('applies extended time to a due date when the student submits', async () => {
    const now = Date.now();
    const created = await request(server)
      .post('/api/v1/assignments')
      .set(as('teacher'))
      .send({
        classId,
        title: `E2E extended time ${stamp}`,
        maxPoints: 10,
        availableFrom: new Date(now - 20 * 60_000).toISOString(),
        dueAt: new Date(now - 60_000).toISOString(),
      })
      .expect(201);
    assignmentId = (created.body as { id: string }).id;
    await request(server)
      .post(`/api/v1/assignments/${assignmentId}/publish`)
      .set(as('teacher'))
      .expect(200);
    // Due a minute ago: late for everyone, except that Emma's 100% extension moves her due date 19 minutes later.
    const sub = await request(server)
      .post(`/api/v1/assignments/${assignmentId}/submissions`)
      .set(as('student'))
      .send({ textContent: 'Submitted with extended time.' })
      .expect(201);
    expect((sub.body as { isLate: boolean }).isLate).toBe(false);
    await request(server)
      .delete(`/api/v1/students/${emmaId}/accommodations`)
      .set(as('teacher'))
      .expect(204);
    const withoutPlan = await request(server)
      .post(`/api/v1/assignments/${assignmentId}/submissions`)
      .set(as('student'))
      .send({ textContent: 'Second try without the plan.' })
      .expect(201);
    // Late work is still accepted here (no late cut-off), so the plan is what made the first one on time.
    expect((withoutPlan.body as { isLate: boolean }).isLate).toBe(true);
  });

  it('keeps counselor notes private and the caseload with the counselor', async () => {
    const note = await request(server)
      .post(`/api/v1/students/${emmaId}/counselor-notes`)
      .set(as('counselor'))
      .send({ body: `E2E note ${stamp}` })
      .expect(201);
    const noteId = (note.body as { id: string }).id;
    const list = await request(server)
      .get(`/api/v1/students/${emmaId}/counselor-notes`)
      .set(as('counselor'))
      .expect(200);
    expect(
      (
        list.body as { data: Array<{ id: string; canEdit: boolean }> }
      ).data.some((n) => n.id === noteId && n.canEdit),
    ).toBe(true);
    await request(server)
      .get(`/api/v1/students/${emmaId}/counselor-notes`)
      .set(as('teacher'))
      .expect(403);
    await request(server)
      .get(`/api/v1/students/${emmaId}/counselor-notes`)
      .set(as('principal'))
      .expect(403);
    await request(server)
      .get(`/api/v1/students/${emmaId}/counselor-notes`)
      .set(as('parent'))
      .expect(403);
    await request(server)
      .delete(`/api/v1/counselor-notes/${noteId}`)
      .set(as('counselor'))
      .expect(204);
    const caseload = await request(server)
      .get('/api/v1/counselor/caseload')
      .set(as('counselor'))
      .expect(200);
    expect(
      (caseload.body as { data: Array<{ student: { id: string } }> }).data.some(
        (c) => c.student.id === emmaId,
      ),
    ).toBe(true);
    await request(server)
      .get('/api/v1/counselor/caseload')
      .set(as('teacher'))
      .expect(403);
  });

  it('shows families only what the behaviour rule allows, and the principal can change the rule', async () => {
    const incident = await request(server)
      .post(`/api/v1/students/${emmaId}/behavior`)
      .set(as('teacher'))
      .send({
        kind: 'incident',
        title: `E2E incident ${stamp}`,
        occurredAt: new Date().toISOString(),
        actionTaken: 'Spoke with the student.',
      })
      .expect(201);
    incidentId = (incident.body as Behavior).id;
    expect((incident.body as Behavior).visibleToFamily).toBe(false);
    await request(server)
      .post(`/api/v1/students/${emmaId}/behavior`)
      .set(as('counselor'))
      .send({
        kind: 'positive',
        title: `E2E kindness ${stamp}`,
        occurredAt: new Date().toISOString(),
      })
      .expect(201);
    const parentView = (
      await request(server)
        .get(`/api/v1/students/${emmaId}/behavior`)
        .set(as('parent'))
        .expect(200)
    ).body as { data: Behavior[] };
    expect(
      parentView.data.some((r) => r.title === `E2E kindness ${stamp}`),
    ).toBe(true);
    expect(parentView.data.some((r) => r.id === incidentId)).toBe(false);
    await request(server)
      .post(`/api/v1/students/${emmaId}/behavior`)
      .set(as('parent'))
      .send({
        kind: 'positive',
        title: 'no',
        occurredAt: new Date().toISOString(),
      })
      .expect(403);
    const settings = await request(server)
      .put(`/api/v1/organizations/${orgId}/support/settings`)
      .set(as('principal'))
      .send({ behaviorVisibility: 'ALL' })
      .expect(200);
    expect(
      (settings.body as { behaviorVisibility: string }).behaviorVisibility,
    ).toBe('ALL');
    const parentAll = (
      await request(server)
        .get(`/api/v1/students/${emmaId}/behavior`)
        .set(as('parent'))
        .expect(200)
    ).body as { data: Behavior[] };
    expect(parentAll.data.some((r) => r.id === incidentId)).toBe(true);
    await request(server)
      .put(`/api/v1/organizations/${orgId}/support/settings`)
      .set(as('principal'))
      .send({ behaviorVisibility: 'POSITIVE_ONLY' })
      .expect(200);
    await request(server)
      .put(`/api/v1/organizations/${orgId}/support/settings`)
      .set(as('teacher'))
      .send({ behaviorVisibility: 'ALL' })
      .expect(403);
  });

  it('routes a tutor escalation to the wellness queue for counselors to work', async () => {
    const conv = await request(server)
      .post('/api/v1/ai/tutor/conversations')
      .set(as('supportStudent'))
      .send({ mode: 'explain' })
      .expect(201);
    const conversationId = (conv.body as { id: string }).id;
    const reply = await request(server)
      .post(`/api/v1/ai/tutor/conversations/${conversationId}/messages`)
      .set(as('supportStudent'))
      .send({ content: 'i want to die' })
      .expect(200);
    expect(
      (reply.body as { assistantMessage: { status: string } }).assistantMessage
        .status,
    ).toBe('refused');
    const queue = (
      await request(server)
        .get('/api/v1/wellness/alerts')
        .query({ status: 'open' })
        .set(as('counselor'))
        .expect(200)
    ).body as { data: Alert[] };
    const alert = queue.data.find((a) => a.student?.id === supportStudentId);
    expect(alert).toBeDefined();
    alertId = alert?.id ?? '';
    expect(alert?.categories).toContain('self_harm');
    expect(alert?.excerpt).toContain('i want to die');
    await request(server)
      .get('/api/v1/wellness/alerts')
      .set(as('teacher'))
      .expect(403);
    await request(server)
      .get('/api/v1/wellness/alerts')
      .set(as('principal'))
      .expect(200);
    const taken = await request(server)
      .patch(`/api/v1/wellness/alerts/${alertId}`)
      .set(as('counselor'))
      .send({ status: 'acknowledged' })
      .expect(200);
    expect((taken.body as Alert).status).toBe('acknowledged');
    const done = await request(server)
      .patch(`/api/v1/wellness/alerts/${alertId}`)
      .set(as('counselor'))
      .send({
        status: 'resolved',
        resolution: 'Met the student the same morning; parents called.',
      })
      .expect(200);
    expect((done.body as Alert).status).toBe('resolved');
    const notified = await prisma.notification.count({
      where: {
        entityId: alertId,
        recipient: { email: 'counselor@smartschool.local' },
      },
    });
    expect(notified).toBe(1);
  });

  it('needs a parent decision for AI features when the student is under 13 and the parent opts out', async () => {
    const before = (
      await request(server)
        .get(`/api/v1/students/${emmaId}/ai-consent`)
        .set(as('parent'))
        .expect(200)
    ).body as Consent;
    expect(before.under13).toBe(false);
    expect(before.allowed).toBe(true);
    await prisma.student.update({
      where: { id: emmaId },
      data: { dateOfBirth: new Date('2016-05-01T00:00:00Z') },
    });
    const young = (
      await request(server)
        .get(`/api/v1/students/${emmaId}/ai-consent`)
        .set(as('parent'))
        .expect(200)
    ).body as Consent;
    expect(young).toMatchObject({
      under13: true,
      allowed: true,
      reason: 'school_default',
    });
    await request(server)
      .put(`/api/v1/students/${emmaId}/ai-consent`)
      .set(as('teacher'))
      .send({ status: 'declined' })
      .expect(403);
    const declined = (
      await request(server)
        .put(`/api/v1/students/${emmaId}/ai-consent`)
        .set(as('parent'))
        .send({ status: 'declined', note: 'Not yet.' })
        .expect(200)
    ).body as Consent;
    expect(declined).toMatchObject({
      allowed: false,
      reason: 'parent_declined',
      status: 'declined',
    });
    const blocked = await request(server)
      .post('/api/v1/ai/tutor/conversations')
      .set(as('student'))
      .send({ mode: 'explain' })
      .expect(403);
    expect((blocked.body as Problem).code).toBe('ai.consent_required');
    await request(server)
      .put(`/api/v1/students/${emmaId}/ai-consent`)
      .set(as('parent'))
      .send({ status: 'granted' })
      .expect(200);
    await request(server)
      .post('/api/v1/ai/tutor/conversations')
      .set(as('student'))
      .send({ mode: 'explain' })
      .expect(201);
  });
});
