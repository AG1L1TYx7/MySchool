import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AI_STUB_PORT, AI_STUB_TOKEN } from './ai-env';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { INVENTORY } from '../src/modules/careers/careers-rules';
import { startAiStub } from './ai-stub';

interface Problem {
  code: string;
}
interface Project {
  id: string;
  title: string;
  status: string;
  skills: string[];
  media: Array<{ fileId: string; name: string }>;
  reviews: Array<{ id: string; by: string; comment: string; mine: boolean }>;
  evidence: { submissionId: string; title: string } | null;
}
interface Portfolio {
  id: string;
  visibility: string;
  slug: string | null;
  publicPath: string | null;
  own: boolean;
  projects: Project[];
  skills: Array<{
    skillId: string;
    name: string;
    level: number;
    endorsements: Array<{ by: string; role: string }>;
  }>;
}
interface Career {
  interests: {
    code: string;
    top: string[];
    clusters: Array<{ id: string; name: string }>;
  } | null;
  pathways: Array<{ id: string }>;
  collegePlans: Array<{ name: string; status: string }>;
  checklist: Array<{ key: string; who: string; done: boolean }>;
  readiness: number;
  canCounsel: boolean;
}
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

const PASSWORD = 'SmartSchool!Demo2026';

/** Careers and portfolio (slice 24): projects with evidence and feedback, skills and endorsements, the interest inventory, the readiness checklist, the resume, and code lessons in the sandbox. */
describe('Careers and portfolio (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  let emmaId = '';
  let projectId = '';
  let fileId = '';
  let codingSkillId = '';
  let slug = '';
  let lessonId = '';

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
      ['teacher', 'student', 'parent', 'counselor', 'principal'].map((r) =>
        login(r),
      ),
    );
    emmaId = (
      await prisma.student.findFirstOrThrow({
        where: { studentNumber: 'S2026-000001' },
      })
    ).id;
    // Start from a clean slate so the spec can run again on the same database.
    await prisma.portfolio.deleteMany({ where: { studentId: emmaId } });
    await prisma.studentSkill.deleteMany({ where: { studentId: emmaId } });
    await prisma.careerProfile.deleteMany({ where: { studentId: emmaId } });
    await prisma.codeSubmission.deleteMany({ where: { studentId: emmaId } });
    const up = await request(server)
      .post('/api/v1/files')
      .set(as('student'))
      .attach('file', Buffer.from('bridge photo bytes'), 'bridge.png')
      .expect(201);
    fileId = (up.body as { id: string }).id;
  });

  afterAll(async () => {
    await app?.close();
    stub.server.close();
  });

  it('starts private, lets the student add a project with a file and evidence, and keeps drafts to themselves', async () => {
    const mine = await request(server)
      .get('/api/v1/me/portfolio')
      .set(as('student'))
      .expect(200);
    expect((mine.body as Portfolio).visibility).toBe('private');
    expect((mine.body as Portfolio).own).toBe(true);
    const evidence = await request(server)
      .get('/api/v1/me/portfolio/evidence')
      .set(as('student'))
      .expect(200);
    const submissionId = (evidence.body as Array<{ id: string }>)[0]?.id;
    const created = await request(server)
      .post('/api/v1/me/portfolio/projects')
      .set(as('student'))
      .send({
        title: `Bridge model ${stamp}`,
        summary: 'A popsicle bridge that held 4 kg',
        kind: 'science',
        skills: ['Problem solving', 'Teamwork'],
        fileIds: [fileId],
        completedOn: '2026-05-01',
        ...(submissionId ? { sourceSubmissionId: submissionId } : {}),
      })
      .expect(201);
    const p = created.body as Project;
    projectId = p.id;
    expect(p.status).toBe('draft');
    expect(p.media[0].fileId).toBe(fileId);
    if (submissionId) expect(p.evidence?.submissionId).toBe(submissionId);
    const stolen = await request(server)
      .post('/api/v1/me/portfolio/projects')
      .set(as('student'))
      .send({
        title: 'Not mine',
        fileIds: [
          (
            await prisma.fileUpload.findFirstOrThrow({
              where: {
                uploaderId: {
                  not: (
                    await prisma.user.findFirstOrThrow({
                      where: { email: 'student@smartschool.local' },
                    })
                  ).id,
                },
              },
            })
          ).id,
        ],
      })
      .expect(400);
    expect((stolen.body as Problem).code).toBe('file.not_owned');
    // Private: the parent and the teacher may look (family and teachers always), a classmate may not.
    await request(server)
      .get(`/api/v1/students/${emmaId}/portfolio`)
      .set(as('parent'))
      .expect(200);
    const teacherView = await request(server)
      .get(`/api/v1/students/${emmaId}/portfolio`)
      .set(as('teacher'))
      .expect(200);
    expect((teacherView.body as Portfolio).projects.map((x) => x.id)).toContain(
      projectId,
    );
  });

  it('publishes the project, opens the portfolio to the school and the world, and serves the public page', async () => {
    await request(server)
      .patch(`/api/v1/me/portfolio/projects/${projectId}`)
      .set(as('student'))
      .send({ status: 'published', featured: true })
      .expect(200);
    const pub = await request(server)
      .patch('/api/v1/me/portfolio')
      .set(as('student'))
      .send({ headline: 'Curious builder', visibility: 'public' })
      .expect(200);
    slug = (pub.body as Portfolio).slug ?? '';
    expect(slug).toMatch(/^emma-johnson-[0-9a-f]{4}$/);
    expect((pub.body as Portfolio).publicPath).toBe(`/p/${slug}`);
    const page = await request(server).get(`/api/v1/p/${slug}`).expect(200);
    expect(page.body).toMatchObject({
      name: 'Emma Johnson',
      headline: 'Curious builder',
    });
    expect(
      (page.body as { projects: Array<{ title: string }> }).projects[0].title,
    ).toBe(`Bridge model ${stamp}`);
    const taken = await request(server)
      .patch('/api/v1/me/portfolio')
      .set(as('student'))
      .send({ slug: 'admin' })
      .expect(400);
    expect((taken.body as Problem).code).toBe('request.invalid');
    await request(server)
      .patch('/api/v1/me/portfolio')
      .set(as('student'))
      .send({ visibility: 'school' })
      .expect(200);
    await request(server).get(`/api/v1/p/${slug}`).expect(404);
  });

  it('takes feedback from a teacher and a classmate but not from the owner or a parent', async () => {
    const own = await request(server)
      .post(`/api/v1/portfolio/projects/${projectId}/reviews`)
      .set(as('student'))
      .send({ comment: 'Great job me' })
      .expect(400);
    expect((own.body as Problem).code).toBe('portfolio.own_project');
    await request(server)
      .post(`/api/v1/portfolio/projects/${projectId}/reviews`)
      .set(as('parent'))
      .send({ comment: 'Proud' })
      .expect(403);
    const reviewed = await request(server)
      .post(`/api/v1/portfolio/projects/${projectId}/reviews`)
      .set(as('teacher'))
      .send({ comment: 'Clear write-up and a strong build.', stars: 5 })
      .expect(201);
    const review = (reviewed.body as Project).reviews.find((r) => r.mine);
    expect(review?.comment).toContain('strong build');
    const hidden = await request(server)
      .post(
        `/api/v1/me/portfolio/projects/${projectId}/reviews/${review?.id}/hide`,
      )
      .set(as('student'))
      .expect(201);
    expect((hidden.body as Project).reviews).toHaveLength(0);
  });

  it('adds skills from the catalogue and takes endorsements from staff', async () => {
    const catalogue = await request(server)
      .get('/api/v1/skills')
      .set(as('student'))
      .expect(200);
    const coding = (catalogue.body as Array<{ id: string; name: string }>).find(
      (s) => s.name === 'Coding',
    );
    expect(coding).toBeDefined();
    codingSkillId = coding?.id ?? '';
    const set = await request(server)
      .put('/api/v1/me/skills')
      .set(as('student'))
      .send({ skillId: codingSkillId, level: 3, note: 'Built two games' })
      .expect(200);
    expect(
      (set.body as Portfolio['skills']).find((s) => s.skillId === codingSkillId)
        ?.level,
    ).toBe(3);
    await request(server)
      .post(`/api/v1/students/${emmaId}/skills/${codingSkillId}/endorse`)
      .set(as('parent'))
      .send({})
      .expect(403);
    const endorsed = await request(server)
      .post(`/api/v1/students/${emmaId}/skills/${codingSkillId}/endorse`)
      .set(as('teacher'))
      .send({ comment: 'Debugged a tricky loop on her own.' })
      .expect(201);
    const skill = (endorsed.body as Portfolio['skills']).find(
      (s) => s.skillId === codingSkillId,
    );
    expect(skill?.endorsements).toHaveLength(1);
    expect(skill?.endorsements[0].role).toBe('teacher');
    const custom = await request(server)
      .post('/api/v1/skills')
      .set(as('counselor'))
      .send({ name: `Robotics ${stamp}`, category: 'technology' })
      .expect(201);
    expect((custom.body as { schoolOwned: boolean }).schoolOwned).toBe(true);
  });

  it('scores the interest inventory, matches clusters, and lets the counselor and student work the checklist', async () => {
    const q = await request(server)
      .get('/api/v1/career/inventory')
      .set(as('student'))
      .expect(200);
    expect((q.body as { questions: unknown[] }).questions).toHaveLength(
      INVENTORY.length,
    );
    const answers: Record<string, number> = {};
    for (const item of INVENTORY)
      answers[item.id] = item.code === 'I' ? 5 : item.code === 'R' ? 4 : 2;
    const taken = await request(server)
      .post('/api/v1/me/career/inventory')
      .set(as('student'))
      .send({ answers })
      .expect(201);
    const c = taken.body as Career;
    expect(c.interests?.top.slice(0, 2)).toEqual(['I', 'R']);
    expect(c.interests?.clusters[0].id).toBe('stem');
    expect(c.checklist.find((i) => i.key === 'interests')?.done).toBe(true);
    const partial = await request(server)
      .post('/api/v1/me/career/inventory')
      .set(as('student'))
      .send({ answers: { r1: 5 } })
      .expect(400);
    expect((partial.body as Problem).code).toBe('request.invalid');

    const updated = await request(server)
      .patch(`/api/v1/students/${emmaId}/career`)
      .set(as('student'))
      .send({
        goals: 'Engineer',
        pathways: ['stem', 'it'],
        collegePlans: [{ name: 'State University', status: 'interested' }],
      })
      .expect(200);
    expect((updated.body as Career).pathways.map((p) => p.id)).toEqual([
      'stem',
      'it',
    ]);
    // Pathways apply from grade 8; Emma is in grade 7, so the item is not on her list yet.
    expect(
      (updated.body as Career).checklist.find((i) => i.key === 'pathways'),
    ).toBeUndefined();
    await request(server)
      .patch(`/api/v1/students/${emmaId}/career`)
      .set(as('teacher'))
      .send({ goals: 'x' })
      .expect(403);

    const counselor = await request(server)
      .get(`/api/v1/students/${emmaId}/career`)
      .set(as('counselor'))
      .expect(200);
    expect((counselor.body as Career).canCounsel).toBe(true);
    // Emma is in grade 7: the counselor items start in grade 9, so none apply yet; tick a student item on her behalf and back.
    const ticked = await request(server)
      .post(`/api/v1/students/${emmaId}/career/checklist`)
      .set(as('counselor'))
      .send({ key: 'skills', done: true })
      .expect(201);
    expect(
      (ticked.body as Career).checklist.find((i) => i.key === 'skills')?.done,
    ).toBe(true);
    const unticked = await request(server)
      .post(`/api/v1/students/${emmaId}/career/checklist`)
      .set(as('student'))
      .send({ key: 'skills', done: false })
      .expect(201);
    expect(
      (unticked.body as Career).checklist.find((i) => i.key === 'skills')?.done,
    ).toBe(false);
    await request(server)
      .get(`/api/v1/students/${emmaId}/career`)
      .set(as('parent'))
      .expect(200);
  });

  it('builds the resume from the portfolio and school records, as data and as a PDF', async () => {
    const data = await request(server)
      .get(`/api/v1/students/${emmaId}/resume`)
      .set(as('student'))
      .expect(200);
    const r = data.body as {
      skills: Array<{ name: string; endorsements: number }>;
      projects: Array<{ title: string }>;
      pathways: string[];
      courses: unknown[];
    };
    expect(r.skills.find((s) => s.name === 'Coding')?.endorsements).toBe(1);
    expect(r.projects.map((p) => p.title)).toContain(`Bridge model ${stamp}`);
    expect(r.pathways).toContain(
      'Science, Technology, Engineering and Mathematics',
    );
    const pdf = await request(server)
      .get(`/api/v1/students/${emmaId}/resume.pdf`)
      .set(as('parent'))
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
    const career = await request(server)
      .get('/api/v1/me/career')
      .set(as('student'))
      .expect(200);
    expect(
      (career.body as Career).checklist.find((i) => i.key === 'resume')?.done ??
        false,
    ).toBe(false);
  });

  it('runs code lessons in the sandbox and records attempts', async () => {
    const list = await request(server)
      .get('/api/v1/code/lessons')
      .set(as('student'))
      .expect(200);
    const lessons = list.body as {
      available: boolean;
      lessons: Array<{ id: string; title: string }>;
    };
    expect(lessons.available).toBe(true);
    lessonId =
      lessons.lessons.find((l) => l.title === 'Add two numbers')?.id ?? '';
    expect(lessonId).not.toBe('');
    const wrong = await request(server)
      .post(`/api/v1/code/lessons/${lessonId}/run`)
      .set(as('student'))
      .send({ source: 'function add(a, b) { return a - b; }' })
      .expect(201);
    expect(wrong.body).toMatchObject({ status: 'failed', passed: 0, total: 3 });
    const right = await request(server)
      .post(`/api/v1/code/lessons/${lessonId}/run`)
      .set(as('student'))
      .send({ source: 'function add(a, b) { print("adding"); return a + b; }' })
      .expect(201);
    expect(right.body).toMatchObject({ status: 'passed', passed: 3, total: 3 });
    expect((right.body as { output: string }).output).toContain('adding');
    const escape = await request(server)
      .post(`/api/v1/code/lessons/${lessonId}/run`)
      .set(as('student'))
      .send({
        source: 'function add() { return typeof process + typeof require; }',
      })
      .expect(201);
    expect(
      (escape.body as { outcomes: Array<{ got: string }> }).outcomes[0].got,
    ).toBe('"undefinedundefined"');
    const lesson = await request(server)
      .get(`/api/v1/code/lessons/${lessonId}`)
      .set(as('student'))
      .expect(200);
    expect(
      (lesson.body as { lastSubmission: { status: string } }).lastSubmission
        .status,
    ).toBe('failed');
    const progress = await request(server)
      .get(`/api/v1/students/${emmaId}/code/progress`)
      .set(as('teacher'))
      .expect(200);
    expect(progress.body).toMatchObject({ solved: 1, attempted: 1 });
    const custom = await request(server)
      .post('/api/v1/code/lessons')
      .set(as('teacher'))
      .send({
        title: `Double it ${stamp}`,
        description: 'Return n times two.',
        starter: 'function double(n) {}',
        tests: [{ expr: 'double(4)', expected: '8' }],
      })
      .expect(201);
    expect((custom.body as { id: string }).id).toBeTruthy();
    await request(server)
      .post('/api/v1/code/lessons')
      .set(as('student'))
      .send({ title: 'x', description: 'y', starter: '', tests: [] })
      .expect(403);
  });
});
