#!/usr/bin/env node
/**
 * Backs up the SmartSchool database and uploaded files (docs/07 slice 8).
 *
 *   pnpm db:backup                 -> backups/smartschool-2026-10-02T14-05-33.sql.gz + .uploads.tar.gz
 *   pnpm db:backup --out /mnt/bk   -> another folder
 *
 * Reads DATABASE_URL and UPLOAD_DIR from apps/api/.env (or the environment). Uses mysqldump from PATH,
 * or the XAMPP copy on Windows. The dump is a consistent single transaction (InnoDB) and includes routines
 * and triggers; the file is gzip-compressed. Never prints the password.
 */
import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const outDir = resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : join(root, 'backups'));

export function loadEnv() {
  const file = join(root, 'apps', 'api', '.env');
  const env = { ...process.env };
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
    }
  }
  return env;
}

export function parseDatabaseUrl(url) {
  const u = new URL(url);
  return { host: u.hostname, port: u.port || '3306', user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), database: u.pathname.replace(/^\//, '') };
}

export function findTool(name) {
  // Known install locations first (XAMPP on Windows, LAMPP, system packages); otherwise rely on PATH.
  const candidates = [`C:\\xampp\\mysql\\bin\\${name}.exe`, `/opt/lampp/bin/${name}`, `/usr/bin/${name}`, `/usr/local/bin/${name}`];
  return candidates.find((c) => existsSync(c)) ?? name;
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

async function dumpDatabase(db, file) {
  const tool = findTool('mysqldump');
  const child = spawn(tool, ['--host', db.host, '--port', db.port, '--user', db.user, '--single-transaction', '--routines', '--triggers', '--default-character-set=utf8mb4', '--skip-comments', db.database], {
    env: { ...process.env, MYSQL_PWD: db.password },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const exit = new Promise((res, rej) => child.on('exit', (code) => (code === 0 ? res() : rej(new Error(`${tool} exited with ${code}`)))));
  await pipeline(child.stdout, createGzip({ level: 6 }), createWriteStream(file));
  await exit;
}

async function archiveUploads(dir, file) {
  if (!existsSync(dir)) return false;
  // Relative paths from the parent folder: Windows tar treats a "C:" prefix as a remote host.
  const parent = dirname(dir);
  await new Promise((res, rej) => {
    const tar = spawn('tar', ['-czf', relative(parent, file), basename(dir)], { cwd: parent, stdio: 'inherit' });
    tar.on('exit', (code) => (code === 0 ? res() : rej(new Error(`tar exited with ${code}`))));
    tar.on('error', rej);
  });
  return true;
}

async function main() {
  const env = loadEnv();
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set (apps/api/.env)');
  const db = parseDatabaseUrl(env.DATABASE_URL);
  mkdirSync(outDir, { recursive: true });
  const base = join(outDir, `${db.database}-${stamp()}`);
  const sqlFile = `${base}.sql.gz`;
  console.log(`Backing up ${db.database} on ${db.host}:${db.port} to ${sqlFile}`);
  await dumpDatabase(db, sqlFile);
  const uploads = resolve(join(root, 'apps', 'api'), env.UPLOAD_DIR ?? './uploads');
  const uploadsFile = `${base}.uploads.tar.gz`;
  const archived = await archiveUploads(uploads, uploadsFile);
  console.log(archived ? `Uploads archived to ${uploadsFile}` : 'No uploads folder yet; skipped.');
  console.log('Done. Keep backups off the server and test a restore regularly (pnpm db:restore <file>).');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
