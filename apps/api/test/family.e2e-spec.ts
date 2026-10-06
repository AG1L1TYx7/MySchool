import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AI_STUB_PORT, AI_STUB_TOKEN } from './ai-env';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { FamilyService } from '../src/modules/family/family.service';
import { startAiStub } from './ai-stub';

interface Problem {
  code: string;
}
interface Child {
  student: { id: string; firstName: string };
  classes: Array<{ id: string; name: string; percentage: number | null }>;
  attendance: { rate: number | null; daysAbsent: number };
  missing: Array<{ assignmentId: string; title: string }>;
  upcoming: Array<{ assignmentId: string }>;
  recentGrades: unknown[];
  behaviorNotes: number;
  reportCards: number;
}
interface Job {
  id: string;
  status: string;
  resultId: string | null;
  error: { code: string } | null;
}
interface Summary {
  id: string;
  language: string;
  title: string;
  summary: string;
  status: string;
  aiGenerated: boolean;
  reviewedBy: { firstName: string } | null;
}
interface Note {
  id: string;
  language: string;
  aiModel: string | null;
  content: { strengths: string[]; nextSteps: string[] };
}
interface Notice {
  category: string;
  title: string;
  link: string | null;
}

const PASSWORD = 'SmartSchool!Demo2026';

