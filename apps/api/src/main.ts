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
  });

  // Routes are declared with their full previous path (e.g. 'api/Course', 'api/v1/srs' style is expressed
  // through URI versioning), so no global prefix is applied. See ADR-010.
  app.enableVersioning({ type: VersioningType.URI, prefix: 'api/v' });

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
      'LMS API for SmartSchool. Routes are preserved from the previous implementation; see docs/06-ENDPOINT-INVENTORY.md.',
    )
    .setVersion('0.1.0')
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
