// Dynamic scan with OWASP ZAP (slice 29): a passive baseline of the web app (spidered) and of the API through
// its OpenAPI document, then the verdict from zap-rules.mjs. Needs Docker; CI runs it, and by hand:
//   pnpm browser:zap            # WEB_URL (default http://localhost:3000), API_URL (default http://127.0.0.1:5000)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { summarize, verdict } from './zap-rules.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
try { chmodSync(out, 0o777); } catch { /* Windows */ }
const WEB = (process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const API = (process.env.API_URL ?? 'http://127.0.0.1:5000').replace(/\/$/, '');
const IMAGE = process.env.ZAP_IMAGE ?? 'ghcr.io/zaproxy/zaproxy:stable';

function zap(args, label) {
  const r = spawnSync('docker', ['run', '--rm', '--network', 'host', '-v', `${out}:/zap/wrk:rw`, IMAGE, ...args], { stdio: 'inherit' });
  if (r.error) {
    console.error(`docker could not start for the ${label} scan: ${r.error.message}`);
    process.exit(2);
  }
  // zap-*-scan.py exit codes: 0 clean, 1 fail rules hit, 2 warn rules hit (suppressed by -I), 3 or more a scan error.
  if (r.status !== null && r.status >= 3) {
    console.error(`the ${label} scan did not complete (exit ${r.status})`);
    process.exit(2);
  }
}

// The web app: spider from the public pages for up to three minutes, passive rules only.
zap(['zap-baseline.py', '-t', WEB, '-m', '3', '-I', '-J', 'web.json', '-r', 'web.html'], 'web');
// The API: every route from its OpenAPI document, passive rules only (-S skips the active scan).
zap(['zap-api-scan.py', '-t', `${API}/swagger/openapi.json`, '-f', 'openapi', '-S', '-I', '-J', 'api.json', '-r', 'api.html'], 'api');

const reports = ['web.json', 'api.json'].filter((f) => existsSync(join(out, f))).map((f) => JSON.parse(readFileSync(join(out, f), 'utf8')));
if (reports.length < 2) {
  console.error('a scan wrote no report');
  process.exit(2);
}
const v = verdict(reports);
for (const a of v.accepted) console.log('  ' + a.line);
for (const w of v.warnings) console.log('  ' + w.line);
for (const f of v.failures) console.log('  FAIL ' + f.line);
console.log(summarize(v));
process.exit(v.ok ? 0 : 1);
