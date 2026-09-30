import { Controller, Get, Header, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { collectDefaultMetrics, Registry } from 'prom-client';

/** Prometheus metrics at GET /metrics (outside the /api prefix), mirroring the AI service. */
@ApiExcludeController()
@Controller({ path: 'metrics', version: VERSION_NEUTRAL })
export class MetricsController {
  static readonly registry = new Registry();
  private static initialised = false;

  constructor() {
    if (!MetricsController.initialised) {
      collectDefaultMetrics({
        register: MetricsController.registry,
        prefix: 'smartschool_api_',
      });
      MetricsController.initialised = true;
    }
  }

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async metrics(): Promise<string> {
    return MetricsController.registry.metrics();
  }
}
