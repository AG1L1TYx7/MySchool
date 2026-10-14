// Runs every per-slice user journey in order against the running app and reports which were clean.
//   pnpm browser:flows            # all of them
//   pnpm browser:flows 24 26      # only slices 24 and 26
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const wanted = process.argv.slice(2);
const files = readdirSync(join(here, 'flows'))
  .filter((f) => /^flows\d+\.mjs$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]))
  .filter((f) => wanted.length === 0 || wanted.includes(f.match(/\d+/)[0]));

const results = [];
for (const f of files) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [join(here, 'flows', f)], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  const out = `${r.stdout}\n${r.stderr}`;
  const clean = /FLOWS\d* CLEAN|^0 findings/m.test(out) && r.status === 0;
  const findings = (out.match(/(\d+) flow findings/) ?? [])[1];
  results.push({ file: f, clean, findings: findings ? Number(findings) : clean ? 0 : null, seconds: Math.round((Date.now() - t0) / 1000) });
  console.log(`${clean ? 'ok  ' : 'FAIL'} ${f} (${results[results.length - 1].seconds} s)${findings ? ` ${findings} findings` : ''}`);
  if (!clean) console.log(out.split('\n').filter((l) => /\||threw|FAIL|Error/.test(l)).slice(0, 20).map((l) => '     ' + l).join('\n'));
}
const failed = results.filter((r) => !r.clean);
console.log(failed.length === 0 ? `ALL ${results.length} FLOWS CLEAN` : `${failed.length} of ${results.length} flows had findings`);
process.exit(failed.length === 0 ? 0 : 1);
