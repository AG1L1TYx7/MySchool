import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createServer, type Server as HttpServer } from 'node:http';
import type { Server } from 'node:http';
import request from 'supertest';
import { SSO_STUB_PORT } from './sso-env';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import { SAMPLE_BUNDLE, sampleZip } from './fixtures/oneroster-sample';

const PASSWORD = 'SmartSchool!Demo2026';

interface Problem {
  code: string;
  detail: string;
}
interface RunBody {
  id: string;
  status: string;
  dryRun: boolean;
  summary: Record<string, Record<string, number>> | null;
  errorCount: number;
  errorMessage: string | null;
  errors?: Array<{ entityType: string; message: string }>;
}

/**
 * Stub identity provider: /o/oauth2/v2/auth redirects back with a code, /token exchanges it, /v1/userinfo
 * returns the profile for that code. Which person signs in is chosen by the test through `nextProfile`.
 */
function startIdp(port: number): {
  server: HttpServer;
  nextProfile: Record<string, unknown>;
  seen: Array<{ url: string; body: string }>;
} {
  const state = {
    server: null as unknown as HttpServer,
    nextProfile: {} as Record<string, unknown>,
    seen: [] as Array<{ url: string; body: string }>,
  };
  const codes = new Map<string, Record<string, unknown>>();
  state.server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString()));
    req.on('end', () => {
      state.seen.push({ url: req.url ?? '', body });
      const url = new URL(req.url ?? '/', 'http://x');
      if (url.pathname === '/o/oauth2/v2/auth') {
        const code = `code-${codes.size + 1}`;
        codes.set(code, state.nextProfile);
        res.writeHead(302, {
          location: `${url.searchParams.get('redirect_uri')}?code=${code}&state=${url.searchParams.get('state')}`,
        });
        res.end();
        return;
      }
      if (url.pathname === '/token') {
        const params = new URLSearchParams(body);
        const profile = codes.get(params.get('code') ?? '');
        if (!profile || !params.get('code_verifier')) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'invalid_grant' }));
          return;
        }
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: `at-${params.get('code')}`,
            token_type: 'Bearer',
          }),
        );
        return;
      }
      if (url.pathname === '/v1/userinfo') {
        const code = (req.headers.authorization ?? '').replace(
          'Bearer at-',
          '',
        );
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(codes.get(code) ?? {}));
        return;
      }
      res.writeHead(404);
      res.end();
    });
  }).listen(port, '127.0.0.1');
  return state;
}

