// Secret scan (slice 33): every tracked text file, or only the staged ones with --staged (the pre-commit hook).
//   pnpm secrets:scan              # whole repository, as CI runs it
//   pnpm secrets:scan --staged     # what is about to be committed
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { findSecrets, isScannable, summarize } from './secret-rules.mjs';

const staged = process.argv.includes('--staged');
const list = execFileSync('git', staged ? ['diff', '--cached', '--name-only', '--diff-filter=ACM'] : ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);
const findings = [];
let scanned = 0;
for (const path of list) {
  if (!isScannable(path)) continue;
  let text;
  try {
    if (statSync(path).size > 2 * 1024 * 1024) continue;
    text = readFileSync(path, 'utf8');
  } catch {
    continue;
  }
  if (text.includes('\u0000')) continue;
  scanned += 1;
  for (const f of findSecrets(path, text)) findings.push({ path, ...f });
}
for (const f of findings) console.log(`  ${f.path}:${f.line} [${f.id}] ${f.snippet}`);
console.log(`${summarize(findings)} (${scanned} files${staged ? ', staged' : ''})`);
process.exit(findings.length ? 1 : 0);
