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
 * Routes preserved from the previous API:
 *   GET /health           basic health (outside the /api prefix)
 *   GET /health/live      liveness
 *   GET /health/ready     readiness (503 when the database is down)
 *   GET /api/Health       detailed health
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

@ApiTags('Health')
@Controller({ path: 'api/Health', version: VERSION_NEUTRAL })
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
