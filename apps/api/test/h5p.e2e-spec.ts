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
const stamp = Date.now();

interface Problem {
  code: string;
  detail: string;
}
interface JobBody {
  id: string;
  status: string;
  contentId: string | null;
  error: Problem | null;
  content?: {
    id: string;
    title: string;
    status: string;
    maxScore: number;
    library: string;
    validation?: { valid: boolean };
  } | null;
}

/** Slice 6: generate a quiz, review and publish it, attach it to an assignment, play it, and see the grade post. */
describe('AI content and H5P (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  let classId = '';
  let contentId = '';
  let assignmentId = '';
  let ticketPath = '';

  const login = async (role: string) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `${role}@smartschool.local`, password: PASSWORD })
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
    await Promise.all(['teacher', 'student', 'parent'].map(login));
    classId = (
      await prisma.class.findFirstOrThrow({
        where: { name: 'English 7 - Section A', deletedAt: null },
      })
    ).id;
  });

  afterAll(async () => {
    if (assignmentId)
      await prisma.assignment.deleteMany({ where: { id: assignmentId } });
    await prisma.h5PContent.deleteMany({
      where: { title: { contains: `E2E ${stamp}` } },
    });
    await app.close();
    stub.server.close();
  });

  it('lists the libraries the player can run', async () => {
    const res = await request(server)
      .get('/api/v1/h5p/libraries')
      .set(as('student'))
      .expect(200);
    const names = (
      res.body as { data: Array<{ machineName: string; runnable: boolean }> }
    ).data.map((l) => l.machineName);
    expect(names).toEqual(
      expect.arrayContaining([
        'H5P.QuestionSet',
        'H5P.Dialogcards',
        'H5P.MultiChoice',
      ]),
    );
  });

  it('generates a quiz as a job that becomes a reviewable draft (students cannot generate)', async () => {
    await request(server)
      .post('/api/v1/ai/content/quizzes')
      .set(as('student'))
      .send({ topic: 'x' })
      .expect(403);
    const accepted = await request(server)
      .post('/api/v1/ai/content/quizzes')
      .set(as('teacher'))
      .send({
        topic: `E2E ${stamp} fractions`,
        gradeLevel: '7',
        count: 3,
        difficulty: 'easy',
      })
      .expect(202);
    const job = accepted.body as JobBody;
    expect(['queued', 'running', 'done']).toContain(job.status);
    const polled = await request(server)
      .get(`/api/v1/ai/jobs/${job.id}`)
      .set(as('teacher'))
      .expect(200);
    const done = polled.body as JobBody;
    expect(done.status).toBe('done');
    expect(done.contentId).toBeTruthy();
    expect(done.content?.status).toBe('draft');
    expect(done.content?.maxScore).toBe(3);
    expect(done.content?.library).toBe('H5P.QuestionSet 1.20');
    contentId = done.contentId as string;
    const sent = stub.calls.find((c) => c.capability === 'content.quiz') as {
      request: { topic: string; count: number; gradeLevel: string };
    };
    expect(sent.request).toMatchObject({
      topic: `E2E ${stamp} fractions`,
      count: 3,
      gradeLevel: '7',
    });
    await request(server)
      .get(`/api/v1/ai/jobs/${job.id}`)
      .set(as('student'))
      .expect(403);
  });

  it('reports a failed generation honestly', async () => {
    const accepted = await request(server)
      .post('/api/v1/ai/content/flashcards')
      .set(as('teacher'))
      .send({ topic: `E2E ${stamp} fail please`, count: 4 })
      .expect(202);
    const polled = await request(server)
      .get(`/api/v1/ai/jobs/${(accepted.body as JobBody).id}`)
      .set(as('teacher'))
      .expect(200);
    const body = polled.body as JobBody;
    expect(body.status).toBe('failed');
    expect(body.error?.code).toBe('ai.invalid_output');
    expect(body.contentId).toBeNull();
  });

  it('keeps drafts away from students, lets the teacher edit, rejects unplayable edits, then publishes', async () => {
    await request(server)
      .get(`/api/v1/h5p/contents/${contentId}`)
      .set(as('student'))
      .expect(404);
    const detail = await request(server)
      .get(`/api/v1/h5p/contents/${contentId}`)
      .set(as('teacher'))
      .expect(200);
    const content = detail.body as {
      parameters: { questions: unknown[] };
      draft: { questions: unknown[] };
      validation: { valid: boolean };
    };
    expect(content.parameters.questions).toHaveLength(3);
    expect(content.draft.questions).toHaveLength(3);
    expect(content.validation.valid).toBe(true);

    const broken = await request(server)
      .patch(`/api/v1/h5p/contents/${contentId}`)
      .set(as('teacher'))
      .send({ parameters: { questions: [] } })
      .expect(400);
    expect((broken.body as Problem).code).toBe('h5p.invalid');

    const trimmed = { questions: content.parameters.questions.slice(0, 2) };
    const updated = await request(server)
      .patch(`/api/v1/h5p/contents/${contentId}`)
      .set(as('teacher'))
      .send({ title: `E2E ${stamp} quiz reviewed`, parameters: trimmed })
      .expect(200);
    expect((updated.body as { maxScore: number }).maxScore).toBe(2);

    const published = await request(server)
      .post(`/api/v1/h5p/contents/${contentId}/publish`)
      .set(as('teacher'))
      .expect(200);
    expect((published.body as { status: string }).status).toBe('published');
    const visible = await request(server)
      .get('/api/v1/h5p/contents')
      .set(as('student'))
      .expect(200);
    expect(
      (visible.body as { data: Array<{ id: string }> }).data.some(
        (c) => c.id === contentId,
      ),
    ).toBe(true);
  });

  it('regenerates from teacher feedback as a new draft', async () => {
    const accepted = await request(server)
      .post(`/api/v1/ai/content/${contentId}/regenerate`)
      .set(as('teacher'))
      .send({ feedback: 'Make them harder' })
      .expect(202);
    const polled = await request(server)
      .get(`/api/v1/ai/jobs/${(accepted.body as JobBody).id}`)
      .set(as('teacher'))
      .expect(200);
    const body = polled.body as JobBody;
    expect(body.status).toBe('done');
    expect(body.contentId).not.toBe(contentId);
    const sent = stub.calls[stub.calls.length - 1] as {
      request: { feedback: string; previousDraft: unknown };
    };
    expect(sent.request.feedback).toBe('Make them harder');
    expect(sent.request.previousDraft).toBeTruthy();
  });

  it('attaches the content to a published assignment that students can see', async () => {
    const created = await request(server)
      .post('/api/v1/assignments')
      .set(as('teacher'))
      .send({
        classId,
        title: `E2E ${stamp} play`,
        type: 'quiz',
        maxPoints: 10,
        h5pContentId: contentId,
        maxAttempts: 2,
      })
      .expect(201);
    assignmentId = (created.body as { id: string }).id;
    await request(server)
      .post(`/api/v1/assignments/${assignmentId}/publish`)
      .set(as('teacher'))
      .expect(200);
    const seen = await request(server)
      .get(`/api/v1/assignments/${assignmentId}`)
      .set(as('student'))
      .expect(200);
    expect(
      (seen.body as { h5pContent: { id: string; maxScore: number } })
        .h5pContent,
    ).toMatchObject({ id: contentId, maxScore: 2 });
  });

  it('issues a play ticket and serves the package to the player without a bearer token', async () => {
    const play = await request(server)
      .get(
        `/api/v1/h5p/contents/${contentId}/play?assignmentId=${assignmentId}`,
      )
      .set(as('student'))
      .expect(200);
    const body = play.body as {
      ticket: string;
      h5pJsonPath: string;
      maxScore: number;
    };
    expect(body.maxScore).toBe(2);
    ticketPath = body.h5pJsonPath;
    const manifest = await request(server)
      .get(`${ticketPath}/h5p.json`)
      .expect(200);
    const m = manifest.body as {
      mainLibrary: string;
      preloadedDependencies: Array<{ machineName: string }>;
    };
    expect(m.mainLibrary).toBe('H5P.QuestionSet');
    expect(m.preloadedDependencies.map((d) => d.machineName)).toEqual(
      expect.arrayContaining([
        'H5P.JoubelUI',
        'H5P.MultiChoice',
        'H5P.QuestionSet',
      ]),
    );
    const content = await request(server)
      .get(`${ticketPath}/content/content.json`)
      .expect(200);
    expect((content.body as { questions: unknown[] }).questions).toHaveLength(
      2,
    );
    const forged = await request(server)
      .get(`${ticketPath}x/h5p.json`)
      .expect(401);
    expect((forged.body as Problem).code).toBe('h5p.ticket_invalid');
  });

  it('posts a result as a submission with an auto-graded, scaled score', async () => {
    const res = await request(server)
      .post(`/api/v1/h5p/contents/${contentId}/results`)
      .set(as('student'))
      .send({
        score: 1,
        maxScore: 2,
        assignmentId,
        timeSpentSeconds: 42,
        detail: { verb: 'completed' },
      })
      .expect(201);
    const body = res.body as {
      percentage: number;
      grade: { score: number; percentage: number };
      submission: { status: string; attemptNumber: number };
    };
    expect(body.percentage).toBe(50);
    expect(body.grade.score).toBe(5);
    expect(body.submission.status).toBe('graded');
    const grades = await request(server)
      .get(`/api/v1/grades?assignmentId=${assignmentId}`)
      .set(as('student'))
      .expect(200);
    expect(
      (grades.body as { data: Array<{ score: number }> }).data[0].score,
    ).toBe(5);

    await request(server)
      .post(`/api/v1/h5p/contents/${contentId}/results`)
      .set(as('parent'))
      .send({ score: 2, maxScore: 2 })
      .expect(403);
    const over = await request(server)
      .post(`/api/v1/h5p/contents/${contentId}/results`)
      .set(as('student'))
      .send({ score: 3, maxScore: 2 })
      .expect(400);
    expect((over.body as Problem).code).toBe('request.invalid');

    const mine = await request(server)
      .get(`/api/v1/h5p/contents/${contentId}/results`)
      .set(as('student'))
      .expect(200);
    expect((mine.body as { data: unknown[] }).data).toHaveLength(1);
    const all = await request(server)
      .get(`/api/v1/h5p/contents/${contentId}/results`)
      .set(as('teacher'))
      .expect(200);
    expect(
      (all.body as { data: Array<{ user: { firstName: string } }> }).data[0]
        .user.firstName,
    ).toBeTruthy();
  });

  it('refuses to delete content that an assignment uses', async () => {
    const res = await request(server)
      .delete(`/api/v1/h5p/contents/${contentId}`)
      .set(as('teacher'))
      .expect(400);
    expect((res.body as Problem).code).toBe('h5p.in_use');
  });
});
