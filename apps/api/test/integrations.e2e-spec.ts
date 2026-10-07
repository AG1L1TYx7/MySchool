import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { strFromU8, unzipSync } from 'fflate';
import {
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
  verify as cryptoVerify,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AI_STUB_PORT, AI_STUB_TOKEN } from './ai-env';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { PrismaService } from '../src/infra/prisma/prisma.service';
import {
  LTI_CLAIM,
  verifyWebhookSignature,
} from '../src/modules/integrations/integration-rules';
import { WebhooksService } from '../src/modules/integrations/webhooks.service';
import { startAiStub } from './ai-stub';

interface Problem {
  code: string;
}
interface Webhook {
  id: string;
  secret?: string;
  isActive: boolean;
  events: string[];
}
interface Delivery {
  id: string;
  eventType: string;
  status: string;
  attempts: number;
  responseCode: number | null;
}
interface Received {
  path: string;
  headers: Record<string, string>;
  body: string;
}
/** supertest does not buffer binary bodies on its own. */
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
const b64 = (v: Buffer | string) => Buffer.from(v).toString('base64url');

/**
 * Integrations (slice 21): webhooks with signatures and retries, API keys with scopes and budgets,
 * LTI 1.3 as a tool and as a platform, exports for Canvas and Google Classroom, the audit export.
 */
