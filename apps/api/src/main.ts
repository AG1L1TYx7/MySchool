import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));

  const config = app.get(AppConfigService);
  configureApp(app, { corsOrigins: config.get('CORS_ORIGINS') });

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
