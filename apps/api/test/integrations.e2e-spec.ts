import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { strFromU8, unzipSync } from 'fflate';
import {
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
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
  LTI_AGS_CLAIM,
  LTI_CLAIM,
  LTI_DL_CLAIM,
  LTI_NRPS_CLAIM,
  LTI_SCOPE,
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
  eventId: string;
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
  let ltiClassId = '';
  let toolKey: { privateKey: KeyObject; jwk: JsonWebKey & { kid: string } };
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
    const toolPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    toolKey = {
      privateKey: toolPair.privateKey,
      jwk: {
        ...toolPair.publicKey.export({ format: 'jwk' }),
        kid: 'tool-k1',
        alg: 'RS256',
        use: 'sig',
      },
    };
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
        if (path === '/tool-jwks') {
          res.setHeader('content-type', 'application/json');
          res.end(JSON.stringify({ keys: [toolKey.jwk] }));
          return;
        }
        // The platform's token endpoint and Names and Roles container (slice 30).
        if (path === '/token') {
          received.push({
            path,
            headers: {},
            body: Buffer.concat(chunks).toString('utf8'),
          });
          res.setHeader('content-type', 'application/json');
          res.end(
            JSON.stringify({
              access_token: 'tok-1',
              token_type: 'Bearer',
              expires_in: 3600,
            }),
          );
          return;
        }
        if (path.startsWith('/memberships')) {
          received.push({
            path,
            headers: { authorization: String(req.headers.authorization ?? '') },
            body: '',
          });
          res.setHeader(
            'content-type',
            'application/vnd.ims.lti-nrps.v2.membershipcontainer+json',
          );
          if (!path.includes('page=2'))
            res.setHeader(
              'link',
              `<${localBase}/memberships?page=2>; rel="next"`,
            );
          res.end(
            JSON.stringify(membershipPage(path.includes('page=2') ? 2 : 1)),
          );
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
          where: {
            subscriptionId: webhookId,
            eventType: 'assignment.created',
            payload: { contains: assignmentId },
          },
        }),
      (v) => v !== null,
    );
    expect(row?.status).toBe('pending');
    // The pass drains the shared queue in batches (other app instances of a parallel run add to it and may
    // even post this row themselves), so drain and poll until this delivery is marked delivered.
    const delivered = await until(
      async () => {
        await app.get(WebhooksService).deliverDue();
        const res = await request(server)
          .get(
            `/api/v1/organizations/${orgId}/webhooks/${webhookId}/deliveries?pageSize=100`,
          )
          .set(as('principal'));
        return (
          (res.body as { data: Delivery[] }).data.find(
            (d) => d.eventId === row?.eventId,
          ) ?? null
        );
      },
      (v) => v?.status === 'delivered',
      30_000,
    );
    expect(delivered?.status).toBe('delivered');
    const hit = received.find(
      (r) =>
        r.headers['x-webhook-event'] === 'assignment.created' &&
        (JSON.parse(r.body) as { entityId: string }).entityId === assignmentId,
    );
    expect(hit).toBeDefined();
    expect(JSON.parse(hit?.body ?? '{}')).toMatchObject({
      entityId: assignmentId,
      entityType: 'Assignment',
    });
    const deliveries = await request(server)
      .get(
        `/api/v1/organizations/${orgId}/webhooks/${webhookId}/deliveries?pageSize=100`,
      )
      .set(as('principal'))
      .expect(200);
    const rows = (deliveries.body as { data: Delivery[] }).data;
    // Events outside the filter never queue.
    expect(
      rows.find((d) => d.eventType === 'announcement.published'),
    ).toBeUndefined();
  }, 120_000);

  it('backs off on failure and gives up after the retry limit', async () => {
    const res = await request(server)
      .post(`/api/v1/organizations/${orgId}/webhooks`)
      .set(as('principal'))
      .send({
        name: `Flaky ${stamp}`,
        events: ['lesson.completed'],
        url: `${localBase}/fail`,
        retryLimit: 1,
      })
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
      where: { subscriptionId: id, eventType: 'webhook.test' },
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
  const membershipPage = (page: number) => ({
    id: `${localBase}/memberships`,
    context: { id: 'canvas-course-1', title: 'Period 2' },
    members:
      page === 1
        ? [
            {
              user_id: `sub-${stamp}`,
              roles: [
                'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor',
              ],
              email: 'teacher@smartschool.local',
              given_name: 'Taylor',
              family_name: 'Brooks',
            },
            {
              user_id: `nrps-a-${stamp}`,
              roles: [
                'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
              ],
              email: `nrps-a-${stamp}@school.test`,
              given_name: 'Ana',
              family_name: 'Roster',
            },
          ]
        : [
            {
              user_id: `nrps-b-${stamp}`,
              roles: [
                'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
              ],
              email: `nrps-b-${stamp}@school.test`,
              given_name: 'Ben',
              family_name: 'Roster',
            },
            {
              user_id: `nrps-gone-${stamp}`,
              roles: [
                'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner',
              ],
              status: 'Inactive',
            },
          ],
  });
  const launchAs = async (claims: Record<string, unknown>) => {
    const start = await request(server)
      .get('/api/v1/lti/login')
      .query({
        iss: ISSUER,
        login_hint: 'x',
        client_id: 'client-1',
        target_link_uri: 'http://localhost:5000/api/v1/lti/launch',
      })
      .expect(302);
    const loc = new URL(start.headers.location);
    const cookie = (
      ([] as string[])
        .concat(start.headers['set-cookie'] ?? [])
        .find((c) => c.startsWith('ss_lti=')) ?? ''
    ).split(';')[0];
    const idToken = signWith(
      platformKey.privateKey,
      'platform-k1',
      claimsFor({ nonce: loc.searchParams.get('nonce'), ...claims }),
    );
    return request(server)
      .post('/api/v1/lti/launch')
      .set('Cookie', cookie)
      .type('form')
      .send({ id_token: idToken, state: loc.searchParams.get('state') })
      .expect(302);
  };
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

  it('remembers the course and its services at launch, links it to a class and fills the class from Names and Roles', async () => {
    const platform = await prisma.ltiPlatform.findFirstOrThrow({
      where: { issuer: ISSUER },
    });
    await request(server)
      .patch(`/api/v1/organizations/${orgId}/lti/platforms/${platform.id}`)
      .set(as('principal'))
      .send({ tokenUrl: `${localBase}/token` })
      .expect(200);
    const res = await launchAs({
      [LTI_NRPS_CLAIM]: {
        context_memberships_url: `${localBase}/memberships`,
        service_versions: ['2.0'],
      },
      [LTI_AGS_CLAIM]: {
        scope: [LTI_SCOPE.score, LTI_SCOPE.memberships],
        lineitems: `${localBase}/lineitems`,
      },
    });
    expect(res.headers.location).toContain('/sso/complete');
    const contexts = (
      await request(server)
        .get(
          `/api/v1/organizations/${orgId}/lti/platforms/${platform.id}/contexts`,
        )
        .set(as('principal'))
        .expect(200)
    ).body as Array<{
      id: string;
      contextId: string;
      title: string | null;
      class: unknown;
      services: { memberships: boolean; lineItems: boolean };
    }>;
    const ctx = contexts.find((c) => c.contextId === 'canvas-course-1');
    expect(ctx).toBeDefined();
    expect(ctx!.services).toEqual({ memberships: true, lineItems: true });
    expect(ctx!.title).toBe('Period 2');
    // Teachers cannot manage the link; the principal links the course to a fresh class.
    await request(server)
      .get(
        `/api/v1/organizations/${orgId}/lti/platforms/${platform.id}/contexts`,
      )
      .set(as('teacher'))
      .expect(403);
    await request(server)
      .post(
        `/api/v1/organizations/${orgId}/lti/platforms/${platform.id}/contexts/${ctx!.id}/sync`,
      )
      .set(as('principal'))
      .send({})
      .expect(400);
    const demo = await prisma.class.findUniqueOrThrow({
      where: { id: classId },
    });
    ltiClassId = randomUUID();
    await prisma.class.create({
      data: {
        id: ltiClassId,
        organizationId: orgId,
        courseId: demo.courseId,
        name: `LTI course ${stamp}`,
        term: demo.term,
      },
    });
    const linked = await request(server)
      .patch(
        `/api/v1/organizations/${orgId}/lti/platforms/${platform.id}/contexts/${ctx!.id}`,
      )
      .set(as('principal'))
      .send({ classId: ltiClassId })
      .expect(200);
    expect((linked.body as { class: { id: string } }).class.id).toBe(
      ltiClassId,
    );
    const sync = await request(server)
      .post(
        `/api/v1/organizations/${orgId}/lti/platforms/${platform.id}/contexts/${ctx!.id}/sync`,
      )
      .set(as('principal'))
      .send({})
      .expect(201);
    expect(sync.body).toEqual({
      members: 4,
      users: 3,
      students: 2,
      teachers: 1,
      skipped: 1,
    });
    const tokenCall = received.find((r) => r.path === '/token');
    expect(tokenCall?.body).toContain('grant_type=client_credentials');
    expect(tokenCall?.body).toContain(
      'client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer',
    );
    expect(
      received
        .filter((r) => r.path.startsWith('/memberships'))
        .every((r) => r.headers.authorization === 'Bearer tok-1'),
    ).toBe(true);
    const enrolled = await prisma.classEnrollment.findMany({
      where: { classId: ltiClassId },
      include: { student: { include: { user: true } } },
    });
    expect(enrolled.map((e) => e.student.user?.email).sort()).toEqual([
      `nrps-a-${stamp}@school.test`,
      `nrps-b-${stamp}@school.test`,
    ]);
    expect(enrolled.every((e) => e.source === 'LTI')).toBe(true);
    expect(
      await prisma.classTeacher.count({
        where: { classId: ltiClassId, teacherId },
      }),
    ).toBe(1);
  });

  it('links a deep-linked assignment to its line item and pushes posted grades to the platform', async () => {
    const platform = await prisma.ltiPlatform.findFirstOrThrow({
      where: { issuer: ISSUER },
    });
    const created = await request(server)
      .post('/api/v1/assignments')
      .set(as('teacher'))
      .send({
        classId: ltiClassId,
        title: `LTI graded ${stamp}`,
        maxPoints: 10,
        dueAt: '2027-01-01T00:00:00Z',
      })
      .expect(201);
    const assignmentId = (created.body as { id: string }).id;
    // The platform launches the deep-linked resource: the line item it created arrives in the endpoint claim.
    await launchAs({
      [LTI_AGS_CLAIM]: {
        scope: [LTI_SCOPE.score],
        lineitems: `${localBase}/lineitems`,
        lineitem: `${localBase}/lineitems/42`,
      },
      [`${LTI_CLAIM}custom`]: {
        smartschool_assignment_id: assignmentId,
        smartschool_path: `/assignments/${assignmentId}`,
      },
      [`${LTI_CLAIM}resource_link`]: { id: 'rl-1' },
    });
    const link = await prisma.ltiLineItemLink.findFirstOrThrow({
      where: { assignmentId },
    });
    expect(link.lineItemUrl).toBe(`${localBase}/lineitems/42`);
    // A grade for a learner the platform knows reaches its line item.
    const learner = await prisma.ltiUserLink.findFirstOrThrow({
      where: { platformId: platform.id, subject: `nrps-a-${stamp}` },
      include: { user: { include: { student: true } } },
    });
    const studentId = learner.user.student!.id;
    await prisma.grade.create({
      data: {
        id: randomUUID(),
        assignmentId,
        studentId,
        score: 8.5,
        maxPoints: 10,
        percentage: 85,
      },
    });
    const pushed = await request(server)
      .post(
        `/api/v1/organizations/${orgId}/lti/platforms/${platform.id}/contexts/${link.contextLinkId}/push-scores`,
      )
      .set(as('principal'))
      .send({})
      .expect(201);
    expect(pushed.body).toEqual({ lineItems: 1, grades: 1, pushed: 1 });
    const score = received.find((r) => r.path === '/lineitems/42/scores');
    expect(score).toBeDefined();
    expect(score!.headers['content-type']).toBe(
      'application/vnd.ims.lis.v1.score+json',
    );
    expect(JSON.parse(score!.body)).toMatchObject({
      userId: `nrps-a-${stamp}`,
      scoreGiven: 8.5,
      scoreMaximum: 10,
      gradingProgress: 'FullyGraded',
    });
    expect(
      (
        await prisma.ltiLineItemLink.findUniqueOrThrow({
          where: { id: link.id },
        })
      ).lastPushAt,
    ).not.toBeNull();
  });

  it('answers a deep-linking request with a picker and a signed response the platform can verify', async () => {
    const res = await launchAs({
      [`${LTI_CLAIM}message_type`]: 'LtiDeepLinkingRequest',
      [`${LTI_DL_CLAIM}deep_linking_settings`]: {
        deep_link_return_url: `${localBase}/deep-link-return`,
        accept_types: ['ltiResourceLink'],
        accept_multiple: true,
        data: 'opaque-1',
      },
    });
    const next = new URL(res.headers.location).searchParams.get('next') ?? '';
    expect(next.startsWith('/integrations/lti/deep-link?dl=')).toBe(true);
    const ticket = new URLSearchParams(next.split('?')[1]).get('dl') ?? '';
    const picker = await request(server)
      .get(`/api/v1/lti/deep-link/${ticket}`)
      .set(as('teacher'))
      .expect(200);
    const body = picker.body as {
      platform: string;
      context: string | null;
      classes: Array<{ id: string; assignments: Array<{ id: string }> }>;
    };
    expect(body.context).toBe('Period 2');
    const klass = body.classes.find((c) => c.id === ltiClassId);
    expect(klass && klass.assignments.length).toBeGreaterThan(0);
    await request(server)
      .get(`/api/v1/lti/deep-link/${ticket}`)
      .set(as('student'))
      .expect(403);
    const chosen = klass!.assignments[0].id;
    const answer = await request(server)
      .post(`/api/v1/lti/deep-link/${ticket}/respond`)
      .type('form')
      .send({ assignmentIds: chosen })
      .expect(201);
    expect(answer.headers['content-type']).toContain('text/html');
    expect(answer.text).toContain(`action="${localBase}/deep-link-return"`);
    const jwt = /name="JWT" value="([^"]+)"/.exec(answer.text)?.[1] ?? '';
    const [h, p, sig] = jwt.split('.');
    const header = JSON.parse(Buffer.from(h, 'base64url').toString()) as {
      kid: string;
    };
    const keys = (await request(server).get('/api/v1/lti/jwks').expect(200))
      .body as { keys: JsonWebKey[] };
    const jwk = keys.keys.find(
      (k) => (k as { kid?: string }).kid === header.kid,
    )!;
    expect(
      cryptoVerify(
        'sha256',
        Buffer.from(`${h}.${p}`),
        createPublicKey({ key: jwk, format: 'jwk' }),
        Buffer.from(sig, 'base64url'),
      ),
    ).toBe(true);
    const claims = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<
      string,
      unknown
    >;
    expect(claims).toMatchObject({
      iss: 'client-1',
      aud: ISSUER,
      [`${LTI_CLAIM}message_type`]: 'LtiDeepLinkingResponse',
      [`${LTI_CLAIM}deployment_id`]: 'dep-1',
      [`${LTI_DL_CLAIM}data`]: 'opaque-1',
    });
    const items = claims[`${LTI_DL_CLAIM}content_items`] as Array<{
      type: string;
      url: string;
      custom: { smartschool_assignment_id: string };
      lineItem: { scoreMaximum: number };
    }>;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'ltiResourceLink',
      url: 'http://localhost:5000/api/v1/lti/launch',
      custom: { smartschool_assignment_id: chosen },
    });
    // The ticket is spent.
    await request(server)
      .post(`/api/v1/lti/deep-link/${ticket}/respond`)
      .type('form')
      .send({ assignmentIds: chosen })
      .expect(404);
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

  it('gives a tool a service token for a signed assertion, and the roster and line items of a class', async () => {
    const tool = await prisma.ltiTool.findFirstOrThrow({
      where: { name: `Graphing ${stamp}` },
    });
    await request(server)
      .patch(`/api/v1/organizations/${orgId}/lti/tools/${tool.id}`)
      .set(as('principal'))
      .send({ jwksUrl: `${localBase}/tool-jwks` })
      .expect(200);
    const sec = Math.floor(Date.now() / 1000);
    const assertion = (over: Record<string, unknown> = {}) =>
      signWith(toolKey.privateKey, 'tool-k1', {
        iss: tool.clientId,
        sub: tool.clientId,
        aud: 'http://localhost:5000/api/v1/lti/token',
        iat: sec,
        exp: sec + 300,
        jti: `j-${stamp}`,
        ...over,
      });
    const tokenReq = (client_assertion: string, scope?: string) =>
      request(server)
        .post('/api/v1/lti/token')
        .type('form')
        .send({
          grant_type: 'client_credentials',
          client_assertion_type:
            'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
          client_assertion,
          ...(scope ? { scope } : {}),
        });
    await tokenReq(assertion({ aud: 'https://elsewhere.test/token' })).expect(
      401,
    );
    await tokenReq(
      signWith(platformKey.privateKey, 'platform-k1', {
        iss: tool.clientId,
        sub: tool.clientId,
        aud: 'http://localhost:5000/api/v1/lti/token',
        iat: sec,
        exp: sec + 300,
      }),
    ).expect(401);
    const granted = await tokenReq(
      assertion(),
      `${LTI_SCOPE.memberships} ${LTI_SCOPE.lineItem} ${LTI_SCOPE.score} ${LTI_SCOPE.result}`,
    ).expect(200);
    const token = (granted.body as { access_token: string }).access_token;
    expect(token).toBeTruthy();
    const bearer = { Authorization: `Bearer ${token}` };
    // Names and Roles for the demo class: the teacher and the enrolled students.
    const members = await request(server)
      .get(`/api/v1/lti/nrps/classes/${classId}/memberships`)
      .set(bearer)
      .expect(200);
    expect(members.headers['content-type']).toContain('membershipcontainer');
    const container = members.body as {
      context: { id: string };
      members: Array<{ user_id: string; roles: string[]; status: string }>;
    };
    expect(container.context.id).toBe(classId);
    expect(
      container.members.some(
        (m) => m.user_id === teacherId && m.roles[0].endsWith('#Instructor'),
      ),
    ).toBe(true);
    expect(
      container.members.filter((m) => m.roles[0].endsWith('#Learner')).length,
    ).toBeGreaterThan(0);
    await request(server)
      .get(`/api/v1/lti/nrps/classes/${classId}/memberships`)
      .set({ Authorization: 'Bearer nonsense' })
      .expect(401);
    // A line item is an assignment in the class; a fully graded score becomes a grade.
    const created = await request(server)
      .post(`/api/v1/lti/ags/classes/${classId}/lineitems`)
      .set(bearer)
      .send({
        label: `Tool quiz ${stamp}`,
        scoreMaximum: 20,
        resourceId: 'quiz-9',
      })
      .expect(201);
    const item = created.body as {
      id: string;
      label: string;
      scoreMaximum: number;
    };
    expect(item.scoreMaximum).toBe(20);
    const lineItemId = item.id.split('/').pop() ?? '';
    const assignment = await prisma.assignment.findFirstOrThrow({
      where: { classId, title: `Tool quiz ${stamp}` },
    });
    expect(assignment).toMatchObject({
      submissionType: 'EXTERNAL',
      status: 'PUBLISHED',
    });
    const listed = await request(server)
      .get(`/api/v1/lti/ags/classes/${classId}/lineitems`)
      .set(bearer)
      .expect(200);
    expect((listed.body as Array<{ id: string }>).map((l) => l.id)).toContain(
      item.id,
    );
    const learner = container.members.find((m) =>
      m.roles[0].endsWith('#Learner'),
    )!;
    await request(server)
      .post(`/api/v1/lti/ags/lineitems/${lineItemId}/scores`)
      .set(bearer)
      .send({
        userId: learner.user_id,
        scoreGiven: 17,
        scoreMaximum: 20,
        activityProgress: 'Completed',
        gradingProgress: 'FullyGraded',
        timestamp: new Date().toISOString(),
        comment: 'Nice work',
      })
      .expect(200);
    const student = await prisma.student.findFirstOrThrow({
      where: { userId: learner.user_id },
    });
    const grade = await prisma.grade.findUniqueOrThrow({
      where: {
        assignmentId_studentId: {
          assignmentId: assignment.id,
          studentId: student.id,
        },
      },
    });
    expect(Number(grade.score)).toBe(17);
    expect(Number(grade.percentage)).toBe(85);
    const results = await request(server)
      .get(`/api/v1/lti/ags/lineitems/${lineItemId}/results`)
      .set(bearer)
      .expect(200);
    expect(
      (
        results.body as Array<{
          userId: string;
          resultScore: number;
          comment: string;
        }>
      )[0],
    ).toMatchObject({
      userId: learner.user_id,
      resultScore: 17,
      comment: 'Nice work',
    });
    // An older score does not overwrite a newer one.
    await request(server)
      .post(`/api/v1/lti/ags/lineitems/${lineItemId}/scores`)
      .set(bearer)
      .send({
        userId: learner.user_id,
        scoreGiven: 2,
        scoreMaximum: 20,
        timestamp: '2020-01-01T00:00:00Z',
      })
      .expect(200);
    expect(
      Number(
        (await prisma.grade.findUniqueOrThrow({ where: { id: grade.id } }))
          .score,
      ),
    ).toBe(17);
    // A token without the scope is refused.
    const narrow = await tokenReq(
      assertion({ jti: `j2-${stamp}` }),
      LTI_SCOPE.result,
    ).expect(200);
    await request(server)
      .post(`/api/v1/lti/ags/classes/${classId}/lineitems`)
      .set({
        Authorization: `Bearer ${(narrow.body as { access_token: string }).access_token}`,
      })
      .send({ label: 'x', scoreMaximum: 1 })
      .expect(403);
  });

  it('lets a teacher pick content from a tool and places it in the class with its line item', async () => {
    const tool = await prisma.ltiTool.findFirstOrThrow({
      where: { name: `Graphing ${stamp}` },
    });
    await request(server)
      .post(
        `/api/v1/organizations/${orgId}/lti/tools/${tool.id}/deep-link?classId=${classId}`,
      )
      .set(as('student'))
      .expect(403);
    const page = await request(server)
      .post(
        `/api/v1/organizations/${orgId}/lti/tools/${tool.id}/deep-link?classId=${classId}`,
      )
      .set(as('teacher'))
      .expect(201);
    const hint =
      /name="lti_message_hint" value="([^"]+)"/.exec(page.text)?.[1] ?? '';
    const auth = await request(server)
      .get('/api/v1/lti/platform/auth')
      .query({
        scope: 'openid',
        response_type: 'id_token',
        client_id: tool.clientId,
        redirect_uri: 'https://tool.test/launch',
        login_hint: teacherId,
        nonce: 'nonce-dl',
        state: 's',
        lti_message_hint: hint,
      })
      .expect(200);
    const idToken =
      /name="id_token" value="([^"]+)"/.exec(auth.text)?.[1] ?? '';
    const claims = JSON.parse(
      Buffer.from(idToken.split('.')[1], 'base64url').toString(),
    ) as Record<string, unknown>;
    expect(claims[`${LTI_CLAIM}message_type`]).toBe('LtiDeepLinkingRequest');
    const settings = claims[`${LTI_DL_CLAIM}deep_linking_settings`] as {
      deep_link_return_url: string;
      data: string;
    };
    expect(settings.deep_link_return_url).toBe(
      'http://localhost:5000/api/v1/lti/platform/deep-link-return',
    );
    // The tool answers with two resource links, one graded.
    const sec = Math.floor(Date.now() / 1000);
    const response = signWith(toolKey.privateKey, 'tool-k1', {
      iss: tool.clientId,
      aud: 'http://localhost:5000',
      iat: sec,
      exp: sec + 300,
      nonce: 'r1',
      [`${LTI_CLAIM}message_type`]: 'LtiDeepLinkingResponse',
      [`${LTI_CLAIM}version`]: '1.3.0',
      [`${LTI_CLAIM}deployment_id`]: tool.deploymentId,
      [`${LTI_DL_CLAIM}data`]: settings.data,
      [`${LTI_DL_CLAIM}content_items`]: [
        {
          type: 'ltiResourceLink',
          title: `Graph lab ${stamp}`,
          url: 'https://tool.test/labs/1',
          custom: { lab: '1' },
          lineItem: { scoreMaximum: 25, label: `Graph lab ${stamp}` },
        },
        {
          type: 'ltiResourceLink',
          title: `Graph reading ${stamp}`,
          url: 'https://tool.test/read/1',
        },
      ],
    });
    const back = await request(server)
      .post('/api/v1/lti/platform/deep-link-return')
      .type('form')
      .send({ JWT: response })
      .expect(302);
    expect(back.headers.location).toBe(
      `http://localhost:3000/classes/${classId}?tools=2`,
    );
    const links = (
      await request(server)
        .get(`/api/v1/classes/${classId}/lti-links`)
        .set(as('student'))
        .expect(200)
    ).body as Array<{
      id: string;
      title: string;
      graded: boolean;
      tool: { id: string };
    }>;
    const lab = links.find((l) => l.title === `Graph lab ${stamp}`)!;
    expect(lab.graded).toBe(true);
    expect(
      links.find((l) => l.title === `Graph reading ${stamp}`)?.graded,
    ).toBe(false);
    expect(
      await prisma.assignment.count({
        where: {
          classId,
          title: `Graph lab ${stamp}`,
          submissionType: 'EXTERNAL',
        },
      }),
    ).toBe(1);
    // Launching the placed content targets its URL, carries its custom parameters and its line item.
    const launch = await request(server)
      .get(
        `/api/v1/organizations/${orgId}/lti/tools/${tool.id}/launch?classId=${classId}&linkId=${lab.id}`,
      )
      .set(as('teacher'))
      .expect(200);
    const hint2 =
      /name="lti_message_hint" value="([^"]+)"/.exec(launch.text)?.[1] ?? '';
    const auth2 = await request(server)
      .get('/api/v1/lti/platform/auth')
      .query({
        scope: 'openid',
        response_type: 'id_token',
        client_id: tool.clientId,
        redirect_uri: 'https://tool.test/launch',
        login_hint: teacherId,
        nonce: 'nonce-link',
        lti_message_hint: hint2,
      })
      .expect(200);
    const claims2 = JSON.parse(
      Buffer.from(
        (/name="id_token" value="([^"]+)"/.exec(auth2.text)?.[1] ?? '').split(
          '.',
        )[1],
        'base64url',
      ).toString(),
    ) as Record<string, unknown>;
    expect(claims2[`${LTI_CLAIM}target_link_uri`]).toBe(
      'https://tool.test/labs/1',
    );
    expect(claims2[`${LTI_CLAIM}resource_link`]).toEqual({ id: lab.id });
    expect(claims2[`${LTI_CLAIM}custom`]).toMatchObject({
      lab: '1',
      smartschool_class_id: classId,
    });
    expect((claims2[LTI_AGS_CLAIM] as { lineitem: string }).lineitem).toMatch(
      /\/api\/v1\/lti\/ags\/lineitems\//,
    );
    expect(
      (claims2[LTI_NRPS_CLAIM] as { context_memberships_url: string })
        .context_memberships_url,
    ).toBe(
      `http://localhost:5000/api/v1/lti/nrps/classes/${classId}/memberships`,
    );
    // A forged response (signed by the platform key, not the tool's) is refused.
    const forged = signWith(platformKey.privateKey, 'platform-k1', {
      iss: tool.clientId,
      aud: 'http://localhost:5000',
      iat: sec,
      exp: sec + 300,
      [`${LTI_CLAIM}message_type`]: 'LtiDeepLinkingResponse',
      [`${LTI_CLAIM}version`]: '1.3.0',
      [`${LTI_CLAIM}deployment_id`]: tool.deploymentId,
      [`${LTI_DL_CLAIM}data`]: settings.data,
      [`${LTI_DL_CLAIM}content_items`]: [],
    });
    const refused = await request(server)
      .post('/api/v1/lti/platform/deep-link-return')
      .type('form')
      .send({ JWT: forged })
      .expect(302);
    expect(refused.headers.location).toContain('error=lti_');
    await request(server)
      .delete(`/api/v1/classes/${classId}/lti-links/${lab.id}`)
      .set(as('student'))
      .expect(403);
    await request(server)
      .delete(`/api/v1/classes/${classId}/lti-links/${lab.id}`)
      .set(as('teacher'))
      .expect(204);
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
