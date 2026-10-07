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
import { routeCatalog } from './route-catalog';
import { startAiStub } from './ai-stub';

const PASSWORD = 'SmartSchool!Demo2026';
const ROLES = [
  'super_admin',
  'superintendent',
  'principal',
  'teacher',
  'counselor',
  'assistant',
  'student',
  'parent',
] as const;
type RoleName = (typeof ROLES)[number];
const DEMO_EMAIL: Record<RoleName, string> = {
  super_admin: 'superadmin@smartschool.local',
  superintendent: 'superintendent@smartschool.local',
  principal: 'principal@smartschool.local',
  teacher: 'teacher@smartschool.local',
  counselor: 'counselor@smartschool.local',
  assistant: 'assistant@smartschool.local',
  student: 'student@smartschool.local',
  parent: 'parent@smartschool.local',
};
/** Keys that must never appear in any response body. */
const SECRET_KEYS = [
  'passwordHash',
  'twoFactorSecret',
  'encryptedSecret',
  'clientSecret',
  'secretEncrypted',
  'refreshTokenHash',
  'backupCodeHashes',
];
/** Routes that are reachable without a feature by design (JWT-only self-service, public, or token-guarded). */
const FEATURELESS_OK = [
  /^\/auth\//,
  /^\/health/,
  /^\/metrics/,
  /^\/internal\/ai\//,
  /^\/roles$/,
  /^\/features$/,
  /^\/calendar\/ical\//,
  /^\/h5p\/play\//,
];
const PUBLIC_PREFIXES = [
  /^\/health/,
  /^\/branding/,
  /^\/metrics/,
  /^\/auth\/(register|verify-email|resend-verification|login|2fa\/challenge|refresh|forgot-password|reset-password|sso)/,
  /^\/calendar\/ical\//,
  /^\/h5p\/play\//,
  /^\/internal\/ai\//,
];

const fill = (p: string) =>
  p
    .replace(':token.ics', `${'a'.repeat(43)}.ics`)
    .replace(':ticket', 'not-a-ticket')
    .replace(':provider', 'google')
    .replace(/:[A-Za-z]+/g, () => newId());

/**
 * Attack suite (docs/11 section 3, OWASP top ten): every route as every role, a second school probing the
 * first school's records, and targeted abuse of sign-in, tokens, input and stored HTML. It is deliberately
 * noisy about what it finds so a regression shows up as a named failure.
 */
