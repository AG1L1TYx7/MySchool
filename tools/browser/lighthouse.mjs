// Lighthouse (performance, accessibility, best practices) for the public login page and, with a session cookie, the dashboard.
import lighthouse from 'lighthouse';
import { launch, BASE, outDir } from './lib.mjs';
import { budgetVerdict, DEFAULT_BUDGET } from './check-rules.mjs';
import { writeFileSync } from 'node:fs';
const out = outDir(process.argv[2]);
const browser = await launch({ args:  ['--remote-debugging-port=9333'] });
const page = await browser.newPage();
await page.goto(BASE + '/login');
const flags = { port: 9333, output: 'json', logLevel: 'error', onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'], formFactor: 'desktop', screenEmulation: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false }, throttlingMethod: 'devtools' };
const rows = [];
for (const url of [BASE + '/login', BASE + '/register', BASE + '/status']) {
  const r = await lighthouse(url, flags);
  const c = r.lhr.categories;
  rows.push({ url, performance: Math.round(c.performance.score * 100), accessibility: Math.round(c.accessibility.score * 100), bestPractices: Math.round(c['best-practices'].score * 100), seo: Math.round(c.seo.score * 100), lcp: r.lhr.audits['largest-contentful-paint'].displayValue, tbt: r.lhr.audits['total-blocking-time'].displayValue, cls: r.lhr.audits['cumulative-layout-shift'].displayValue });
  const failing = Object.values(r.lhr.audits).filter((a) => a.score !== null && a.score < 0.9 && !a.scoreDisplayMode?.includes('informative')).map((a) => `${a.id} (${Math.round((a.score ?? 0) * 100)})`);
  console.log(url, JSON.stringify(rows[rows.length - 1]), '\n   failing audits:', failing.slice(0, 12).join(', ') || 'none');
}
writeFileSync(`${out}/lighthouse.json`, JSON.stringify(rows, null, 2));
await browser.close();
const verdict = budgetVerdict(rows);
for (const f of verdict.failures) console.log(`budget: ${f.line}`);
console.log(verdict.ok ? `LIGHTHOUSE BUDGET MET (performance ${DEFAULT_BUDGET.performance}, the rest ${DEFAULT_BUDGET.accessibility})` : `${verdict.failures.filter((f) => !f.informational).length} pages below budget`);
process.exit(verdict.ok ? 0 : 1);
