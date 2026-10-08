import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AI_STUB_PORT, AI_STUB_TOKEN } from './ai-env';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { newId } from '../src/common/utils/ids';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { startAiStub } from './ai-stub';

interface Problem {
  code: string;
}
interface Profile {
  health: {
    score: number;
    band: string;
    parts: Array<{ key: string; weight: number; note: string }>;
  };
  gaps: Array<{ code: string; level: number }>;
  recommendations: Array<{
    kind: string;
    refId: string | null;
    standardCode?: string | null;
    href: string | null;
  }>;
  paths: Array<{ id: string }>;
}
interface Step {
  id: string;
  kind: string;
  refId: string | null;
  status: string;
  sortOrder: number;
  evidence: string | null;
  href: string | null;
}
interface Path {
  id: string;
  title: string;
  status: string;
  source: string;
  progress: { total: number; done: number; complete: boolean };
  steps: Step[];
}

const PASSWORD = 'SmartSchool!Demo2026';
const CODE = 'CCSS.ELA-LITERACY.RL.7.3';

/** Learning paths and the integrated profile (slice 23): health with its parts, gaps, next steps, generated paths that finish themselves. */
describe('Learning paths (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  let emmaId = '';
  let otherStudentId = '';
  let pathId = '';
  let lessonStepId = '';
  let lessonId = '';

  const login = async (role: string, email = `${role}@smartschool.local`) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    tokens[role] = (res.body as { accessToken: string }).accessToken;
  };
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
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
      ['teacher', 'student', 'parent', 'principal'].map((r) => login(r)),
    );
    const emma = await prisma.student.findFirstOrThrow({
      where: { studentNumber: 'S2026-000001' },
    });
    emmaId = emma.id;
    otherStudentId = (
      await prisma.student.findFirstOrThrow({
        where: { studentNumber: 'S2026-000002' },
      })
    ).id;
    const standard = await prisma.standard.findFirstOrThrow({
      where: { code: CODE },
    });
    // Emma is weak on one standard with real evidence, so there is a gap to build from.
    await prisma.masteryLevel.upsert({
      where: {
        studentId_standardId: { studentId: emmaId, standardId: standard.id },
      },
      update: { level: 0.3, evidenceCount: 3, trend: 'down' },
      create: {
        id: newId(),
        studentId: emmaId,
        standardId: standard.id,
        level: 0.3,
        evidenceCount: 3,
        trend: 'down',
      },
    });
    await prisma.libraryItem.create({
      data: {
        id: newId(),
        organizationId: emma.organizationId,
        createdById: (
          await prisma.user.findFirstOrThrow({
            where: { email: 'teacher@smartschool.local' },
          })
        ).id,
        kind: 'link',
        title: `Story structure explainer ${stamp}`,
        url: 'https://example.org/story-structure',
        standards: JSON.stringify([CODE]),
        visibility: 'school',
        status: 'published',
        publishedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await app?.close();
    stub.server.close();
  });

  it('gives a student a learning health score with every part explained, the gap and next steps', async () => {
    const res = await request(server)
      .get('/api/v1/me/learning/profile')
      .set(as('student'))
      .expect(200);
    const p = res.body as Profile;
    expect(p.health.parts.map((x) => x.key)).toEqual([
      'mastery',
      'attendance',
      'work',
      'practice',
      'engagement',
    ]);
    expect(p.health.parts.reduce((s, x) => s + x.weight, 0)).toBeCloseTo(1);
    expect(p.health.parts.every((x) => x.note.length > 0)).toBe(true);
    expect(p.gaps.map((g) => g.code)).toContain(CODE);
    const lessonRec = p.recommendations.find(
      (r) => r.kind === 'lesson' && r.standardCode === CODE,
    );
    expect(lessonRec).toBeDefined();
    expect(lessonRec?.href).toMatch(/^\/courses\/[0-9a-f-]+\?lesson=/);
  });

  it('shows the profile to family and the teacher, and to nobody else', async () => {
    await request(server)
      .get(`/api/v1/students/${emmaId}/learning/profile`)
      .set(as('parent'))
      .expect(200);
    await request(server)
      .get(`/api/v1/students/${emmaId}/learning/profile`)
      .set(as('teacher'))
      .expect(200);
    await request(server)
      .get(`/api/v1/students/${otherStudentId}/learning/profile`)
      .set(as('student'))
      .expect(403);
  });

  it('builds a path from the weakest standards with the lessons and library items that teach them', async () => {
    await request(server)
      .post(`/api/v1/students/${emmaId}/learning/paths/generate`)
      .set(as('student'))
      .send({})
      .expect(403);
    const res = await request(server)
      .post(`/api/v1/students/${emmaId}/learning/paths/generate`)
      .set(as('teacher'))
      .send({})
      .expect(201);
    const path = res.body as Path;
    pathId = path.id;
    expect(path.title).toContain(CODE);
    expect(path.source).toBe('generated');
    expect(path.steps.length).toBeGreaterThanOrEqual(2);
    const lessonStep = path.steps.find((s) => s.kind === 'lesson');
    expect(lessonStep).toBeDefined();
    lessonStepId = lessonStep?.id ?? '';
    lessonId = lessonStep?.refId ?? '';
    expect(path.steps.some((s) => s.kind === 'practice')).toBe(true);
    expect(path.progress).toMatchObject({
      total: path.steps.length,
      done: 0,
      complete: false,
    });
    const noGaps = await request(server)
      .post(`/api/v1/students/${otherStudentId}/learning/paths/generate`)
      .set(as('teacher'))
      .send({})
      .expect(400);
    expect((noGaps.body as Problem).code).toBe('paths.no_gaps');
  });

  it('lets the student tick steps but not rearrange them, and finishes a lesson step when the lesson is completed', async () => {
    const mine = await request(server)
      .get('/api/v1/me/learning/paths')
      .set(as('student'))
      .expect(200);
    expect((mine.body as Path[]).map((p) => p.id)).toContain(pathId);
    const practice = (mine.body as Path[])
      .find((p) => p.id === pathId)
      ?.steps.find((s) => s.kind === 'practice');
    const ticked = await request(server)
      .patch(`/api/v1/learning/paths/${pathId}/steps/${practice?.id}`)
      .set(as('student'))
      .send({ status: 'done' })
      .expect(200);
    expect((ticked.body as Path).progress.done).toBe(1);
    await request(server)
      .patch(`/api/v1/learning/paths/${pathId}/steps/${practice?.id}`)
      .set(as('student'))
      .send({ position: 1 })
      .expect(403);

    await prisma.lessonCompletion.deleteMany({
      where: { studentId: emmaId, lessonId },
    });
    await request(server)
      .post(`/api/v1/lessons/${lessonId}/complete`)
      .set(as('student'))
      .expect((r) => expect([200, 201]).toContain(r.status));
    const step = await until(
      () =>
        prisma.learningPathStep.findUniqueOrThrow({
          where: { id: lessonStepId },
        }),
      (s) => s.status === 'done',
    );
    expect(step.evidence).toContain('completing the lesson');
  });

  it('lets the teacher add, reorder and remove steps, see the class view, and archive the path', async () => {
    const added = await request(server)
      .post(`/api/v1/learning/paths/${pathId}/steps`)
      .set(as('teacher'))
      .send({
        kind: 'tutor',
        title: 'Ask the tutor to explain story structure',
        reason: 'For anything still unclear',
      })
      .expect(201);
    const steps = (added.body as Path).steps;
    const tutor = steps.find((s) => s.kind === 'tutor');
    expect(tutor?.sortOrder).toBe(steps.length);
    const moved = await request(server)
      .patch(`/api/v1/learning/paths/${pathId}/steps/${tutor?.id}`)
      .set(as('teacher'))
      .send({ position: 1 })
      .expect(200);
    expect((moved.body as Path).steps[0].kind).toBe('tutor');
    await request(server)
      .delete(`/api/v1/learning/paths/${pathId}/steps/${tutor?.id}`)
      .set(as('teacher'))
      .expect(200);
    const bad = await request(server)
      .post(`/api/v1/learning/paths/${pathId}/steps`)
      .set(as('teacher'))
      .send({ kind: 'lesson', title: 'Missing lesson', refId: newId() })
      .expect(404);
    expect((bad.body as Problem).code).toBe('resource.not_found');

    const klass = await prisma.class.findFirstOrThrow({
      where: { name: 'English 7 - Section A', deletedAt: null },
    });
    const classView = await request(server)
      .get(`/api/v1/classes/${klass.id}/learning/paths`)
      .set(as('teacher'))
      .expect(200);
    expect(
      (classView.body as Array<{ id: string; student: { id: string } }>).find(
        (r) => r.id === pathId,
      )?.student.id,
    ).toBe(emmaId);
    await request(server)
      .get(`/api/v1/classes/${klass.id}/learning/paths`)
      .set(as('student'))
      .expect(403);

    const archived = await request(server)
      .patch(`/api/v1/learning/paths/${pathId}`)
      .set(as('teacher'))
      .send({ status: 'archived' })
      .expect(200);
    expect((archived.body as Path).status).toBe('archived');
    const profile = await request(server)
      .get('/api/v1/me/learning/profile')
      .set(as('student'))
      .expect(200);
    expect((profile.body as Profile).paths.map((p) => p.id)).not.toContain(
      pathId,
    );
  });

  it('creates a path by hand and completes it when every step is done', async () => {
    const created = await request(server)
      .post(`/api/v1/students/${emmaId}/learning/paths`)
      .set(as('principal'))
      .send({
        title: `Catch-up ${stamp}`,
        goal: 'Two quick wins',
        steps: [
          { kind: 'practice', title: 'Review your cards' },
          { kind: 'lesson', refId: lessonId, title: 'Reread the lesson' },
        ],
      })
      .expect(201);
    const p = created.body as Path;
    expect(p.source).toBe('teacher');
    for (const s of p.steps)
      await request(server)
        .patch(`/api/v1/learning/paths/${p.id}/steps/${s.id}`)
        .set(as('student'))
        .send({ status: 'done' })
        .expect(200);
    const done = await request(server)
      .get(`/api/v1/learning/paths/${p.id}`)
      .set(as('parent'))
      .expect(200);
    expect((done.body as Path).status).toBe('completed');
    expect((done.body as Path).progress.complete).toBe(true);
    await request(server)
      .delete(`/api/v1/learning/paths/${p.id}`)
      .set(as('student'))
      .expect(403);
    await request(server)
      .delete(`/api/v1/learning/paths/${p.id}`)
      .set(as('principal'))
      .expect(204);
    await request(server)
      .delete(`/api/v1/learning/paths/${pathId}`)
      .set(as('teacher'))
      .expect(204);
  });
});