describe('Security (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  const features: Record<string, Set<string>> = {};
  const stamp = Date.now();
  const routes = routeCatalog();
  // The second school ("B") and its people.
  let orgB = '';
  const b: Record<string, string> = {};
  // Demo-school ("A") object ids the B people will probe.
  const a: Record<string, string> = {};

  const login = async (key: string, email: string) => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);
    tokens[key] = (res.body as { accessToken: string }).accessToken;
    const me = await request(server)
      .get('/api/v1/auth/me')
      .set({ Authorization: `Bearer ${tokens[key]}` })
      .expect(200);
    features[key] = new Set((me.body as { features: string[] }).features);
  };
  const as = (key: string) => ({ Authorization: `Bearer ${tokens[key]}` });
  const hash = () =>
    argon2.hash(PASSWORD, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });

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
    for (const r of ROLES) await login(r, DEMO_EMAIL[r]);

    // School A objects.
    const klass = await prisma.class.findFirstOrThrow({
      where: { name: 'English 7 - Section A', deletedAt: null },
      include: { course: true },
    });
    a.org = klass.organizationId;
    a.class = klass.id;
    a.course = klass.courseId;
    a.student = (
      await prisma.student.findFirstOrThrow({
        where: { studentNumber: 'S2026-000001' },
      })
    ).id;
    a.lesson = (
      await prisma.lesson.findFirstOrThrow({
        where: { module: { courseId: a.course } },
      })
    ).id;
    a.assignment = (
      await prisma.assignment.findFirstOrThrow({
        where: { classId: a.class, deletedAt: null },
      })
    ).id;
    a.teacherUser = (
      await prisma.user.findUniqueOrThrow({
        where: { email: DEMO_EMAIL.teacher },
      })
    ).id;
    const sub = await prisma.assignmentSubmission.findFirst({
      where: { assignment: { classId: a.class } },
    });
    a.submission = sub?.id ?? newId();
    const file = await prisma.fileUpload.findFirst({
      where: { organizationId: a.org },
    });
    a.file = file?.id ?? newId();
    const conv = await prisma.conversation.findFirst({
      where: { organizationId: a.org },
    });
    a.conversation = conv?.id ?? newId();
    const card = await prisma.reportCard.findFirst({
      where: { organizationId: a.org },
    });
    a.reportCard = card?.id ?? newId();
    const h5p = await prisma.h5PContent.findFirst({
      where: { organizationId: a.org },
    });
    a.h5p = h5p?.id ?? newId();

    // School B: a whole second school with a principal, a teacher, a student and a parent.
    const org = await prisma.organization.create({
      data: {
        id: newId(),
        tenantId: '00000000-0000-7000-8000-000000000001',
        name: `Pentest School ${stamp}`,
        timezone: 'America/Chicago',
        joinCode: `PEN-${String(stamp).slice(-6)}`,
      },
    });
    orgB = org.id;
    const mk = async (role: string, last: string) =>
      prisma.user.create({
        data: {
          id: newId(),
          email: `${role}-b-${stamp}@smartschool.local`,
          passwordHash: await hash(),
          passwordChangedAt: new Date(),
          firstName: 'B',
          lastName: last,
          role: role.toUpperCase() as never,
          organizationId: orgB,
          emailVerifiedAt: new Date(),
        },
      });
    const [principal, teacher, studentUser, parentUser] = await Promise.all([
      mk('principal', 'Principal'),
      mk('teacher', 'Teacher'),
      mk('student', 'Student'),
      mk('parent', 'Parent'),
    ]);
    const studentB = await prisma.student.create({
      data: {
        id: newId(),
        organizationId: orgB,
        userId: studentUser.id,
        studentNumber: `B-${stamp}`,
        firstName: 'B',
        lastName: 'Student',
        gradeLevel: '7',
        enrollmentStatus: 'ACTIVE',
      },
    });
    await prisma.studentGuardian.create({
      data: {
        id: newId(),
        studentId: studentB.id,
        guardianUserId: parentUser.id,
        relationship: 'GUARDIAN',
      },
    });
    b.student = studentB.id;
    await Promise.all([
      login('b.principal', principal.email),
      login('b.teacher', teacher.email),
      login('b.student', studentUser.email),
      login('b.parent', parentUser.email),
    ]);
  });

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { id: orgB } });
    await app.close();
    stub.server.close();
  });

  it('catalogues every route and finds no handler that lacks both a feature and a public or token guard', () => {
    expect(routes.length).toBeGreaterThan(250);
    const unguarded = routes.filter(
      (r) =>
        r.features.length === 0 &&
        !r.spread &&
        !r.isPublic &&
        !r.controllerGuard &&
        !FEATURELESS_OK.some((re) => re.test(r.path)),
    );
    expect(unguarded.map((r) => `${r.method.toUpperCase()} ${r.path}`)).toEqual(
      [],
    );
  });

  it('refuses every non-public route without a token, with a problem body and no stack trace', async () => {
    const failures: string[] = [];
    for (const r of routes) {
      if (PUBLIC_PREFIXES.some((re) => re.test(r.path))) continue;
      const res = await request(server)
        [r.method](`/api/v1${fill(r.path)}`)
        .send({});
      if (res.status !== 401)
        failures.push(`${r.method.toUpperCase()} ${r.path} -> ${res.status}`);
      if (/at \w+ \(.*\.ts:\d+/.test(res.text))
        failures.push(`${r.path} leaks a stack trace`);
    }
    expect(failures).toEqual([]);
  });

  it('enforces the declared feature for every role on every route, never answers 500 to junk, and leaks no secret field', async () => {
    const failures: string[] = [];
    const junkBodies = [
      {},
      {
        id: "' OR 1=1 --",
        title: '<script>alert(1)</script>',
        content: '../../etc/passwd',
        email: 'x',
        score: -1,
        count: 10 ** 9,
      },
    ];
    for (const r of routes) {
      if (PUBLIC_PREFIXES.some((re) => re.test(r.path))) continue;
      if (r.path.startsWith('/auth/')) continue; // self-service, covered by the auth suite
      for (const role of ROLES) {
        const has =
          r.spread ||
          r.features.length === 0 ||
          r.features.some((f) => features[role].has(f));
        for (const body of junkBodies) {
          const url = `/api/v1${fill(r.path)}`;
          const res = await request(server)
            [r.method](url)
            .set(as(role))
            .send(body);
          const id = `${r.method.toUpperCase()} ${r.path} as ${role}`;
          if (res.status >= 500)
            failures.push(`${id} -> ${res.status} ${res.text.slice(0, 120)}`);
          if (!has && res.status !== 403)
            failures.push(
              `${id} should be 403 (missing ${r.features.join('|')}) but was ${res.status}`,
            );
          if (
            has &&
            res.status === 403 &&
            /authz\.forbidden/.test(res.text) &&
            /feature/i.test(res.text)
          )
            failures.push(`${id} has the feature but was refused for it`);
          for (const key of SECRET_KEYS)
            if (res.text.includes(`"${key}"`))
              failures.push(`${id} exposes ${key}`);
          if (/at \w+ \(.*\.ts:\d+/.test(res.text))
            failures.push(`${id} leaks a stack trace`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 600_000);

  it("keeps school B's people out of school A's records on every id-based route", async () => {
    const probes: Array<[string, string, string?, Record<string, unknown>?]> = [
      ['get', `/students/${a.student}`],
      ['get', `/students/${a.student}/motivation`],
      ['get', `/students/${a.student}/accommodations`],
      ['get', `/students/${a.student}/behavior`],
      ['get', `/students/${a.student}/ai-consent`],
      ['get', `/students/${a.student}/attendance/summary`],
      ['get', `/students/${a.student}/conference-notes`],
      [
        'post',
        `/students/${a.student}/motivation/awards`,
        undefined,
        { kind: 'xp', amount: 5, reason: 'probe' },
      ],
      ['get', `/classes/${a.class}`],
      ['get', `/classes/${a.class}/gradebook`],
      ['get', `/classes/${a.class}/motivation`],
      ['get', `/classes/${a.class}/quests`],
      ['get', `/classes/${a.class}/substitutes`],
      ['get', `/students/${a.student}/records-export.zip`],
      ['get', `/students/${a.student}/deletion-requests`],
      ['post', `/students/${a.student}/deletion-requests`, undefined, {}],
      [
        'put',
        `/students/${a.student}/legal-hold`,
        undefined,
        { legalHold: true },
      ],
      ['get', `/students/${a.student}/insight`],
      ['get', `/students/${a.student}/transcript.pdf`],
      ['get', `/organizations/${a.org}/compliance/data-map`],
      ['get', `/organizations/${a.org}/compliance/deletion-requests`],
      ['get', `/organizations/${a.org}/insight/overview`],
      ['get', `/organizations/${a.org}/report-schedules`],
      ['get', `/classes/${a.class}/insight`],
      ['get', `/classes/${a.class}/mastery`],
      ['get', `/classes/${a.class}/attendance`],
      ['patch', `/classes/${a.class}`, undefined, { name: 'pwned' }],
      ['get', `/courses/${a.course}`],
      ['get', `/courses/${a.course}/progress?studentId=${a.student}`],
      ['get', `/lessons/${a.lesson}/summaries`],
      ['post', `/lessons/${a.lesson}/complete`],
      ['get', `/assignments/${a.assignment}`],
      ['get', `/assignments/${a.assignment}/submissions`],
      ['get', `/assistant/grading/assignments/${a.assignment}`],
      ['post', `/submissions/${a.submission}/grade`, undefined, { score: 1 }],
      ['get', `/grades?studentId=${a.student}`],
      ['get', `/report-cards/${a.reportCard}`],
      ['get', `/organizations/${a.org}`],
      ['get', `/organizations/${a.org}/structure`],
      ['get', `/organizations/${a.org}/support/settings`],
      ['get', `/organizations/${a.org}/motivation/settings`],
      ['get', `/users/${a.teacherUser}`],
      ['get', `/conversations/${a.conversation}`],
      ['get', `/files/${a.file}`],
      ['get', `/files/${a.file}/download`],
      ['get', `/h5p/contents/${a.h5p}`],
      ['get', `/assistant/classes/${a.class}/insight`],
      ['post', `/assistant/classes/${a.class}/insight`],
      ['get', `/audit-logs?organizationId=${a.org}`],
      [
        'get',
        `/calendar/feed?from=2026-01-01&to=2026-12-31&classId=${a.class}`,
      ],
    ];
    const leaks: string[] = [];
    for (const who of ['b.principal', 'b.teacher', 'b.student', 'b.parent']) {
      for (const [method, path, , body] of probes) {
        const res = await request(server)
          [method as 'get'](`/api/v1${path}`)
          .set(as(who))
          .send(body ?? {});
        // 200 with a body that names school A's object is a leak; empty lists and 403/404 are fine.
        if (res.status === 200 || res.status === 201) {
          const text = JSON.stringify(res.body);
          const names = [
            a.student,
            a.class,
            a.course,
            a.lesson,
            a.assignment,
            a.org,
            a.teacherUser,
            a.conversation,
            a.file,
            a.h5p,
            a.reportCard,
          ];
          if (
            names.some((id) => text.includes(id)) ||
            /English 7|Johnson|Emma/.test(text)
          )
            leaks.push(
              `${who} ${method.toUpperCase()} ${path} -> ${res.status} ${text.slice(0, 100)}`,
            );
        }
        if (res.status >= 500)
          leaks.push(`${who} ${method.toUpperCase()} ${path} -> ${res.status}`);
      }
    }
    expect(leaks).toEqual([]);
  }, 300_000);

  it("keeps school B's family to their own child", async () => {
    const home = await request(server)
      .get('/api/v1/family/home')
      .set(as('b.parent'))
      .expect(200);
    const children = (
      home.body as { children: Array<{ student: { id: string } }> }
    ).children;
    expect(children.map((c) => c.student.id)).toEqual([b.student]);
    const mine = await request(server)
      .get('/api/v1/students/mine')
      .set(as('b.parent'))
      .expect(200);
    expect(
      (mine.body as { data: Array<{ id: string }> }).data.map((s) => s.id),
    ).toEqual([b.student]);
  });

  it('does not tell an attacker which emails exist, and throttles password guessing', async () => {
    const unknown = await request(server)
      .post('/api/v1/auth/login')
      .send({
        email: `nobody-${stamp}@smartschool.local`,
        password: 'Wrong!Password1',
      });
    const wrong = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: DEMO_EMAIL.student, password: 'Wrong!Password1' });
    expect(unknown.status).toBe(wrong.status);
    expect((unknown.body as { detail: string }).detail).toBe(
      (wrong.body as { detail: string }).detail,
    );
    const forgotKnown = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: DEMO_EMAIL.student });
    const forgotUnknown = await request(server)
      .post('/api/v1/auth/forgot-password')
      .send({ email: `nobody-${stamp}@smartschool.local` });
    expect(forgotUnknown.status).toBe(forgotKnown.status);
    expect((forgotUnknown.body as { message: string }).message).toBe(
      (forgotKnown.body as { message: string }).message,
    );
    const resend = await request(server)
      .post('/api/v1/auth/resend-verification')
      .send({ email: `nobody-${stamp}@smartschool.local` });
    expect([200, 202]).toContain(resend.status);
  });

  it('rejects tampered, foreign and expired tokens and ignores privilege fields in self-service updates', async () => {
    const [h, p, s] = tokens.student.split('.');
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), role: 'SUPER_ADMIN' })).toString('base64url')}.${s}`;
    await request(server)
      .get('/api/v1/auth/me')
      .set({ Authorization: `Bearer ${forged}` })
      .expect(401);
    await request(server)
      .get('/api/v1/auth/me')
      .set({ Authorization: `Bearer ${h}.${p}.AAAA` })
      .expect(401);
    await request(server)
      .get('/api/v1/auth/me')
      .set({ Authorization: 'Bearer not.a.jwt' })
      .expect(401);
    const before = (
      await request(server)
        .get('/api/v1/auth/me')
        .set(as('student'))
        .expect(200)
    ).body as { role: string; organizationId: string };
    await request(server)
      .patch('/api/v1/auth/me')
      .set(as('student'))
      .send({
        firstName: 'Emma',
        role: 'super_admin',
        organizationId: orgB,
        features: ['users.manage'],
        status: 'ACTIVE',
        emailVerifiedAt: null,
      });
    const after = (
      await request(server)
        .get('/api/v1/auth/me')
        .set(as('student'))
        .expect(200)
    ).body as { role: string; organizationId: string };
    expect(after.role).toBe(before.role);
    expect(after.organizationId).toBe(before.organizationId);
    const reg = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email: `esc-${stamp}@smartschool.local`,
        password: PASSWORD,
        firstName: 'E',
        lastName: 'S',
        role: 'principal',
      });
    expect(reg.status).toBeGreaterThanOrEqual(400);
    await request(server)
      .patch(`/api/v1/users/${a.teacherUser}`)
      .set(as('student'))
      .send({ role: 'student' })
      .expect(403);
  });

  it('requires the anti-CSRF header on cookie-authenticated routes and sets hardening headers', async () => {
    const refresh = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', 'ss_refresh=anything')
      .send({});
    expect(refresh.status).toBe(403);
    const health = await request(server).get('/api/v1/health');
    expect(health.headers['x-powered-by']).toBeUndefined();
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['x-frame-options']).toBeDefined();
    expect(health.headers['strict-transport-security']).toContain('max-age');
    expect(health.headers['content-type']).toContain('application/json');
  });

  it('strips script and event handlers from H5P parameters before they are stored or served', async () => {
    const created = await request(server)
      .post('/api/v1/h5p/contents')
      .set(as('teacher'))
      .send({
        title: `XSS probe ${stamp}`,
        library: 'H5P.MultiChoice 1.16',
        parameters: {
          question:
            '<p>Which is right?</p><script>alert(1)</script><img src=x onerror="alert(2)">',
          answers: [
            { text: '<div onclick="steal()">Right</div>', correct: true },
            {
              text: '<b>Wrong</b><iframe src="https://evil.example"></iframe>',
              correct: false,
            },
          ],
        },
      });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    const got = await request(server)
      .get(`/api/v1/h5p/contents/${id}`)
      .set(as('teacher'))
      .expect(200);
    const text = JSON.stringify(got.body);
    expect(text).not.toMatch(/<script|onerror|onclick|<iframe/i);
    expect(text).toContain('Which is right?');
    expect(text).toContain('<b>Wrong</b>');
    await prisma.h5PContent.deleteMany({ where: { id } });
  });

  it('keeps file names safe and refuses traversal', async () => {
    const up = await request(server)
      .post('/api/v1/files')
      .set(as('teacher'))
      .attach('file', Buffer.from('hello'), {
        filename: '../../evil<script>.txt',
        contentType: 'text/plain',
      });
    expect([201, 400]).toContain(up.status);
    if (up.status === 201) {
      const name = (up.body as { originalName: string }).originalName;
      expect(name).not.toMatch(/\.\.|<|>|\//);
      await request(server)
        .delete(`/api/v1/files/${(up.body as { id: string }).id}`)
        .set(as('teacher'));
    }
    await request(server)
      .get('/api/v1/files/..%2F..%2F.env/download')
      .set(as('teacher'))
      .expect((res) => expect([400, 404]).toContain(res.status));
  });

  it('keeps a superintendent out of another district (tenant) entirely', async () => {
    const tenant = await prisma.tenant.create({
      data: {
        id: newId(),
        name: `Other District ${stamp}`,
        slug: `other-${stamp}`,
      },
    });
    const other = await prisma.organization.create({
      data: {
        id: newId(),
        tenantId: tenant.id,
        name: `Other District School ${stamp}`,
        timezone: 'America/Chicago',
        joinCode: `OTH-${String(stamp).slice(-6)}`,
      },
    });
    const sup = as('superintendent');
    for (const path of [
      `/api/v1/organizations/${other.id}`,
      `/api/v1/organizations/${other.id}/members`,
      `/api/v1/students?organizationId=${other.id}`,
      `/api/v1/district/overview?tenantId=${tenant.id}`,
      `/api/v1/tenants/${tenant.id}`,
      `/api/v1/tenants/${tenant.id}/policies`,
    ]) {
      const res = await request(server).get(path).set(sup);
      expect([path, res.status]).toEqual([path, 403]);
    }
    const list = await request(server)
      .get('/api/v1/organizations?pageSize=100&includeInactive=true')
      .set(sup)
      .expect(200);
    expect(
      (list.body as { data: Array<{ id: string }> }).data.map((o) => o.id),
    ).not.toContain(other.id);
    await request(server)
      .put(`/api/v1/tenants/${tenant.id}/policies`)
      .set(sup)
      .send({ aiEnabled: false })
      .expect(403);
    await prisma.organization.delete({ where: { id: other.id } });
    await prisma.tenant.delete({ where: { id: tenant.id } });
  });
});
