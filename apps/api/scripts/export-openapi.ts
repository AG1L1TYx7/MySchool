/**
 * Writes the OpenAPI document to docs/openapi.json without starting the HTTP server (docs/07 slice 8).
 * Run: pnpm --filter @smartschool/api openapi:export
 */
import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';

async function main(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false, bodyParser: false });
  configureApp(app);
  const config = new DocumentBuilder()
    .setTitle('SmartSchool API')
    .setDescription('LMS API for SmartSchool. Conventions: docs/09-API-DESIGN.md. Errors use RFC 9457 problem details.')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
    .build();
  const document = SwaggerModule.createDocument(app, config);
  const out = resolve(__dirname, '..', '..', '..', 'docs', 'openapi.json');
  writeFileSync(out, JSON.stringify(document, null, 2) + '\n');
  const paths = Object.keys(document.paths).length;
  const operations = Object.values(document.paths).reduce((n, p) => n + Object.keys(p).length, 0);
  console.log(`openapi.json written: ${paths} paths, ${operations} operations`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
