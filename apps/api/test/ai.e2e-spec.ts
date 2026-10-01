import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AI_STUB_PORT, AI_STUB_TOKEN } from './ai-env';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { startAiStub } from './ai-stub';

const PASSWORD = 'SmartSchool!Demo2026';

interface Problem {
  code: string;
  detail: string;
}
interface MessageBody {
  id: string;
  role: string;
  content: string;
  status: string;
  citations: Array<{ blockId: string }>;
  safety: { input: string } | null;
}

/** Tutor conversations against the seeded database with a stub AI service (the real one is covered by apps/ai tests). */
describe('AI tutor (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  let conversationId = '';
  let organizationId = '';
  let assistantId = '';

  const login = async (role: string) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `${role}@smartschool.local`, password: PASSWORD })
      .expect(200);
    const body = res.body as {
      accessToken: string;
      user: { organizationId: string | null };
    };
    tokens[role] = body.accessToken;
    if (role === 'student') organizationId = body.user.organizationId ?? '';
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
    // The daily quota counts stored messages, so clear the demo student's history from earlier runs.
    await app.get(PrismaService).aiConversation.deleteMany({
      where: { user: { email: 'student@smartschool.local' } },
    });
    await Promise.all(['student', 'teacher', 'superintendent'].map(login));
  });

  afterAll(async () => {
    await app.close();
    stub.server.close();
  });

  it('reports availability from the AI service health', async () => {
    const res = await request(server)
      .get('/api/v1/ai/tutor/status')
      .set(as('student'))
      .expect(200);
    expect((res.body as { available: boolean }).available).toBe(true);
  });

  it('starts a conversation on a lesson and gets a cited answer with the student context attached', async () => {
    const lessons = await request(server)
      .get('/api/v1/courses?pageSize=5')
      .set(as('student'))
      .expect(200);
    const courseId = (lessons.body as { data: Array<{ id: string }> }).data[0]
      .id;
    const detail = await request(server)
      .get(`/api/v1/courses/${courseId}`)
      .set(as('student'))
      .expect(200);
    const lessonId = (
      detail.body as { modules: Array<{ lessons: Array<{ id: string }> }> }
    ).modules[0].lessons[0].id;
    const created = await request(server)
      .post('/api/v1/ai/tutor/conversations')
      .set(as('student'))
      .send({ mode: 'homework', lessonId })
      .expect(201);
    conversationId = (created.body as { id: string; mode: string }).id;
    expect((created.body as { mode: string }).mode).toBe('homework');

    const reply = await request(server)
      .post(`/api/v1/ai/tutor/conversations/${conversationId}/messages`)
      .set(as('student'))
      .send({ content: 'How do I start?' })
      .expect(200);
    const body = reply.body as {
      userMessage: MessageBody;
      assistantMessage: MessageBody;
    };
    expect(body.assistantMessage.status).toBe('ok');
    expect(body.assistantMessage.citations[0].blockId).toBe('C1');
    assistantId = body.assistantMessage.id;
    const envelope = stub.calls[stub.calls.length - 1] as {
      capability: string;
      actor: { ageBand: string; role: string };
      context: {
        blocks: Array<{ id: string; label: string }>;
        lessonId: string;
      };
    };
    expect(envelope.capability).toBe('tutor.homework_help');
    expect(envelope.actor.role).toBe('student');
    expect(envelope.actor.ageBand).toBe('11-13');
    expect(envelope.context.lessonId).toBe(lessonId);
    expect(envelope.context.blocks[0].label).toMatch(/^Lesson: /);
  });

  it('streams tokens then the stored assistant message', async () => {
    const res = await request(server)
      .post(`/api/v1/ai/tutor/conversations/${conversationId}/messages`)
      .set(as('student'))
      .send({ content: 'And then?', stream: true })
      .expect(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.text).toContain('event: token');
    expect(res.text).toContain('event: assistant');
    const assistant = JSON.parse(
      res.text.split('event: assistant\ndata: ')[1].split('\n\n')[0],
    ) as MessageBody;
    expect(assistant.content).toContain('Stub answer');
  });

  it('records a refusal with its safety label and audits the escalation', async () => {
    const reply = await request(server)
      .post(`/api/v1/ai/tutor/conversations/${conversationId}/messages`)
      .set(as('student'))
      .send({ content: 'i want to die' })
      .expect(200);
    const body = reply.body as { assistantMessage: MessageBody };
    expect(body.assistantMessage.status).toBe('refused');
    expect(body.assistantMessage.safety?.input).toBe('escalate');
    const audit = await request(server)
      .get('/api/v1/audit-logs?action=ai.safety.escalated&pageSize=5')
      .set(as('superintendent'))
      .expect(200);
    expect(
      (audit.body as { data: unknown[] }).data.length,
    ).toBeGreaterThanOrEqual(1);
  });

  it('enforces the daily quota, keeps conversations private, and accepts feedback', async () => {
    await request(server)
      .post(`/api/v1/ai/tutor/conversations/${conversationId}/messages`)
      .set(as('student'))
      .send({ content: 'fourth' })
      .expect(200);
    const over = await request(server)
      .post(`/api/v1/ai/tutor/conversations/${conversationId}/messages`)
      .set(as('student'))
      .send({ content: 'fifth' })
      .expect(403);
    expect((over.body as Problem).code).toBe('ai.quota_exceeded');
    await request(server)
      .get(`/api/v1/ai/tutor/conversations/${conversationId}`)
      .set(as('teacher'))
      .expect(404);
    await request(server)
      .post(`/api/v1/ai/tutor/messages/${assistantId}/feedback`)
      .set(as('student'))
      .send({ rating: 1 })
      .expect(204);
    const conv = await request(server)
      .get(`/api/v1/ai/tutor/conversations/${conversationId}`)
      .set(as('student'))
      .expect(200);
    expect(
      (conv.body as { messages: MessageBody[] }).messages.length,
    ).toBeGreaterThanOrEqual(6);
  });

  it('exposes the internal tool API only to the service token', async () => {
    await request(server)
      .get(
        '/api/v1/internal/ai/courses/01900000-0000-7000-8000-000000000000/outline',
      )
      .expect(401);
    const lessons = await request(server)
      .get('/api/v1/courses?pageSize=1')
      .set(as('student'))
      .expect(200);
    const courseId = (lessons.body as { data: Array<{ id: string }> }).data[0]
      .id;
    const outline = await request(server)
      .get(`/api/v1/internal/ai/courses/${courseId}/outline`)
      .set('x-service-token', process.env.AI_CALLBACK_TOKEN ?? '')
      .expect(200);
    expect(
      (outline.body as { modules: unknown[] }).modules.length,
    ).toBeGreaterThan(0);
  });

  it('re-indexes published lessons through the AI service', async () => {
    await request(server)
      .post('/api/v1/ai/rag/reindex')
      .set(as('teacher'))
      .send({})
      .expect(403);
    const res = await request(server)
      .post('/api/v1/ai/rag/reindex')
      .set(as('superintendent'))
      .send({ organizationId })
      .expect(200);
    const out = res.body as { documents: number; chunks: number };
    expect(out.documents).toBeGreaterThan(0);
    expect(out.chunks).toBe(out.documents * 2);
    const indexed = stub.calls[stub.calls.length - 1] as {
      documents: Array<{ docId: string; organizationId: string }>;
    };
    expect(indexed.documents[0].docId).toMatch(/^lesson:/);
    expect(indexed.documents[0].organizationId).toBe(organizationId);
  });
});
