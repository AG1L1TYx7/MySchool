import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { newId } from '../src/common/utils/ids';
import { randomToken, sha256 } from '../src/common/utils/tokens';
import { PrismaService } from '../src/infra/prisma/prisma.service';

interface TokenBody {
  user: {
    email: string;
    role: string;
    emailVerified: boolean;
    mfaSetupRequired: boolean;
  };
  accessToken: string;
  refreshToken?: string;
  mfaRequired?: boolean;
}
interface MeBody {
  email: string;
  features: string[];
}
interface Problem {
  code: string;
  detail: string;
}
interface RegisterBody {
  message: string;
  verificationRequired: boolean;
  devToken?: string;
}

const cookieOf = (res: request.Response): string | undefined => {
  const raw = res.headers['set-cookie'] as string[] | string | undefined;
  const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return list.find((c) => c.startsWith('ss_refresh='));
};
const cookieValue = (cookie: string): string => cookie.split(';')[0];

/**
 * Sign-in journey and abuse cases against a real database (docs/11 section 3).
 * Creates and removes its own users.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const stamp = Date.now();
  const email = `e2e.${stamp}@smartschool.local`;
  const password = 'Orbital-Mechanics-77!';
  let accessToken = '';
  let refreshCookie = '';

  beforeAll(async () => {
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
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { startsWith: `e2e.${stamp}` } },
    });
    await app.close();
  });

  it('rejects weak, common and personal passwords with a clear reason', async () => {
    const base = { email, firstName: 'E2E', lastName: 'User' };
    const weak = await request(server)
      .post('/api/v1/auth/register')
      .send({ ...base, password: 'weak' })
      .expect(400);
    expect((weak.body as Problem).code).toBe('validation.failed');
    const common = await request(server)
      .post('/api/v1/auth/register')
      .send({ ...base, password: 'Password2026!' })
      .expect(400);
    expect((common.body as Problem).code).toBe('auth.password_weak');
    const personal = await request(server)
      .post('/api/v1/auth/register')
      .send({ ...base, password: `E2E-User-${stamp}!` })
      .expect(400);
    expect((personal.body as Problem).code).toBe('auth.password_weak');
  });

  it('refuses staff self-registration and bad join codes', async () => {
    const staff = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        firstName: 'E2E',
        lastName: 'User',
        role: 'teacher',
      })
      .expect(400);
    expect((staff.body as Problem).code).toBe('validation.failed');
    const code = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        firstName: 'E2E',
        lastName: 'User',
        joinCode: 'NOPE-0000',
      })
      .expect(400);
    expect((code.body as Problem).code).toBe('auth.join_code_invalid');
  });

  it('registers a student with the school join code without issuing tokens', async () => {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({
        email,
        password,
        firstName: 'E2E',
        lastName: 'User',
        joinCode: 'demo-2026',
      })
      .expect(202);
    const body = res.body as RegisterBody;
    expect(body.message).toContain('verify');
    expect((res.body as { accessToken?: string }).accessToken).toBeUndefined();
    expect(cookieOf(res)).toBeUndefined();
    const user = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { organization: true },
    });
    expect(user.organization?.name).toBe('Demo School');
    expect(user.emailVerifiedAt).toBeNull();
  });

  it('answers a duplicate registration exactly like a new one', async () => {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'E2E', lastName: 'User' })
      .expect(202);
    expect((res.body as RegisterBody).message).toContain('verify');
  });

  it('verifies the email with a single-use token', async () => {
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    const token = randomToken(32);
    await prisma.authToken.create({
      data: {
        id: newId(),
        userId: user.id,
        purpose: 'EMAIL_VERIFY',
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(204);
    const again = await request(server)
      .post('/api/v1/auth/verify-email')
      .send({ token })
      .expect(400);
    expect((again.body as Problem).code).toBe('auth.verify_token_invalid');
    expect(
      (await prisma.user.findUniqueOrThrow({ where: { email } }))
        .emailVerifiedAt,
    ).not.toBeNull();
  });

  it('signs in with the refresh token in an HttpOnly cookie, not the body', async () => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const body = res.body as TokenBody;
    expect(body.mfaRequired).toBe(false);
    expect(body.user).toMatchObject({
      email,
      role: 'student',
      emailVerified: true,
      mfaSetupRequired: false,
    });
    expect(body.accessToken).toBeTruthy();
    expect(body.refreshToken).toBeUndefined();
    const cookie = cookieOf(res);
    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/v1/auth');
    accessToken = body.accessToken;
    refreshCookie = cookieValue(cookie as string);
  });

  it('gives native clients the refresh token in the body instead', async () => {
    const res = await request(server)
      .post('/api/v1/auth/login')
      .set('x-smartschool-client', 'native')
      .send({ email, password })
      .expect(200);
    expect((res.body as TokenBody).refreshToken).toBeTruthy();
    expect(cookieOf(res)).toBeUndefined();
  });

  it('returns the current user with effective features', async () => {
    const res = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const body = res.body as MeBody;
    expect(body.email).toBe(email);
    expect(body.features).toContain('dashboard.view');
    expect(body.features).not.toContain('users.create');
  });

  it('enforces feature permissions with a 403 naming the feature', async () => {
    const res = await request(server)
      .get('/api/v1/users')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    const body = res.body as Problem;
    expect(body.code).toBe('authz.forbidden');
    expect(body.detail).toContain('users.view');
  });

  it('refreshes with the cookie only when the anti-CSRF header is present, rotates it, and detects reuse', async () => {
    const noHeader = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .send({})
      .expect(403);
    expect((noHeader.body as Problem).code).toBe('auth.csrf');
    const first = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .set('X-Requested-With', 'SmartSchool')
      .send({})
      .expect(200);
    const rotated = cookieValue(cookieOf(first) as string);
    expect(rotated).not.toBe(refreshCookie);
    expect((first.body as TokenBody).refreshToken).toBeUndefined();
    const reuse = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', refreshCookie)
      .set('X-Requested-With', 'SmartSchool')
      .send({})
      .expect(401);
    expect((reuse.body as Problem).code).toBe('auth.refresh_reused');
    // the whole family is revoked, including the rotated token
    await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', rotated)
      .set('X-Requested-With', 'SmartSchool')
      .send({})
      .expect(401);
  });

  it('refuses sessions past their absolute lifetime', async () => {
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const token = (login.body as TokenBody).accessToken;
    const cookie = cookieValue(cookieOf(login) as string);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    await prisma.authSession.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { absoluteExpiresAt: new Date(Date.now() - 1000) },
    });
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    const refresh = await request(server)
      .post('/api/v1/auth/refresh')
      .set('Cookie', cookie)
      .set('X-Requested-With', 'SmartSchool')
      .send({})
      .expect(401);
    expect((refresh.body as Problem).code).toBe('auth.refresh_expired');
  });

  it('signs out and clears the cookie', async () => {
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const token = (login.body as TokenBody).accessToken;
    const cookie = cookieValue(cookieOf(login) as string);
    const out = await request(server)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${token}`)
      .set('Cookie', cookie)
      .send({})
      .expect(204);
    expect(cookieOf(out)).toContain('Expires=Thu, 01 Jan 1970');
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
  });

  it('locks the account after five wrong passwords', async () => {
    for (let i = 0; i < 5; i++) {
      await request(server)
        .post('/api/v1/auth/login')
        .send({ email, password: 'wrong-password-1!' });
    }
    const res = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password });
    expect([401, 429]).toContain(res.status);
  });
});
