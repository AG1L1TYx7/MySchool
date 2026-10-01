import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 configuration (replaces `datasource.url` in the schema and `package.json#prisma`).
 * The CLI (migrate, db seed) reads DATABASE_URL from the environment or `.env`; the runtime
 * client connects through the MariaDB driver adapter in PrismaService.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
