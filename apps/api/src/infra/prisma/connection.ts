import { PrismaMariaDb } from '@prisma/adapter-mariadb';

export interface ConnectionOptions {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  connectionLimit: number;
}

/** Splits mysql://user:password@host:port/database?connection_limit=n into driver options. */
export function connectionOptions(databaseUrl: string): ConnectionOptions {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: url.pathname.replace(/^\//, ''),
    connectionLimit: Number(url.searchParams.get('connection_limit') ?? 10),
  };
}

/** Driver adapter shared by the API runtime and the seed script (Prisma 7 requires one). */
export function createAdapter(databaseUrl: string): PrismaMariaDb {
  return new PrismaMariaDb(connectionOptions(databaseUrl));
}
