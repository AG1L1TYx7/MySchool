#!/usr/bin/env node
/**
 * Load test against a running API (docs/07 slice 8). Run `pnpm load:seed` first for the 10,000-student school.
 *
 *   pnpm load:test                       # 60 connections, 20 s per scenario, API at http://localhost:5000
 *   pnpm load:test --url http://host:5000 --connections 100 --duration 30
 *
 * Start the API with RATE_LIMIT_PER_MINUTE=1000000 (or higher) so the per-IP throttle does not answer 429.
 * Signs in as the load school's teacher and one student, then runs autocannon against the endpoints a real
 * school day hits: dashboard data, class lists, assignments, gradebook, notifications, announcements.
 * Prints p50 / p95 / p99 latency, requests per second and non-2xx counts, and writes docs/load-test.json.
 */
import autocannon from 'autocannon';
import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] : fallback);
const base = opt('url', 'http://localhost:5000').replace(/\/$/, '');
const connections = Number(opt('connections', 60));
const duration = Number(opt('duration', 20));
const PASSWORD = 'SmartSchool!Load2026';

async function login(email) {
  const res = await fetch(`${base}/api/v1/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-smartschool-client': 'native' }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!res.ok) throw new Error(`login failed for ${email}: ${res.status} (run pnpm load:seed first)`);
  return (await res.json()).accessToken;
}

async function json(path, token) {
  const res = await fetch(`${base}/api/v1${path}`, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return res.json();
}

async function run(name, url, token, method = 'GET', body) {
  const result = await autocannon({ url, connections, duration, method, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const row = { name, rps: Math.round(result.requests.average), p50: result.latency.p50, p95: result.latency.p97_5 ?? result.latency.p99, p99: result.latency.p99, errors: result.errors, non2xx: result.non2xx, ok2xx: result['2xx'], total: result.requests.total };
  if (row.non2xx > row.ok2xx) throw new Error(`${name}: ${row.non2xx} non-2xx responses; is RATE_LIMIT_PER_MINUTE raised on the API?`);
  console.log(`${name.padEnd(34)} ${String(row.rps).padStart(6)} req/s   p50 ${String(row.p50).padStart(4)} ms   p99 ${String(row.p99).padStart(5)} ms   non-2xx ${row.non2xx}`);
  return row;
}

async function main() {
  console.log(`Target ${base}, ${connections} connections, ${duration} s per scenario`);
  const teacher = await login('load.teacher1@load.smartschool.local');
  const student = await login('load.student1@load.smartschool.local');
  const classes = await json('/classes/mine', teacher);
  const classId = classes.data[0]?.id;
  if (!classId) throw new Error('the load teacher has no classes; run pnpm load:seed');
  const assignments = await json(`/assignments?classId=${classId}&pageSize=1`, teacher);
  const assignmentId = assignments.data[0]?.id;

  const rows = [];
  rows.push(await run('health', `${base}/health`, teacher));
  rows.push(await run('auth/me', `${base}/api/v1/auth/me`, student));
  rows.push(await run('students list (page of 50)', `${base}/api/v1/students?pageSize=50`, teacher));
  rows.push(await run('students search', `${base}/api/v1/students?search=Lo&pageSize=20`, teacher));
  rows.push(await run('classes/mine (student)', `${base}/api/v1/classes/mine`, student));
  rows.push(await run('assignments (student week)', `${base}/api/v1/assignments?pageSize=100`, student));
  if (assignmentId) rows.push(await run('assignment detail', `${base}/api/v1/assignments/${assignmentId}`, student));
  rows.push(await run('class roster', `${base}/api/v1/classes/${classId}/enrollments`, teacher));
  rows.push(await run('gradebook', `${base}/api/v1/classes/${classId}/gradebook`, teacher));
  rows.push(await run('notifications summary', `${base}/api/v1/notifications/summary`, student));
  rows.push(await run('announcements feed', `${base}/api/v1/announcements?pageSize=20`, student));
  rows.push(await run('audit log page', `${base}/api/v1/audit-logs?pageSize=50`, teacher).catch(() => ({ name: 'audit log page', skipped: true })));

  const out = { target: base, connections, duration, at: new Date().toISOString(), rows };
  writeFileSync(join(root, 'docs', 'load-test.json'), JSON.stringify(out, null, 2) + '\n');
  const worst = rows.filter((r) => r.p99 !== undefined).sort((a, b) => b.p99 - a.p99)[0];
  console.log(`\nSlowest p99: ${worst.name} at ${worst.p99} ms. Written to docs/load-test.json.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
