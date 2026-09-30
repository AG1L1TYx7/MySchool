import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

/**
 * Everything the HTTP layer needs beyond the module graph, shared by main.ts and the e2e
 * tests so the tests exercise exactly what production runs (body parsers, versioning, pipes).
 * Create the app with `bodyParser: false` before calling this.
 */
export function configureApp(
  app: NestExpressApplication,
  options: { corsOrigins?: string[] } = {},
): NestExpressApplication {
  // JSON for the API, raw text/csv for bulk imports (docs/09: imports accept a CSV body).
  app.useBodyParser('json', { limit: '5mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '5mb' });
  app.useBodyParser('text', { type: 'text/csv', limit: '10mb' });

  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors({
    origin: options.corsOrigins?.length ? options.corsOrigins : true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    exposedHeaders: [
      'ETag',
      'Location',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
    ],
  });

  // All resources live under /api/v1 (docs/09, ADR-017). Controllers default to version 1;
  // probes and the three legacy AI callbacks opt out with VERSION_NEUTRAL.
  app.enableVersioning({
    type: VersioningType.URI,
    prefix: 'api/v',
    defaultVersion: '1',
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      forbidUnknownValues: false,
    }),
  );
  return app;
}