/** Slice 9: a OneRoster bundle fills a school; Google sign-in admits only rostered, allowed accounts. */
describe('Rostering and sign-in (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let idp: ReturnType<typeof startIdp>;
  const tokens: Record<string, string> = {};
  let organizationId = '';

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
    if (role === 'principal') organizationId = body.user.organizationId ?? '';
  };
  const as = (role: string) => ({ Authorization: `Bearer ${tokens[role]}` });
  const waitRun = async (id: string): Promise<RunBody> => {
    for (let i = 0; i < 100; i++) {
      const res = await request(server)
        .get(`/api/v1/organizations/${organizationId}/roster/runs/${id}`)
        .set(as('principal'))
        .expect(200);
      const run = res.body as RunBody;
      if (run.status === 'done' || run.status === 'failed') return run;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('run did not finish');
  };

  beforeAll(async () => {
    idp = startIdp(SSO_STUB_PORT);
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
    await Promise.all(['principal', 'teacher', 'student'].map(login));
    // Clean any earlier import of the sample school.
    const rostered = await prisma.user.findMany({
      where: { organizationId, externalId: { in: ['t1', 's1', 'p1', 'x1'] } },
      select: { id: true },
    });
    await prisma.user.deleteMany({
      where: { id: { in: rostered.map((u) => u.id) } },
    });
    await prisma.class.deleteMany({
      where: { organizationId, externalId: 'k1' },
    });
    await prisma.student.deleteMany({
      where: { organizationId, externalId: { in: ['s1', 's2'] } },
    });
    await prisma.course.deleteMany({
      where: { organizationId, externalId: 'c1' },
    });
    await prisma.rosterSyncRun.deleteMany({ where: { organizationId } });
    await prisma.userIdentity.deleteMany({
      where: { subject: { startsWith: 'google-' } },
    });
  });

  afterAll(async () => {
    await app.close();
    idp.server.close();
  });

  it('previews a OneRoster bundle without writing, then imports it', async () => {
    const preview = await request(server)
      .post(`/api/v1/organizations/${organizationId}/roster/import?dryRun=true`)
      .set(as('principal'))
      .attach('files', Buffer.from(sampleZip()), 'roster.zip')
      .expect(202);
    const dry = await waitRun((preview.body as RunBody).id);
    expect(dry.status).toBe('done');
    expect(dry.dryRun).toBe(true);
    expect(dry.summary?.users.created).toBe(4);
    expect(dry.summary?.students.created).toBe(2);
    expect(dry.summary?.classes.created).toBe(1);
    expect(dry.summary?.enrollments.created).toBe(2);
    expect(
      await prisma.student.count({
        where: { organizationId, externalId: 's1' },
      }),
    ).toBe(0);

    const run = await waitRun(
      (
        (
          await request(server)
            .post(`/api/v1/organizations/${organizationId}/roster/import`)
            .set(as('principal'))
            .attach('files', Buffer.from(sampleZip()), 'roster.zip')
            .expect(202)
        ).body as RunBody
      ).id,
    );
    expect(run.status).toBe('done');
    expect(run.summary?.users.created).toBe(4);
    expect(run.summary?.guardians.created).toBe(2);
    expect(run.summary?.teachers.created).toBe(1);
    const klass = await prisma.class.findFirstOrThrow({
      where: { organizationId, externalId: 'k1' },
      include: { enrollments: true, teachers: true, course: true },
    });
    expect(klass).toMatchObject({
      name: 'Math 7 - Period 3',
      term: 'Fall 2026',
      periodLabel: '3',
      managedBySis: true,
    });
    expect(klass.enrollments).toHaveLength(2);
    expect(klass.course.courseCode).toBe('MATH7');
    const avery = await prisma.student.findFirstOrThrow({
      where: { organizationId, externalId: 's1' },
    });
    expect(avery).toMatchObject({
      studentNumber: 'S2001',
      gradeLevel: '7',
      managedBySis: true,
    });
    expect(avery.userId).toBeTruthy();
    expect(avery.dateOfBirth?.toISOString().slice(0, 10)).toBe('2013-04-02');
  });

  it('is idempotent and drops enrolments that leave the feed', async () => {
    const again = await waitRun(
      (
        (
          await request(server)
            .post(`/api/v1/organizations/${organizationId}/roster/import`)
            .set(as('principal'))
            .attach('files', Buffer.from(sampleZip()), 'roster.zip')
            .expect(202)
        ).body as RunBody
      ).id,
    );
    expect(again.summary?.users.created).toBe(0);
    expect(again.summary?.students.created).toBe(0);
    expect(again.summary?.classes.updated).toBe(1);
    expect(again.summary?.enrollments.created).toBe(0);
    const files: Record<string, string> = { ...SAMPLE_BUNDLE };
    files['enrollments.csv'] = files['enrollments.csv']
      .split('\n')
      .filter((l) => !l.startsWith('e3,'))
      .join('\n');
    const { zipSync } = await import('fflate');
    const smaller = zipSync(
      Object.fromEntries(
        Object.entries(files).map(([k, v]) => [k, new TextEncoder().encode(v)]),
      ),
    );
    const dropped = await waitRun(
      (
        (
          await request(server)
            .post(`/api/v1/organizations/${organizationId}/roster/import`)
            .set(as('principal'))
            .attach('files', Buffer.from(smaller), 'roster.zip')
            .expect(202)
        ).body as RunBody
      ).id,
    );
    expect(dropped.summary?.enrollments.dropped).toBe(1);
    const blake = await prisma.student.findFirstOrThrow({
      where: { organizationId, externalId: 's2' },
    });
    const enrolment = await prisma.classEnrollment.findFirstOrThrow({
      where: { studentId: blake.id },
    });
    expect(enrolment.status).toBe('DROPPED');
  });

  it('refuses manual edits to managed records and reports bundle problems', async () => {
    const avery = await prisma.student.findFirstOrThrow({
      where: { organizationId, externalId: 's1' },
    });
    const res = await request(server)
      .patch(`/api/v1/students/${avery.id}`)
      .set(as('principal'))
      .send({ firstName: 'Changed' })
      .expect(409);
    expect((res.body as Problem).code).toBe('record.managed');
    await request(server)
      .patch(`/api/v1/students/${avery.id}`)
      .set(as('principal'))
      .send({ notes: 'Prefers the front row' })
      .expect(200);
    const klass = await prisma.class.findFirstOrThrow({
      where: { organizationId, externalId: 'k1' },
    });
    await request(server)
      .post(`/api/v1/classes/${klass.id}/enrollments`)
      .set(as('principal'))
      .send({ studentIds: [avery.id] })
      .expect(409);
    const bad = await request(server)
      .post(`/api/v1/organizations/${organizationId}/roster/import?dryRun=true`)
      .set(as('principal'))
      .attach('files', Buffer.from('sourcedId\nx\n'), 'users.csv')
      .expect(400);
    expect((bad.body as Problem).code).toBe('roster.invalid_bundle');
    await request(server)
      .get(`/api/v1/organizations/${organizationId}/roster/runs`)
      .set(as('teacher'))
      .expect(403);
  });

  it('stores roster sources with encrypted secrets and never returns them', async () => {
    const created = await request(server)
      .post(`/api/v1/organizations/${organizationId}/roster/sources`)
      .set(as('principal'))
      .send({
        provider: 'oneroster_api',
        name: 'District SIS',
        config: {
          baseUrl: 'https://sis.example.org',
          tokenUrl: 'https://sis.example.org/oauth/token',
          clientId: 'abc',
          clientSecret: 'top-secret',
        },
      })
      .expect(201);
    const body = created.body as { id: string; config: Record<string, string> };
    expect(body.config.clientSecret).toBe('••••••••');
    const stored = await prisma.rosterSource.findUniqueOrThrow({
      where: { id: body.id },
    });
    expect(stored.config).not.toContain('top-secret');
    expect(stored.config).toContain('enc:');
    await request(server)
      .post(`/api/v1/organizations/${organizationId}/roster/sources`)
      .set(as('principal'))
      .send({ provider: 'clever', name: 'x', config: {} })
      .expect(400);
    await request(server)
      .delete(
        `/api/v1/organizations/${organizationId}/roster/sources/${body.id}`,
      )
      .set(as('principal'))
      .expect(204);
  });

  it('signs a rostered teacher in with Google once the school allows the domain, and refuses others', async () => {
    const providers = await request(server)
      .get('/api/v1/auth/sso/providers')
      .expect(200);
    expect(
      (providers.body as { data: Array<{ id: string }> }).data.map((p) => p.id),
    ).toContain('google');
    await request(server)
      .put(`/api/v1/organizations/${organizationId}/roster/sso`)
      .set(as('principal'))
      .send({
        providers: ['google'],
        allowedDomains: ['lincoln.example.org'],
        passwordOptional: true,
      })
      .expect(200);

    const start = await request(server)
      .get('/api/v1/auth/sso/google/start?redirect=/classes')
      .expect(302);
    const location = start.headers.location;
    expect(location).toContain(`127.0.0.1:${SSO_STUB_PORT}/o/oauth2/v2/auth`);
    expect(location).toContain('code_challenge_method=S256');
    const stateCookie = (
      start.headers['set-cookie'] as unknown as string[]
    ).find((c) => c.startsWith('ss_sso='));
    expect(stateCookie).toBeTruthy();

    // Follow the provider redirect by hand: the stub answers with a code for the chosen profile.
    idp.nextProfile = {
      sub: 'google-t1',
      email: 'jordan.lee@lincoln.example.org',
      given_name: 'Jordan',
      family_name: 'Lee',
    };
    const idpRes = await fetch(location, { redirect: 'manual' });
    const back = new URL(idpRes.headers.get('location') as string);
    expect(back.pathname).toBe('/api/v1/auth/sso/google/callback');

    const callback = await request(server)
      .get(
        `/api/v1/auth/sso/google/callback?code=${back.searchParams.get('code')}&state=${back.searchParams.get('state')}`,
      )
      .set('Cookie', stateCookie as string)
      .expect(302);
    expect(callback.headers.location).toContain(
      '/sso/complete?next=%2Fclasses',
    );
    const refreshCookie = (
      callback.headers['set-cookie'] as unknown as string[]
    ).find((c) => c.startsWith('ss_refresh='));
    expect(refreshCookie).toBeTruthy();
    const refreshed = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie as string)
      .set('X-Requested-With', 'SmartSchool')
      .send({})
      .expect(200);
    const me = await request(server)
      .get('/api/v1/auth/me')
      .set(
        'Authorization',
        `Bearer ${(refreshed.body as { accessToken: string }).accessToken}`,
      )
      .expect(200);
    expect((me.body as { email: string; role: string }).email).toBe(
      'jordan.lee@lincoln.example.org',
    );
    expect(
      await prisma.userIdentity.count({
        where: { provider: 'GOOGLE', subject: 'google-t1' },
      }),
    ).toBe(1);

    // Unknown person
    idp.nextProfile = {
      sub: 'google-x',
      email: 'stranger@lincoln.example.org',
    };
    const start2 = await request(server)
      .get('/api/v1/auth/sso/google/start')
      .expect(302);
    const back2 = new URL(
      (
        await fetch(start2.headers.location, { redirect: 'manual' })
      ).headers.get('location') as string,
    );
    const unknown = await request(server)
      .get(
        `/api/v1/auth/sso/google/callback?code=${back2.searchParams.get('code')}&state=${back2.searchParams.get('state')}`,
      )
      .set(
        'Cookie',
        (start2.headers['set-cookie'] as unknown as string[]).find((c) =>
          c.startsWith('ss_sso='),
        ) as string,
      )
      .expect(302);
    expect(unknown.headers.location).toContain('/login?error=sso_unknown');

    // Right person, wrong domain for the school's rule
    idp.nextProfile = {
      sub: 'google-demo',
      email: 'teacher@smartschool.local',
    };
    const start3 = await request(server)
      .get('/api/v1/auth/sso/google/start')
      .expect(302);
    const back3 = new URL(
      (
        await fetch(start3.headers.location, { redirect: 'manual' })
      ).headers.get('location') as string,
    );
    const notAllowed = await request(server)
      .get(
        `/api/v1/auth/sso/google/callback?code=${back3.searchParams.get('code')}&state=${back3.searchParams.get('state')}`,
      )
      .set(
        'Cookie',
        (start3.headers['set-cookie'] as unknown as string[]).find((c) =>
          c.startsWith('ss_sso='),
        ) as string,
      )
      .expect(302);
    expect(notAllowed.headers.location).toContain(
      '/login?error=sso_not_allowed',
    );

    // Tampered or missing state
    const bad = await request(server)
      .get('/api/v1/auth/sso/google/callback?code=x&state=y')
      .expect(302);
    expect(bad.headers.location).toContain('/login?error=sso_state');
  });
});