describe('Integrations (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  let stub: Awaited<ReturnType<typeof startAiStub>>;
  const tokens: Record<string, string> = {};
  const stamp = Date.now();
  let orgId = '';
  let classId = '';
  let teacherId = '';

  // A receiver for webhooks and a JWKS endpoint for the pretend platform, on one local server.
  const received: Received[] = [];
  let local: Server;
  let localBase = '';
  let platformKey: { privateKey: KeyObject; jwk: JsonWebKey };

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
  const signWith = (
    key: KeyObject,
    kid: string,
    claims: Record<string, unknown>,
  ) => {
    const h = b64(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
    const p = b64(JSON.stringify(claims));
    return `${h}.${p}.${b64(cryptoSign('sha256', Buffer.from(`${h}.${p}`), key))}`;
  };

  beforeAll(async () => {
    stub = await startAiStub(AI_STUB_TOKEN, AI_STUB_PORT);
    const pair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    platformKey = {
      privateKey: pair.privateKey,
      jwk: {
        ...pair.publicKey.export({ format: 'jwk' }),
        kid: 'platform-k1',
        alg: 'RS256',
        use: 'sig',
      },
    };
    local = createServer((req: IncomingMessage, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const path = req.url ?? '/';
        if (path === '/jwks') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ keys: [platformKey.jwk] }));
          return;
        }
        received.push({
          path,
          headers: Object.fromEntries(
            Object.entries(req.headers).map(([k, v]) => [k, String(v)]),
          ),
          body: Buffer.concat(chunks).toString('utf8'),
        });
        res.statusCode = path.startsWith('/fail') ? 500 : 200;
        res.end('ok');
      });
    });
    await new Promise<void>((r) => local.listen(0, '127.0.0.1', r));
    localBase = `http://127.0.0.1:${(local.address() as AddressInfo).port}`;

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
      ['principal', 'teacher', 'student', 'superadmin'].map((r) => login(r)),
    );
    const klass = await prisma.class.findFirstOrThrow({
      where: { name: 'English 7 - Section A', deletedAt: null },
    });
    orgId = klass.organizationId;
    classId = klass.id;
    teacherId = (
      await prisma.user.findFirstOrThrow({
        where: { email: 'teacher@smartschool.local' },
      })
    ).id;
  });

  afterAll(async () => {
    await app?.close();
    stub.server.close();
    await new Promise<void>((r) => local.close(() => r()));
  });

  // ---------------------------------------------------------------------------
  // Webhooks
  // ---------------------------------------------------------------------------

  let webhookId = '';
  let webhookSecret = '';

  it('creates a webhook (secret shown once), refuses teachers and plain http elsewhere', async () => {
    await request(server)
      .post(`/api/v1/organizations/${orgId}/webhooks`)
      .set(as('teacher'))
      .send({ name: 'x', url: `${localBase}/ok` })
      .expect(403);
    const bad = await request(server)
      .post(`/api/v1/organizations/${orgId}/webhooks`)
      .set(as('principal'))
      .send({ name: 'SIS', url: 'http://sis.example.org/hook' })
      .expect(400);
    expect((bad.body as Problem).code).toBe('request.invalid');
    const res = await request(server)
      .post(`/api/v1/organizations/${orgId}/webhooks`)
      .set(as('principal'))
      .send({
        name: `SIS ${stamp}`,
        url: `${localBase}/ok`,
        events: ['assignment.', 'grade.posted'],
      })
      .expect(201);
    const w = res.body as Webhook;
    expect(w.secret).toMatch(/^whsec_[0-9a-f]{48}$/);
    webhookId = w.id;
    webhookSecret = w.secret ?? '';
    const list = await request(server)
      .get(`/api/v1/organizations/${orgId}/webhooks`)
      .set(as('principal'))
      .expect(200);
    const mine = (list.body as Webhook[]).find((x) => x.id === webhookId);
    expect(mine).toBeDefined();
    expect(mine?.secret).toBeUndefined();
    const types = await request(server)
      .get(`/api/v1/organizations/${orgId}/webhooks/event-types`)
      .set(as('principal'))
      .expect(200);
    expect((types.body as { eventTypes: string[] }).eventTypes).toContain(
      'grade.posted',
    );
  });

  it('delivers a test event with a signature the receiver can verify', async () => {
    received.length = 0;
    const res = await request(server)
      .post(`/api/v1/organizations/${orgId}/webhooks/${webhookId}/test`)
      .set(as('principal'))
      .expect(201);
    expect(res.body).toMatchObject({ status: 'delivered', responseCode: 200 });
    expect(received).toHaveLength(1);
    const r = received[0];
    expect(r.headers['x-webhook-event']).toBe('webhook.test');
    expect(
      verifyWebhookSignature(
        webhookSecret,
        r.headers['x-webhook-timestamp'],
        r.body,
        r.headers['x-webhook-signature'],
      ),
    ).toBe(true);
    expect(
      verifyWebhookSignature(
        'wrong',
        r.headers['x-webhook-timestamp'],
        r.body,
        r.headers['x-webhook-signature'],
      ),
    ).toBe(false);
    expect(JSON.parse(r.body)).toMatchObject({
      eventType: 'webhook.test',
      organizationId: orgId,
    });
  });

  it('turns a domain event into a delivery and posts it on the next pass', async () => {
    received.length = 0;
    const created = await request(server)
      .post('/api/v1/assignments')
      .set(as('teacher'))
      .send({
        classId,
        title: `Webhook essay ${stamp}`,
        maxPoints: 10,
        dueAt: '2027-01-01T00:00:00Z',
      })
      .expect(201);
    const assignmentId = (created.body as { id: string }).id;
    const row = await until(
      () =>
        prisma.webhookDelivery.findFirst({
          where: { subscriptionId: webhookId, eventType: 'assignment.created' },
        }),
      (v) => v !== null,
    );
    expect(row?.status).toBe('pending');
    const sent = await app.get(WebhooksService).deliverDue();
    expect(sent).toBeGreaterThanOrEqual(1);
    const hit = received.find(
      (r) => r.headers['x-webhook-event'] === 'assignment.created',
    );
    expect(hit).toBeDefined();
    expect(JSON.parse(hit?.body ?? '{}')).toMatchObject({
      entityId: assignmentId,
      entityType: 'Assignment',
    });
    const deliveries = await request(server)
      .get(`/api/v1/organizations/${orgId}/webhooks/${webhookId}/deliveries`)
      .set(as('principal'))
      .expect(200);
    const rows = (deliveries.body as { data: Delivery[] }).data;
    expect(rows.find((d) => d.eventType === 'assignment.created')?.status).toBe(
      'delivered',
    );
    // Events outside the filter never queue.
    expect(
      rows.find((d) => d.eventType === 'announcement.published'),
    ).toBeUndefined();
  });

  it('backs off on failure and gives up after the retry limit', async () => {
    const res = await request(server)
      .post(`/api/v1/organizations/${orgId}/webhooks`)
      .set(as('principal'))
      .send({ name: `Flaky ${stamp}`, url: `${localBase}/fail`, retryLimit: 1 })
      .expect(201);
    const id = (res.body as Webhook).id;
    const first = await request(server)
      .post(`/api/v1/organizations/${orgId}/webhooks/${id}/test`)
      .set(as('principal'))
      .expect(201);
    expect(first.body).toMatchObject({
      status: 'pending',
      attempts: 1,
      responseCode: 500,
    });
    const row = await prisma.webhookDelivery.findFirstOrThrow({
      where: { subscriptionId: id },
    });
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 30_000);
    await prisma.webhookDelivery.update({
      where: { id: row.id },
      data: { nextAttemptAt: new Date(Date.now() - 1000) },
    });
    await app.get(WebhooksService).deliverDue();
    const after = await prisma.webhookDelivery.findUniqueOrThrow({
      where: { id: row.id },
    });
    expect(after).toMatchObject({ status: 'failed', attempts: 2 });
    await request(server)
      .patch(`/api/v1/organizations/${orgId}/webhooks/${id}`)
      .set(as('principal'))
      .send({ isActive: false })
      .expect(200);
    await request(server)
      .delete(`/api/v1/organizations/${orgId}/webhooks/${id}`)
      .set(as('principal'))
      .expect(204);
  });

  // ---------------------------------------------------------------------------
  // API keys
  // ---------------------------------------------------------------------------

  let apiKey = '';
  let apiKeyId = '';

  it('creates a key shown once and lets it read only within its scopes', async () => {
    await request(server)
      .post(`/api/v1/organizations/${orgId}/api-keys`)
      .set(as('teacher'))
      .send({ name: 'x', scopes: ['students.view'] })
      .expect(403);
    const bad = await request(server)
      .post(`/api/v1/organizations/${orgId}/api-keys`)
      .set(as('principal'))
      .send({ name: 'x', scopes: ['users.manage'] })
      .expect(400);
    expect((bad.body as Problem).code).toBe('validation.failed');
    const res = await request(server)
      .post(`/api/v1/organizations/${orgId}/api-keys`)
      .set(as('principal'))
      .send({
        name: `Warehouse ${stamp}`,
        scopes: ['students.view', 'classes.view'],
        rateLimitPerMinute: 12,
      })
      .expect(201);
    const k = res.body as {
      id: string;
      key: string;
      prefix: string;
      scopes: string[];
    };
    expect(k.key).toMatch(/^ssk_[0-9a-f]{12}_/);
    apiKey = k.key;
    apiKeyId = k.id;
    const list = await request(server)
      .get(`/api/v1/organizations/${orgId}/api-keys`)
      .set(as('principal'))
      .expect(200);
    expect(JSON.stringify(list.body)).not.toContain(apiKey);

    const students = await request(server)
      .get('/api/v1/students?pageSize=5')
      .set('X-Api-Key', apiKey)
      .expect(200);
    const data = (students.body as { data: Array<{ organizationId: string }> })
      .data;
    expect(data.length).toBeGreaterThan(0);
    expect(data.every((s) => s.organizationId === orgId)).toBe(true);

    const outside = await request(server)
      .get(`/api/v1/classes/${classId}/gradebook`)
      .set('X-Api-Key', apiKey)
      .expect(403);
    expect((outside.body as Problem).code).toBe('apikey.scope');
    const bogus = await request(server)
      .get('/api/v1/students')
      .set('X-Api-Key', 'ssk_000000000000_abcdefghijklmnopqrstuvwxyz')
      .expect(401);
    expect((bogus.body as Problem).code).toBe('auth.api_key_invalid');
  });

  it('enforces the per-minute budget and revocation', async () => {
    let limited: Problem | null = null;
    for (let i = 0; i < 14; i += 1) {
      const r = await request(server)
        .get('/api/v1/classes?pageSize=1')
        .set('X-Api-Key', apiKey);
      if (r.status === 429) {
        limited = r.body as Problem;
        break;
      }
    }
    expect(limited?.code).toBe('rate_limited');
    await request(server)
      .delete(`/api/v1/organizations/${orgId}/api-keys/${apiKeyId}`)
      .set(as('principal'))
      .expect(200);
    const revoked = await request(server)
      .get('/api/v1/students')
      .set('X-Api-Key', apiKey)
      .expect(401);
    expect((revoked.body as Problem).code).toBe('auth.api_key_revoked');
  });

  // ---------------------------------------------------------------------------
  // LTI 1.3: SmartSchool as a tool
  // ---------------------------------------------------------------------------

  const ISSUER = `https://canvas-${stamp}.test`;
  let launchNonce = '';
  let launchState = '';
  let stateCookie = '';

  it('registers a platform, answers the login initiation with a redirect and a state cookie', async () => {
    await request(server)
      .post(`/api/v1/organizations/${orgId}/lti/platforms`)
      .set(as('principal'))
      .send({
        name: 'Canvas test',
        issuer: ISSUER,
        clientId: 'client-1',
        deploymentId: 'dep-1',
        authorizationUrl: `${ISSUER}/api/lti/authorize_redirect`,
        jwksUrl: `${localBase}/jwks`,
      })
      .expect(201);
    const res = await request(server)
      .get('/api/v1/lti/login')
      .query({
        iss: ISSUER,
        login_hint: 'abc',
        client_id: 'client-1',
        target_link_uri:
          'http://localhost:5000/api/v1/lti/launch?path=%2Fassignments',
      })
      .expect(302);
    const location = new URL(res.headers.location);
    expect(location.origin + location.pathname).toBe(
      `${ISSUER}/api/lti/authorize_redirect`,
    );
    expect(location.searchParams.get('response_mode')).toBe('form_post');
    expect(location.searchParams.get('redirect_uri')).toBe(
      'http://localhost:5000/api/v1/lti/launch',
    );
    launchNonce = location.searchParams.get('nonce') ?? '';
    launchState = location.searchParams.get('state') ?? '';
    const setCookie = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    stateCookie = setCookie.find((c) => c.startsWith('ss_lti=')) ?? '';
    expect(stateCookie).toContain('HttpOnly');
    const unknown = await request(server)
      .get('/api/v1/lti/login')
      .query({
        iss: 'https://nobody.test',
        login_hint: 'a',
        target_link_uri: 'x',
      })
      .expect(302);
    expect(unknown.headers.location).toContain('error=lti_unknown_platform');
  });

  const claimsFor = (over: Record<string, unknown>) => {
    const sec = Math.floor(Date.now() / 1000);
    return {
      iss: ISSUER,
      aud: 'client-1',
      sub: `sub-${stamp}`,
      exp: sec + 300,
      iat: sec,
      nonce: launchNonce,
      email: 'teacher@smartschool.local',
      given_name: 'Taylor',
      family_name: 'Brooks',
      [`${LTI_CLAIM}message_type`]: 'LtiResourceLinkRequest',
      [`${LTI_CLAIM}version`]: '1.3.0',
      [`${LTI_CLAIM}deployment_id`]: 'dep-1',
      [`${LTI_CLAIM}roles`]: [
        'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
      ],
      [`${LTI_CLAIM}target_link_uri`]:
        'http://localhost:5000/api/v1/lti/launch?path=%2Fassignments',
      [`${LTI_CLAIM}context`]: { id: 'canvas-course-1', title: 'Period 2' },
      ...over,
    };
  };

  it('signs the teacher in from a valid launch and refuses a replay or a bad signature', async () => {
    const idToken = signWith(
      platformKey.privateKey,
      'platform-k1',
      claimsFor({}),
    );
    const res = await request(server)
      .post('/api/v1/lti/launch')
      .set('Cookie', stateCookie.split(';')[0])
      .type('form')
      .send({ id_token: idToken, state: launchState })
      .expect(302);
    expect(res.headers.location).toBe(
      'http://localhost:3000/sso/complete?next=%2Fassignments',
    );
    const cookies = ([] as string[]).concat(res.headers['set-cookie'] ?? []);
    expect(cookies.some((c) => c.startsWith('ss_refresh='))).toBe(true);
    const link = await prisma.ltiUserLink.findFirst({
      where: { subject: `sub-${stamp}` },
    });
    expect(link?.userId).toBe(teacherId);

    const replay = await request(server)
      .post('/api/v1/lti/launch')
      .set('Cookie', stateCookie.split(';')[0])
      .type('form')
      .send({ id_token: idToken, state: launchState })
      .expect(302);
    expect(replay.headers.location).toContain('error=lti_replay');

    const other = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const forged = signWith(
      other.privateKey,
      'platform-k1',
      claimsFor({ nonce: 'fresh' }),
    );
    const bad = await request(server)
      .post('/api/v1/lti/launch')
      .set('Cookie', stateCookie.split(';')[0])
      .type('form')
      .send({ id_token: forged, state: launchState })
      .expect(302);
    expect(bad.headers.location).toContain('error=lti_signature');
    const noCookie = await request(server)
      .post('/api/v1/lti/launch')
      .type('form')
      .send({ id_token: idToken, state: launchState })
      .expect(302);
    expect(noCookie.headers.location).toContain('error=lti_state');
  });

  it('creates a learner account on first launch when the platform sends a new person', async () => {
    const start = await request(server)
      .get('/api/v1/lti/login')
      .query({
        iss: ISSUER,
        login_hint: 'learner',
        target_link_uri: 'http://localhost:5000/api/v1/lti/launch',
      })
      .expect(302);
    const loc = new URL(start.headers.location);
    const cookie = (
      ([] as string[])
        .concat(start.headers['set-cookie'] ?? [])
        .find((c) => c.startsWith('ss_lti=')) ?? ''
    ).split(';')[0];
    const email = `learner-${stamp}@school.test`;
    const idToken = signWith(
      platformKey.privateKey,
      'platform-k1',
      claimsFor({
        nonce: loc.searchParams.get('nonce'),
        sub: `learner-${stamp}`,
        email,
        given_name: 'Lee',
        family_name: 'Learner',
        [`${LTI_CLAIM}roles`]: [
          'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
        ],
        [`${LTI_CLAIM}target_link_uri`]:
          'http://localhost:5000/api/v1/lti/launch',
      }),
    );
    const res = await request(server)
      .post('/api/v1/lti/launch')
      .set('Cookie', cookie)
      .type('form')
      .send({ id_token: idToken, state: loc.searchParams.get('state') })
      .expect(302);
    expect(res.headers.location).toBe(
      'http://localhost:3000/sso/complete?next=%2Fdashboard',
    );
    const user = await prisma.user.findFirstOrThrow({ where: { email } });
    expect(user).toMatchObject({ role: 'STUDENT', organizationId: orgId });
    expect(
      await prisma.student.findFirst({ where: { userId: user.id } }),
    ).not.toBeNull();
  });

  it('publishes its key set and a tool configuration', async () => {
    const jwks = await request(server).get('/api/v1/lti/jwks').expect(200);
    const keys = (jwks.body as { keys: JsonWebKey[] }).keys;
    expect(keys[0]).toMatchObject({ kty: 'RSA', alg: 'RS256', use: 'sig' });
    const cfg = await request(server)
      .get(`/api/v1/lti/config.json?organizationId=${orgId}`)
      .expect(200);
    expect(cfg.body).toMatchObject({
      oidc_initiation_url: 'http://localhost:5000/api/v1/lti/login',
      public_jwk_url: 'http://localhost:5000/api/v1/lti/jwks',
    });
  });

  // ---------------------------------------------------------------------------
  // LTI 1.3: SmartSchool as a platform
  // ---------------------------------------------------------------------------

  it('launches an external tool and signs an id_token the tool can verify with our JWKS', async () => {
    const created = await request(server)
      .post(`/api/v1/organizations/${orgId}/lti/tools`)
      .set(as('principal'))
      .send({
        name: `Graphing ${stamp}`,
        loginUrl: 'https://tool.test/login',
        launchUrl: 'https://tool.test/launch',
        customParams: { theme: 'light' },
      })
      .expect(201);
    const tool = created.body as {
      id: string;
      platform: {
        clientId: string;
        deploymentId: string;
        issuer: string;
        authorizationUrl: string;
      };
    };
    expect(tool.platform.authorizationUrl).toBe(
      'http://localhost:5000/api/v1/lti/platform/auth',
    );
    const listed = await request(server)
      .get(`/api/v1/classes/${classId}/lti-tools`)
      .set(as('student'))
      .expect(200);
    expect((listed.body as Array<{ id: string }>).map((t) => t.id)).toContain(
      tool.id,
    );

    const page = await request(server)
      .get(
        `/api/v1/organizations/${orgId}/lti/tools/${tool.id}/launch?classId=${classId}`,
      )
      .set(as('teacher'))
      .expect(200);
    expect(page.headers['content-type']).toContain('text/html');
    expect(page.text).toContain('action="https://tool.test/login"');
    const hint =
      /name="lti_message_hint" value="([^"]+)"/.exec(page.text)?.[1] ?? '';
    expect(hint).not.toBe('');

    const auth = await request(server)
      .get('/api/v1/lti/platform/auth')
      .query({
        scope: 'openid',
        response_type: 'id_token',
        client_id: tool.platform.clientId,
        redirect_uri: 'https://tool.test/launch',
        login_hint: teacherId,
        nonce: 'nonce-1',
        state: 'state-1',
        lti_message_hint: hint,
      })
      .expect(200);
    expect(auth.text).toContain('action="https://tool.test/launch"');
    expect(auth.text).toContain('name="state" value="state-1"');
    const idToken =
      /name="id_token" value="([^"]+)"/.exec(auth.text)?.[1] ?? '';
    const [h, p, s] = idToken.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString()) as {
      kid: string;
      alg: string;
    };
    const jwks = await request(server).get('/api/v1/lti/jwks').expect(200);
    const jwk = (jwks.body as { keys: JsonWebKey[] }).keys.find(
      (k) => k.kid === header.kid,
    );
    expect(jwk).toBeDefined();
    expect(
      cryptoVerify(
        'sha256',
        Buffer.from(`${h}.${p}`),
        createPublicKey({ key: jwk as JsonWebKey, format: 'jwk' }),
        Buffer.from(s, 'base64url'),
      ),
    ).toBe(true);
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    expect(claims).toMatchObject({
      iss: 'http://localhost:5000',
      aud: tool.platform.clientId,
      sub: teacherId,
      nonce: 'nonce-1',
    });
    expect(claims[`${LTI_CLAIM}context`]).toMatchObject({ id: classId });
    expect(claims[`${LTI_CLAIM}roles`]).toEqual([
      'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
    ]);
    expect(claims[`${LTI_CLAIM}custom`]).toMatchObject({
      theme: 'light',
      smartschool_class_id: classId,
    });

    await request(server)
      .get('/api/v1/lti/platform/auth')
      .query({
        scope: 'openid',
        response_type: 'id_token',
        client_id: tool.platform.clientId,
        redirect_uri: 'https://evil.test/launch',
        nonce: 'n',
        lti_message_hint: hint,
      })
      .expect(400);
  });

  // ---------------------------------------------------------------------------
  // Exports and the audit trail
  // ---------------------------------------------------------------------------

  it('exports the class for Canvas, Google Classroom and as a Common Cartridge', async () => {
    const canvas = await request(server)
      .get(`/api/v1/classes/${classId}/exports/canvas-gradebook.csv`)
      .set(as('teacher'))
      .expect(200);
    expect(canvas.text.split('\r\n')[0]).toMatch(
      /^Student,ID,SIS User ID,SIS Login ID,Section,/,
    );
    expect(canvas.text.split('\r\n')[1]).toMatch(/^ {4}Points Possible,,,,,/);
    const classroom = await request(server)
      .get(`/api/v1/classes/${classId}/exports/google-classroom.csv`)
      .set(as('teacher'))
      .expect(200);
    expect(classroom.text.split('\r\n')[0]).toMatch(
      /^Last Name,First Name,Email,Overall Grade,/,
    );
    await request(server)
      .get(`/api/v1/classes/${classId}/exports/canvas-gradebook.csv`)
      .set(as('student'))
      .expect(403);

    const zipRes = await request(server)
      .get(`/api/v1/classes/${classId}/exports/common-cartridge.imscc`)
      .set(as('teacher'))
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect(zipRes.headers['content-type']).toContain('application/zip');
    const files = unzipSync(new Uint8Array(zipRes.body as Buffer));
    const manifest = strFromU8(files['imsmanifest.xml']);
    expect(manifest).toContain('<schemaversion>1.3.0</schemaversion>');
    expect(
      Object.keys(files).filter((f) => f.startsWith('resources/')).length,
    ).toBeGreaterThan(0);
    await request(server)
      .get(`/api/v1/classes/${classId}/exports/common-cartridge.imscc`)
      .set(as('student'))
      .expect(403);
  });

  it('exports the audit trail as CSV for administrators', async () => {
    const res = await request(server)
      .get('/api/v1/audit-logs/export.csv?action=webhooks.')
      .set(as('superadmin'))
      .expect(200);
    expect(res.headers['content-type']).toContain('text/csv');
    const lines = res.text.split('\r\n');
    expect(lines[0]).toBe(
      'Timestamp,Action,User,Organization,Entity type,Entity id,Method,Path,Status,IP,Trace,Details',
    );
    expect(lines.some((l) => l.includes('webhooks.create'))).toBe(true);
    await request(server)
      .get('/api/v1/audit-logs/export.csv')
      .set(as('teacher'))
      .expect(403);
  });
});
