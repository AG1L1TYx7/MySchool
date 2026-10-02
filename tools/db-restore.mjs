#!/usr/bin/env node
/**
 * Restores a backup made by tools/db-backup.mjs (docs/07 slice 8).
 *
 *   pnpm db:restore backups/smartschooldb-2026-10-02T14-05-33.sql.gz --yes
 *   pnpm db:restore <file> --uploads backups/...uploads.tar.gz --yes
 *
 * Refuses to run without --yes because it replaces every table in the target database.
 * The target is DATABASE_URL from apps/api/.env unless --database-url is given. Never prints the password.
 */
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync } from 'node:fs';
import { createGunzip } from 'node:zlib';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { findTool, loadEnv, parseDatabaseUrl } from './db-backup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && a.endsWith('.gz') && !a.includes('.uploads.'));
const uploadsFile = args.includes('--uploads') ? args[args.indexOf('--uploads') + 1] : null;
const yes = args.includes('--yes');
const databaseUrl = args.includes('--database-url') ? args[args.indexOf('--database-url') + 1] : null;

async function run(tool, argv, input, env, cwd) {
  const child = spawn(tool, argv, { cwd, env: { ...process.env, ...env }, stdio: [input ? 'pipe' : 'ignore', 'inherit', 'inherit'] });
  const exit = new Promise((res, rej) => child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${tool} exited with ${code}`)))));
  if (input) await pipeline(input, child.stdin);
  await exit;
}

async function main() {
  if (!file || !existsSync(file)) throw new Error('Give the .sql.gz backup file to restore.');
  if (!yes) throw new Error('This replaces the whole database. Re-run with --yes to confirm.');
  const env = loadEnv();
  const db = parseDatabaseUrl(databaseUrl ?? env.DATABASE_URL);
  const mysql = findTool('mysql');
  console.log(`Restoring ${file} into ${db.database} on ${db.host}:${db.port}`);
  await run(mysql, ['--host', db.host, '--port', db.port, '--user', db.user, '--default-character-set=utf8mb4', '-e', `CREATE DATABASE IF NOT EXISTS \`${db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`], null, { MYSQL_PWD: db.password });
  await run(mysql, ['--host', db.host, '--port', db.port, '--user', db.user, '--default-character-set=utf8mb4', db.database], createReadStream(file).pipe(createGunzip()), { MYSQL_PWD: db.password });
  if (uploadsFile) {
    const uploads = resolve(join(root, 'apps', 'api'), env.UPLOAD_DIR ?? './uploads');
    mkdirSync(dirname(uploads), { recursive: true });
    await run('tar', ['-xzf', relative(dirname(uploads), resolve(uploadsFile))], null, {}, dirname(uploads));
    console.log(`Uploads restored to ${uploads}`);
  }
  console.log('Done. Run `pnpm --filter @smartschool/api prisma:deploy` if the backup predates the current migrations.');
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
