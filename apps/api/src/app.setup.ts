import { ValidationPipe, VersioningType } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import type { IncomingMessage, ServerResponse } from 'node:http';
import compression from 'compression';
import helmet from 'helmet';
import { parseTrustProxy } from './common/request-rules';

/**
 * Everything the HTTP layer needs beyond the module graph, shared by main.ts and the e2e
 * tests so the tests exercise exactly what production runs (body parsers, cookies,
 * versioning, pipes). Create the app with `bodyParser: false` before calling this.
 */
export function configureApp(
  app: NestExpressApplication,
  options: {
    corsOrigins?: string[];
    /** TRUST_PROXY from the environment; see request-rules.ts. */
    trustProxy?: string;
    /** Outside development the API answers CORS only for the listed origins. */
    isDevelopment?: boolean;
  } = {},
): NestExpressApplication {
  // The client address comes from the socket unless a proxy is trusted (docs/21 F03): the allowlist,
  // the rate limiter and the audit log must never read an X-Forwarded-For the client wrote itself.
  app.set('trust proxy', parseTrustProxy(options.trustProxy));

  // JSON for the API, raw text/csv for bulk imports (docs/09: imports accept a CSV body).
  app.useBodyParser('json', {
    limit: '5mb',
    // The payment provider's webhook is signed over the bytes as sent (slice 26).
    verify: (
      req: IncomingMessage & { rawBody?: Buffer },
      _res: ServerResponse,
      buf: Buffer,
    ) => {
      if (req.url?.includes('/billing/webhooks/')) req.rawBody = buf;
    },
  });
  app.useBodyParser('urlencoded', { extended: true, limit: '5mb' });
  app.useBodyParser('text', { type: 'text/csv', limit: '10mb' });
  app.use(compression({ threshold: 1024 }));
  app.use(cookieParser());

  // The API serves JSON and downloads: nothing may run or be framed (docs/21 F26). Swagger UI is the one
  // HTML page that needs its own scripts and styles; the LTI launch pages set their own policy.
  const strict = helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        'default-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'base-uri': ["'none'"],
        'form-action': ["'none'"],
      },
    },
  });
  const swaggerPage = helmet({
    contentSecurityPolicy: {
      directives: {
        'script-src': ["'self'", "'unsafe-inline'"],
        'style-src': ["'self'", "'unsafe-inline'"],
        'img-src': ["'self'", 'data:'],
      },
    },
  });
  app.use((req: IncomingMessage, res: ServerResponse, next: () => void) =>
    (req.url ?? '').startsWith('/swagger')
      ? swaggerPage(req, res, next)
      : strict(req, res, next),
  );
  app.enableCors({
    origin: options.corsOrigins?.length
      ? options.corsOrigins
      : options.isDevelopment === true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-SmartSchool-Client',
    ],
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
