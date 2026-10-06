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
import { weekWindow } from '../src/modules/motivation/motivation-rules';
import { startAiStub } from './ai-stub';

interface Job {
  id: string;
  status: string;
  resultId: string | null;
  contentId: string | null;
}
interface Problem {
  code: string;
}

const PASSWORD = 'SmartSchool!Demo2026';

/** Lesson plans, grading suggestions, parent emails, narratives, differentiation, insight, substitutes, planner. */
describe('Teacher assistant (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  let orgId = '';
  let classId = '';
  let emmaId = '';
  let lessonId = '';
  let planId = '';
  let subUserId = '';
  const createdLessons: string[] = [];

  const login = async (role: string, email = `${role}@smartschool.local`) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    tokens[role] = (res.body as { accessToken: string }).accessToken;
  };
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
  const waitForJob = async (id: string, role = 'teacher'): Promise<Job> => {
    for (let i = 0; i < 30; i++) {
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
      ['teacher', 'student', 'parent', 'principal'].map((r) => login(r)),
    );
    const klass = await prisma.class.findFirstOrThrow({
      where: { name: 'English 7 - Section A', deletedAt: null },
    });
    classId = klass.id;
    orgId = klass.organizationId;
    emmaId = (
      await prisma.student.findFirstOrThrow({
        where: { studentNumber: 'S2026-000001' },
      })
    ).id;
    lessonId = (
      await prisma.lesson.findFirstOrThrow({
        where: {
          module: { courseId: klass.courseId },
          content: { not: null },
          isPublished: true,
        },
      })
    ).id;
    await prisma.teacherDraft.deleteMany({
      where: { author: { email: 'teacher@smartschool.local' } },
    });
    await prisma.lessonPlan.deleteMany({
      where: { author: { email: 'teacher@smartschool.local' } },
    });
    // A fresh teacher to stand in as the substitute.
    const passwordHash = await argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    const sub = await prisma.user.create({
      data: {
        id: newId(),
        email: `substitute-${stamp}@smartschool.local`,
        passwordHash,
        passwordChangedAt: new Date(),
        firstName: 'Sam',
        lastName: 'Substitute',
        role: 'TEACHER',
        organizationId: orgId,
        emailVerifiedAt: new Date(),
      },
    });
    subUserId = sub.id;
    await login('sub', sub.email);
  });

  afterAll(async () => {
    if (createdLessons.length)
      await prisma.lesson.deleteMany({ where: { id: { in: createdLessons } } });
    await app.close();
    stub.server.close();
  });

  it('drafts a lesson plan from the class, lets the teacher publish and schedule it, and keeps it from students', async () => {
    const accepted = await request(server)
      .post('/api/v1/assistant/lesson-plans')
      .set(as('teacher'))
      .send({ topic: 'Story structure', classId, durationMinutes: 45 })
      .expect(202);
    const job = await waitForJob((accepted.body as Job).id);
    expect(job.status).toBe('done');
    planId = job.resultId ?? '';
    expect(planId).toBeTruthy();
    const plan = await request(server)
      .get(`/api/v1/lesson-plans/${planId}`)
      .set(as('teacher'))
      .expect(200);
    const body = plan.body as {
      status: string;
      aiGenerated: boolean;
      className: string;
      content: { sequence: Array<{ minutes: number }> };
    };
    expect(body.status).toBe('draft');
    expect(body.aiGenerated).toBe(true);
    expect(body.className).toBe('English 7 - Section A');
    expect(body.content.sequence.length).toBeGreaterThan(0);
    // The AI saw the course outline and was asked for the right length.
    const call = stub.calls.find(
      (c) => c.capability === 'content.lesson_plan',
    ) as
      | {
          request: { durationMinutes: number };
          context: { blocks: Array<{ label: string }> };
        }
      | undefined;
    expect(call?.request.durationMinutes).toBe(45);
    expect(
      call?.context.blocks.some((b) => b.label.startsWith('Course outline')),
    ).toBe(true);

    const wednesday = new Date(
      weekWindow(new Date()).startsAt.getTime() + 2 * 86_400_000,
    );
    const updated = await request(server)
      .patch(`/api/v1/lesson-plans/${planId}`)
      .set(as('teacher'))
      .send({
        status: 'published',
        scheduledOn: wednesday.toISOString().slice(0, 10),
        title: `Plan ${stamp}`,
      })
      .expect(200);
    expect((updated.body as { status: string }).status).toBe('published');
    await request(server)
      .get('/api/v1/assistant/lesson-plans')
      .set(as('student'))
      .expect(403);
    const mine = await request(server)
      .get('/api/v1/assistant/lesson-plans')
      .set(as('teacher'))
      .expect(200);
    expect(
      (mine.body as { data: Array<{ id: string }> }).data.some(
        (p) => p.id === planId,
      ),
    ).toBe(true);
  });

  it('shows the week to the teacher with the scheduled plan and due work', async () => {
    const res = await request(server)
      .get('/api/v1/planner')
      .set(as('teacher'))
      .expect(200);
    const body = res.body as {
      days: Array<{ date: string; items: Array<{ kind: string; id: string }> }>;
      classes: Array<{ id: string }>;
    };
    expect(body.days).toHaveLength(7);
    expect(body.classes.some((c) => c.id === classId)).toBe(true);
    expect(
      body.days
        .flatMap((d) => d.items)
        .some((i) => i.kind === 'plan' && i.id === planId),
    ).toBe(true);
    await request(server).get('/api/v1/planner').set(as('student')).expect(403);
  });

  it('suggests grades for ungraded essays, approves the confident ones in bulk and leaves the unsure one for review', async () => {
    const make = async (title: string) => {
      const created = await request(server)
        .post('/api/v1/assignments')
        .set(as('teacher'))
        .send({
          classId,
          title,
          maxPoints: 10,
          availableFrom: new Date(Date.now() - 60_000).toISOString(),
          dueAt: new Date(Date.now() + 3 * 86_400_000).toISOString(),
        })
        .expect(201);
      const id = (created.body as { id: string }).id;
      await request(server)
        .post(`/api/v1/assignments/${id}/publish`)
        .set(as('teacher'))
        .expect(200);
      await request(server)
        .post(`/api/v1/assignments/${id}/submissions`)
        .set(as('student'))
        .send({
          textContent:
            'In this essay I argue that stories need a clear structure to hold a reader.',
        })
        .expect(201);
      return id;
    };
    const sure = await make(`E2E essay ${stamp}`);
    const unsure = await make(`E2E essay unsure ${stamp}`);

    const started = await request(server)
      .post(`/api/v1/assistant/grading/assignments/${sure}/suggest`)
      .set(as('teacher'))
      .expect(202);
    const jobs = started.body as {
      started: number;
      jobs: Array<{ jobId: string }>;
    };
    expect(jobs.started).toBe(1);
    expect((await waitForJob(jobs.jobs[0].jobId)).status).toBe('done');
    const again = await request(server)
      .post(`/api/v1/assistant/grading/assignments/${sure}/suggest`)
      .set(as('teacher'))
      .expect(202);
    expect(
      (again.body as { started: number; skipped: { pending: number } }).skipped
        .pending,
    ).toBe(1);

    const list = await request(server)
      .get(`/api/v1/assistant/grading/assignments/${sure}`)
      .set(as('teacher'))
      .expect(200);
    const rows = (
      list.body as {
        data: Array<{
          suggestedPoints: number;
          needsHumanReview: boolean;
          status: string;
          confidence: number;
        }>;
      }
    ).data;
    expect(rows).toHaveLength(1);
    expect(rows[0].needsHumanReview).toBe(false);
    expect(rows[0].suggestedPoints).toBe(8);
    const bulk = await request(server)
      .post(`/api/v1/assistant/grading/assignments/${sure}/approve-all`)
      .set(as('teacher'))
      .expect(200);
    expect(bulk.body).toEqual({ approved: 1, left: 0 });
    const grade = await prisma.grade.findFirst({
      where: { assignmentId: sure, studentId: emmaId },
    });
    expect(Number(grade?.score)).toBe(8);
    expect(grade?.feedback).toContain('Clear and mostly complete');

    const started2 = await request(server)
      .post(`/api/v1/assistant/grading/assignments/${unsure}/suggest`)
      .set(as('teacher'))
      .expect(202);
    await waitForJob(
      (started2.body as { jobs: Array<{ jobId: string }> }).jobs[0].jobId,
    );
    const bulk2 = await request(server)
      .post(`/api/v1/assistant/grading/assignments/${unsure}/approve-all`)
      .set(as('teacher'))
      .expect(200);
    expect(bulk2.body).toEqual({ approved: 0, left: 1 });
    const pending = (
      (
        await request(server)
          .get(`/api/v1/assistant/grading/assignments/${unsure}`)
          .set(as('teacher'))
          .expect(200)
      ).body as { data: Array<{ id: string; needsHumanReview: boolean }> }
    ).data[0];
    expect(pending.needsHumanReview).toBe(true);
    await request(server)
      .post(`/api/v1/grading-suggestions/${pending.id}/approve`)
      .set(as('student'))
      .send({})
      .expect(403);
    const approved = await request(server)
      .post(`/api/v1/grading-suggestions/${pending.id}/approve`)
      .set(as('teacher'))
      .send({ score: 9, feedback: 'Checked by me.' })
      .expect(200);
    expect((approved.body as { grade: { score: number } }).grade.score).toBe(9);
    const dup = await request(server)
      .post(`/api/v1/grading-suggestions/${pending.id}/approve`)
      .set(as('teacher'))
      .send({})
      .expect(403);
    expect((dup.body as Problem).code).toBe('assistant.already_reviewed');
  });

  it('drafts a parent email in Spanish from the student’s own numbers and sends it to the guardians', async () => {
    const accepted = await request(server)
      .post('/api/v1/assistant/drafts/parent-email')
      .set(as('teacher'))
      .send({ studentId: emmaId, purpose: 'share good news', language: 'es' })
      .expect(202);
    const job = await waitForJob((accepted.body as Job).id);
    expect(job.status).toBe('done');
    const draft = await request(server)
      .get(`/api/v1/drafts/${job.resultId}`)
      .set(as('teacher'))
      .expect(200);
    const body = draft.body as {
      kind: string;
      language: string;
      content: { subject: string };
    };
    expect(body.kind).toBe('parent_email');
    expect(body.language).toBe('es');
    expect(body.content.subject).toContain('Progreso');
    const call = stub.calls.find(
      (c) => c.capability === 'content.parent_email',
    ) as { context: { blocks: Array<{ text: string }> } } | undefined;
    const data = call?.context.blocks[0].text ?? '';
    expect(data).toContain('student first name: Emma');
    expect(data).not.toContain('Liam');
    await request(server)
      .get(`/api/v1/drafts/${job.resultId}`)
      .set(as('principal'))
      .expect(403);
    const sent = await request(server)
      .post(`/api/v1/drafts/${job.resultId}/send`)
      .set(as('teacher'))
      .expect(200);
    expect((sent.body as { sentTo: number }).sentTo).toBeGreaterThanOrEqual(1);
    const inbox = await request(server)
      .get('/api/v1/conversations')
      .set(as('parent'))
      .expect(200);
    const found = (
      inbox.body as { data: Array<{ lastMessage: { content: string } | null }> }
    ).data.some((c) => c.lastMessage?.content.includes('Progreso'));
    expect(found).toBe(true);
  });

  it('drafts a narrative and puts it on the draft report card when one exists', async () => {
    const accepted = await request(server)
      .post('/api/v1/assistant/drafts/narrative')
      .set(as('teacher'))
      .send({ studentId: emmaId, classId })
      .expect(202);
    const job = await waitForJob((accepted.body as Job).id);
    expect(job.status).toBe('done');
    const hasDraftCard = await prisma.reportCard.findFirst({
      where: {
        studentId: emmaId,
        status: 'DRAFT',
        lines: { some: { classId } },
      },
    });
    const applied = await request(server)
      .post(`/api/v1/drafts/${job.resultId}/apply-to-report-card`)
      .set(as('teacher'));
    if (hasDraftCard) {
      expect(applied.status).toBe(200);
      const line = await prisma.reportCardLine.findFirst({
        where: { reportCardId: hasDraftCard.id, classId },
      });
      expect(line?.comment).toContain('Emma');
    } else {
      expect(applied.status).toBe(404);
      expect((applied.body as Problem).code).toBe('assistant.no_report_card');
    }
  });

  it('adapts a lesson to three levels and creates three unpublished lessons', async () => {
    const accepted = await request(server)
      .post('/api/v1/assistant/drafts/differentiation')
      .set(as('teacher'))
      .send({ lessonId })
      .expect(202);
    const job = await waitForJob((accepted.body as Job).id);
    expect(job.status).toBe('done');
    const draft = await request(server)
      .get(`/api/v1/drafts/${job.resultId}`)
      .set(as('teacher'))
      .expect(200);
    expect(
      (draft.body as { content: { levels: unknown[] } }).content.levels,
    ).toHaveLength(3);
    const created = await request(server)
      .post(`/api/v1/drafts/${job.resultId}/create-lessons`)
      .set(as('teacher'))
      .expect(201);
    const lessons = (
      created.body as { data: Array<{ id: string; level: string }> }
    ).data;
    expect(lessons.map((l) => l.level)).toEqual([
      'support',
      'core',
      'extension',
    ]);
    createdLessons.push(...lessons.map((l) => l.id));
    const rows = await prisma.lesson.findMany({
      where: { id: { in: createdLessons } },
    });
    expect(rows.every((r) => r.isPublished === false)).toBe(true);
  });

  it('builds this week’s class insight from real numbers, narrates it and offers a practice set', async () => {
    const built = await request(server)
      .post(`/api/v1/assistant/classes/${classId}/insight`)
      .set(as('teacher'))
      .expect(202);
    const { insight, job } = built.body as {
      insight: { id: string; data: { students: number } };
      job: Job;
    };
    expect(insight.data.students).toBeGreaterThan(0);
    expect((await waitForJob(job.id)).status).toBe('done');
    const latest = await request(server)
      .get(`/api/v1/assistant/classes/${classId}/insight`)
      .set(as('teacher'))
      .expect(200);
    const body = latest.body as {
      id: string;
      narrative: { headline: string } | null;
      aiGenerated: boolean;
    };
    expect(body.narrative?.headline).toBeTruthy();
    expect(body.aiGenerated).toBe(true);
    const call = stub.calls.find((c) => c.capability === 'insight.teacher') as
      | { context: { blocks: Array<{ label: string; text: string }> } }
      | undefined;
    expect(call?.context.blocks[0].label).toBe('DATA');
    expect(call?.context.blocks[0].text).toContain('missing work');
    const practice = await request(server)
      .post(`/api/v1/assistant/insights/${body.id}/practice-set`)
      .set(as('teacher'))
      .send({ count: 3 })
      .expect(202);
    const quiz = await waitForJob((practice.body as Job).id);
    expect(quiz.status).toBe('done');
    expect(quiz.contentId).toBeTruthy();
    await request(server)
      .patch(`/api/v1/assistant/insights/${body.id}`)
      .set(as('teacher'))
      .send({ practiceContentId: quiz.contentId })
      .expect(200);
    await request(server)
      .post(`/api/v1/assistant/classes/${classId}/insight`)
      .set(as('student'))
      .expect(403);
  });

  it('gives a substitute class access until a date and takes it away again', async () => {
    const anyAssignment = await prisma.assignment.findFirstOrThrow({
      where: { classId, deletedAt: null, status: 'PUBLISHED' },
    });
    const before = await request(server)
      .get(`/api/v1/assistant/grading/assignments/${anyAssignment.id}`)
      .set(as('sub'));
    if (before.status !== 403) {
      const me = await request(server).get('/api/v1/auth/me').set(as('sub'));
      const rows = await prisma.classTeacher.findMany({ where: { classId } });
      console.log(
        'DEBUG sub',
        before.status,
        JSON.stringify(me.body).slice(0, 300),
        JSON.stringify(rows),
      );
    }
    expect(before.status).toBe(403);
    const candidates = await request(server)
      .get(`/api/v1/classes/${classId}/substitutes/candidates`)
      .set(as('teacher'))
      .expect(200);
    expect(
      (candidates.body as { data: Array<{ id: string }> }).data.some(
        (c) => c.id === subUserId,
      ),
    ).toBe(true);
    const granted = await request(server)
      .post(`/api/v1/classes/${classId}/substitutes`)
      .set(as('teacher'))
      .send({
        userId: subUserId,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        note: 'Covering Tuesday',
      })
      .expect(201);
    const access = granted.body as { id: string; active: boolean };
    expect(access.active).toBe(true);
    await request(server)
      .get(`/api/v1/assistant/grading/assignments/${anyAssignment.id}`)
      .set(as('sub'))
      .expect(200);
    const list = await request(server)
      .get(`/api/v1/classes/${classId}/substitutes`)
      .set(as('teacher'))
      .expect(200);
    expect(
      (list.body as { data: Array<{ id: string }> }).data.some(
        (s) => s.id === access.id,
      ),
    ).toBe(true);
    await request(server)
      .delete(`/api/v1/substitutes/${access.id}`)
      .set(as('student'))
      .expect(403);
    await request(server)
      .delete(`/api/v1/substitutes/${access.id}`)
      .set(as('teacher'))
      .expect(204);
    await request(server)
      .get(`/api/v1/assistant/grading/assignments/${anyAssignment.id}`)
      .set(as('sub'))
      .expect(403);
    const teachers = await prisma.classTeacher.count({
      where: { classId, teacherId: subUserId },
    });
    expect(teachers).toBe(0);
  });
});
