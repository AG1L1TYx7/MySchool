import { Injectable } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infra/prisma/prisma.service';

export type CheckStatus = 'up' | 'down' | 'disabled';

export interface HealthCheck {
  status: CheckStatus;
  responseTimeMs?: number;
  message?: string;
}

export interface HealthReport {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptimeSeconds: number;
  version: string;
  checks: Record<'database' | 'aiService' | 'redis', HealthCheck>;
}

@Injectable()
export class HealthService {
  private readonly startedAt = Date.now();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfigService,
  ) {}

  /** Liveness: the process is running. Never touches dependencies. */
  live(): { status: 'ok'; timestamp: string } {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  /** Readiness and detailed health: database is required, the AI service is reported but not required. */
  private cached: { at: number; report: HealthReport } | null = null;

  /** Dependency checks are shared for five seconds so probes and dashboards cannot amplify load. */
  async report(): Promise<HealthReport> {
    if (this.cached && Date.now() - this.cached.at < 5_000)
      return this.cached.report;
    const report = await this.buildReport();
    this.cached = { at: Date.now(), report };
    return report;
  }

  private async buildReport(): Promise<HealthReport> {
    const [database, aiService] = await Promise.all([
      this.checkDatabase(),
      this.checkAiService(),
    ]);
    const redis: HealthCheck = this.config.providers.redis
      ? { status: 'up', message: 'configured, not yet probed' }
      : { status: 'disabled' };

    const status: HealthReport['status'] =
      database.status !== 'up'
        ? 'unhealthy'
        : aiService.status === 'down'
          ? 'degraded'
          : 'healthy';

    return {
      status,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - this.startedAt) / 1000),
      version: process.env.npm_package_version ?? '0.1.0',
      checks: { database, aiService, redis },
    };
  }

  private async checkDatabase(): Promise<HealthCheck> {
    const t0 = Date.now();
    const ok = await this.prisma.ping();
    return ok
      ? { status: 'up', responseTimeMs: Date.now() - t0 }
      : {
          status: 'down',
          responseTimeMs: Date.now() - t0,
          message: 'SELECT 1 failed',
        };
  }

  private async checkAiService(): Promise<HealthCheck> {
    const t0 = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch(`${this.config.get('AI_SERVICE_URL')}/health`, {
        signal: controller.signal,
      });
      return res.ok
        ? { status: 'up', responseTimeMs: Date.now() - t0 }
        : {
            status: 'down',
            responseTimeMs: Date.now() - t0,
            message: `HTTP ${res.status}`,
          };
    } catch (err) {
      return {
        status: 'down',
        responseTimeMs: Date.now() - t0,
        message: err instanceof Error ? err.message : 'unreachable',
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
