import {
  Controller,
  Get,
  HttpCode,
  Res,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { HealthService } from './health.service';

/**
 * Probes outside the API prefix (docs/09 section 2):
 *   GET /health          basic status
 *   GET /health/live     liveness, never touches dependencies
 *   GET /health/ready    readiness, 503 when the database is down
 */
@ApiTags('Health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Basic health' })
  async basic(@Res({ passthrough: true }) res: Response) {
    const report = await this.health.report();
    res.status(report.status === 'unhealthy' ? 503 : 200);
    return { status: report.status, timestamp: report.timestamp };
  }

  @Get('live')
  @HttpCode(200)
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return this.health.live();
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe' })
  async ready(@Res({ passthrough: true }) res: Response) {
    const report = await this.health.report();
    res.status(report.status === 'unhealthy' ? 503 : 200);
    return report;
  }
}

/** GET /api/v1/health: detailed dependency health for operators and dashboards. */
@ApiTags('Health')
@Controller({ path: 'health', version: '1' })
export class DetailedHealthController {
  constructor(private readonly health: HealthService) {}

  @Get()
  @ApiOperation({ summary: 'Detailed health with dependency checks' })
  async detailed(@Res({ passthrough: true }) res: Response) {
    const report = await this.health.report();
    res.status(report.status === 'unhealthy' ? 503 : 200);
    return report;
  }
}
