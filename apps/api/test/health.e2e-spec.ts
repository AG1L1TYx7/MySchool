import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

interface HealthBody {
  status: string;
  checks?: Record<string, { status: string }>;
}

interface ProblemBody {
  status: number;
  code: string;
  traceId: string;
}

/**
 * Requires a reachable DATABASE_URL (XAMPP locally, service container in CI).
 * The AI service is not required: health reports "degraded" without it.
 */
describe('Health and conventions (e2e)', () => {
  let app: INestApplication;
  let server: Server;

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
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health/live returns ok without touching dependencies', async () => {
    const res = await request(server).get('/health/live').expect(200);
    expect((res.body as HealthBody).status).toBe('ok');
  });

  it('GET /health reports a status', async () => {
    const res = await request(server).get('/health');
    expect([200, 503]).toContain(res.status);
    expect(['healthy', 'degraded', 'unhealthy']).toContain(
      (res.body as HealthBody).status,
    );
  });

  it('GET /api/v1/health returns dependency checks', async () => {
    const res = await request(server).get('/api/v1/health');
    const body = res.body as HealthBody;
    expect(body.checks).toHaveProperty('database');
    expect(body.checks).toHaveProperty('aiService');
  });

  it('GET /metrics exposes Prometheus text', async () => {
    const res = await request(server).get('/metrics').expect(200);
    expect(res.text).toContain('smartschool_api_');
  });

  it('unknown routes return RFC 9457 problem details', async () => {
    const res = await request(server).get('/api/v1/does-not-exist').expect(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const body = res.body as ProblemBody;
    expect(body).toMatchObject({ status: 404, code: 'resource.not_found' });
    expect(body.traceId).toBeTruthy();
  });
});
