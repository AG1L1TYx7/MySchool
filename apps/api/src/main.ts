import 'reflect-metadata';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(AppConfigService);

  app.use(helmet({ contentSecurityPolicy: false }));
  app.enableCors({
    origin: config.get('CORS_ORIGINS').length
      ? config.get('CORS_ORIGINS')
      : true,
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

  const swagger = new DocumentBuilder()
    .setTitle('SmartSchool API')
    .setDescription(
      'LMS API for SmartSchool. Conventions: docs/09-API-DESIGN.md. Errors use RFC 9457 problem details.',
    )
    .setVersion('1.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      'bearer',
    )
    .build();
  SwaggerModule.setup(
    'swagger',
    app,
    SwaggerModule.createDocument(app, swagger),
    {
      jsonDocumentUrl: 'openapi.json',
      swaggerOptions: { persistAuthorization: true },
    },
  );

  app.enableShutdownHooks();

  const port = config.get('PORT');
  await app.listen(port);
  app
    .get(Logger)
    .log(
      `SmartSchool API listening on http://localhost:${port} (swagger at /swagger, health at /health)`,
    );
}

void bootstrap();
