import { HealthService } from './health.service';
import type { PrismaService } from '../../infra/prisma/prisma.service';
import type { AppConfigService } from '../../config/app-config.service';

function makeService(dbUp: boolean, redis = false) {
  const prisma = {
    ping: jest.fn().mockResolvedValue(dbUp),
  } as unknown as PrismaService;
  const config = {
    get: jest.fn().mockReturnValue('http://127.0.0.1:1'),
    providers: { redis },
  } as unknown as AppConfigService;
  return new HealthService(prisma, config);
}

describe('HealthService', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('is healthy when the database and AI service are up', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const report = await makeService(true).report();
    expect(report.status).toBe('healthy');
    expect(report.checks.database.status).toBe('up');
    expect(report.checks.aiService.status).toBe('up');
    expect(report.checks.redis.status).toBe('disabled');
  });

  it('is degraded when only the AI service is down', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));
    const report = await makeService(true).report();
    expect(report.status).toBe('degraded');
    expect(report.checks.aiService).toMatchObject({
      status: 'down',
      message: 'ECONNREFUSED',
    });
  });

  it('is unhealthy when the database is down', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    const report = await makeService(false).report();
    expect(report.status).toBe('unhealthy');
  });

  it('liveness never touches dependencies', () => {
    const svc = makeService(false);
    expect(svc.live().status).toBe('ok');
  });
});
