import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infra/prisma/prisma.service';

interface TokenBody {
  user: { email: string; role: string };
  accessToken: string;
  refreshToken: string;
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

/**
 * Full sign-in journey against a real database (XAMPP locally, service container in CI).
 * Runs after `prisma migrate deploy`; creates and removes its own users.
 */
describe('Auth (e2e)', () => {
  let app: INestApplication;
  let server: Server;
  let prisma: PrismaService;
  const email = `e2e.${Date.now()}@smartschool.local`;
  const password = 'Strong-Passw0rd!2026';
  let accessToken = '';
  let refreshToken = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    app.enableVersioning({
      type: VersioningType.URI,
      prefix: 'api/v',
      defaultVersion: '1',
    });
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
    server = app.getHttpServer() as Server;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('rejects a weak password with problem details', async () => {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password: 'weak', firstName: 'E2E', lastName: 'User' })
      .expect(400);
    expect((res.body as Problem).code).toBe('validation.failed');
  });

  it('registers a student and returns tokens', async () => {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'E2E', lastName: 'User' })
      .expect(201);
    const body = res.body as TokenBody;
    expect(body.user).toMatchObject({ email, role: 'student' });
    expect(body.accessToken).toBeTruthy();
    accessToken = body.accessToken;
    refreshToken = body.refreshToken;
  });

  it('refuses a duplicate email', async () => {
    const res = await request(server)
      .post('/api/v1/auth/register')
      .send({ email, password, firstName: 'E2E', lastName: 'User' })
      .expect(409);
    expect((res.body as Problem).code).toBe('auth.email_exists');
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

  it('rotates the refresh token and detects reuse', async () => {
    const first = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(200);
    const rotated = (first.body as TokenBody).refreshToken;
    expect(rotated).not.toBe(refreshToken);
    const reuse = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken })
      .expect(401);
    expect((reuse.body as Problem).code).toBe('auth.refresh_reused');
    // the whole family is revoked, including the new token
    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotated })
      .expect(401);
  });

  it('signs in again and signs out', async () => {
    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email, password })
      .expect(200);
    const body = login.body as TokenBody;
    expect(body.mfaRequired).toBe(false);
    await request(server)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .send({})
      .expect(204);
    await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
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