/** Family home, missing-work alerts, the weekly digest in Spanish, lesson summaries and conference notes. */
describe('Parents and Spanish (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  let classId = '';
  let emmaId = '';
  let lessonId = '';
  let assignmentId = '';
  let summaryId = '';

  const login = async (role: string) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: `${role}@smartschool.local`, password: PASSWORD })
      .expect(200);
    tokens[role] = (res.body as { accessToken: string }).accessToken;
  };
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
  const waitForJob = async (id: string, role = 'teacher'): Promise<Job> => {
    for (let i = 0; i < 20; i++) {
      const res = await request(server)
        .get(`/api/v1/ai/jobs/${id}`)
        .set(as(role))
        .expect(200);
      const job = res.body as Job;
      if (job.status === 'done' || job.status === 'failed') return job;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('job did not finish');
  };

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
      ['teacher', 'student', 'parent', 'counselor'].map((r) => login(r)),
    );
    const klass = await prisma.class.findFirstOrThrow({
      where: { name: 'English 7 - Section A', deletedAt: null },
    });
    classId = klass.id;
    const emma = await prisma.student.findFirstOrThrow({
      where: { studentNumber: 'S2026-000001' },
    });
    emmaId = emma.id;
    const lesson = await prisma.lesson.findFirstOrThrow({
      where: {
        module: { course: { courseCode: 'ELA-7' } },
        content: { not: null },
      },
    });
    lessonId = lesson.id;
    await prisma.lessonSummary.deleteMany({ where: { lessonId } });
    await prisma.conferenceNote.deleteMany({ where: { studentId: emmaId } });
  });

  afterAll(async () => {
    // The demo parent must be back in English for the browser checks.
    await prisma.user.updateMany({
      where: { email: 'parent@smartschool.local' },
      data: { locale: 'en' },
    });
    await app.close();
    stub.server.close();
  });

  it('shows a parent every linked child with classes, attendance and work, and nobody else', async () => {
    const res = await request(server)
      .get('/api/v1/family/home')
      .set(as('parent'))
      .expect(200);
    const children = (res.body as { children: Child[] }).children;
    const emma = children.find((c) => c.student.id === emmaId);
    expect(emma).toBeDefined();
    expect(emma?.classes.some((c) => c.id === classId)).toBe(true);
    expect(emma?.attendance).toHaveProperty('rate');
    expect(Array.isArray(emma?.missing)).toBe(true);
    expect(Array.isArray(emma?.upcoming)).toBe(true);
    expect(typeof emma?.behaviorNotes).toBe('number');

    const own = await request(server)
      .get('/api/v1/family/home')
      .set(as('student'))
      .expect(200);
    expect((own.body as { children: Child[] }).children).toHaveLength(1);

    await request(server)
      .get('/api/v1/family/home')
      .set(as('teacher'))
      .expect(403);
  });

  it('lists past-due unsubmitted work as missing and alerts the guardian', async () => {
    const now = Date.now();
    const created = await request(server)
      .post('/api/v1/assignments')
      .set(as('teacher'))
      .send({
        classId,
        title: `E2E missing ${stamp}`,
        maxPoints: 10,
        availableFrom: new Date(now - 3 * 86_400_000).toISOString(),
        dueAt: new Date(now - 3_600_000).toISOString(),
      })
      .expect(201);
    assignmentId = (created.body as { id: string }).id;
    await request(server)
      .post(`/api/v1/assignments/${assignmentId}/publish`)
      .set(as('teacher'))
      .expect(200);

    const home = await request(server)
      .get('/api/v1/family/home')
      .set(as('parent'))
      .expect(200);
    const emma = (home.body as { children: Child[] }).children.find(
      (c) => c.student.id === emmaId,
    );
    expect(emma?.missing.some((m) => m.assignmentId === assignmentId)).toBe(
      true,
    );

    await app.get(FamilyService).missingWorkAlerts();
    const notices = await request(server)
      .get('/api/v1/notifications?pageSize=50')
      .set(as('parent'))
      .expect(200);
    const alert = (notices.body as { data: Notice[] }).data.find(
      (n) => n.link === '/family' && /missing assignment/i.test(n.title),
    );
    expect(alert).toBeDefined();
    expect(alert?.category).toBe('assignment');
  });

  it('renders the weekly digest in the guardian’s language', async () => {
    await request(server)
      .patch('/api/v1/auth/me')
      .set(as('parent'))
      .send({ locale: 'es' })
      .expect(200);
    const es = await request(server)
      .get('/api/v1/family/digest')
      .set(as('parent'))
      .expect(200);
    const esBody = es.body as { subject: string; text: string };
    expect(esBody.subject.startsWith('Esta semana en la escuela')).toBe(true);
    expect(esBody.text).toContain('Trabajos sin entregar');

    await request(server)
      .patch('/api/v1/auth/me')
      .set(as('parent'))
      .send({ locale: 'en' })
      .expect(200);
    const en = await request(server)
      .get('/api/v1/family/digest')
      .set(as('parent'))
      .expect(200);
    expect(
      (en.body as { subject: string }).subject.startsWith(
        'This week at school',
      ),
    ).toBe(true);
  });

  it('drafts a lesson summary in Spanish, hides it from families until the teacher releases it', async () => {
    const accepted = await request(server)
      .post(`/api/v1/lessons/${lessonId}/summaries`)
      .set(as('teacher'))
      .send({ language: 'es' })
      .expect(202);
    const job = await waitForJob((accepted.body as Job).id);
    expect(job.status).toBe('done');
    expect(job.resultId).toBeTruthy();

    const drafts = await request(server)
      .get(`/api/v1/lessons/${lessonId}/summaries`)
      .set(as('teacher'))
      .expect(200);
    const draft = (drafts.body as { data: Summary[] }).data.find(
      (s) => s.language === 'es',
    );
    expect(draft?.status).toBe('draft');
    expect(draft?.aiGenerated).toBe(true);
    expect(draft?.title.startsWith('Resumen:')).toBe(true);
    summaryId = draft?.id ?? '';

    const hidden = await request(server)
      .get(`/api/v1/lessons/${lessonId}/summaries`)
      .set(as('parent'))
      .expect(200);
    expect(
      (hidden.body as { data: Summary[] }).data.some((s) => s.id === summaryId),
    ).toBe(false);

    const released = await request(server)
      .patch(`/api/v1/lesson-summaries/${summaryId}`)
      .set(as('teacher'))
      .send({
        summary: 'Hoy trabajamos la escritura narrativa.',
        status: 'released',
      })
      .expect(200);
    expect((released.body as Summary).status).toBe('released');
    expect((released.body as Summary).reviewedBy?.firstName).toBeTruthy();

    const visible = await request(server)
      .get(`/api/v1/lessons/${lessonId}/summaries`)
      .set(as('parent'))
      .expect(200);
    const seen = (visible.body as { data: Summary[] }).data.find(
      (s) => s.id === summaryId,
    );
    expect(seen?.summary).toBe('Hoy trabajamos la escritura narrativa.');

    const again = await request(server)
      .post(`/api/v1/lessons/${lessonId}/summaries`)
      .set(as('teacher'))
      .send({ language: 'es' })
      .expect(403);
    expect((again.body as Problem).code).toBe('summaries.released');

    await request(server)
      .post(`/api/v1/lessons/${lessonId}/summaries`)
      .set(as('parent'))
      .send({ language: 'es' })
      .expect(403);
    await request(server)
      .delete(`/api/v1/lesson-summaries/${summaryId}`)
      .set(as('teacher'))
      .expect(204);
  });

  it('drafts conference talking points for the teacher and never for the family', async () => {
    const accepted = await request(server)
      .post(`/api/v1/students/${emmaId}/conference-notes`)
      .set(as('teacher'))
      .send({})
      .expect(202);
    const job = await waitForJob((accepted.body as Job).id);
    expect(job.status).toBe('done');

    const list = await request(server)
      .get(`/api/v1/students/${emmaId}/conference-notes`)
      .set(as('counselor'))
      .expect(200);
    const note = (list.body as { data: Note[] }).data[0];
    expect(note.aiModel).toBe('fake:fake');
    expect(note.content.strengths.length).toBeGreaterThan(0);
    expect(note.content.nextSteps.length).toBeGreaterThan(0);

    // The AI only ever saw this student's own numbers.
    const call = stub.calls.find(
      (c) => c.capability === 'content.conference',
    ) as { context?: { blocks?: Array<{ text: string }> } } | undefined;
    expect(call).toBeDefined();
    const data = call?.context?.blocks?.map((b) => b.text).join('\n') ?? '';
    expect(data).toContain('Emma');

    await request(server)
      .get(`/api/v1/students/${emmaId}/conference-notes`)
      .set(as('parent'))
      .expect(403);
    await request(server)
      .get(`/api/v1/students/${emmaId}/conference-notes`)
      .set(as('student'))
      .expect(403);
    await request(server)
      .delete(`/api/v1/conference-notes/${note.id}`)
      .set(as('teacher'))
      .expect(204);
  });
});
