// WCAG 2.2 AA audit with axe-core on every page, as each role. Writes a JSON report and prints violations by rule.
import { launch, BASE, outDir, axeSource } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const out = outDir(process.argv[2]);
const axe = axeSource();
const ROLES = ['teacher', 'student', 'parent', 'principal', 'superadmin', 'counselor'];
const PUBLIC = ['/login', '/register', '/forgot-password', '/login/2fa', '/verify-email', '/reset-password'];
const browser = await launch();
const results = [];

async function audit(page, role, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(600);
  await page.addScriptTag({ content: axe });
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, tags: v.tags.filter((t) => t.startsWith('wcag')), nodes: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 160) })), count: v.nodes.length }));
  });
  for (const v of r) results.push({ role, url, ...v });
  return r.length;
}

const pub = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
for (const url of PUBLIC) await audit(pub, 'public', url);

for (const role of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login');
  await page.fill('input[name=email]', `${role}@smartschool.local`);
  await page.fill('input[name=password]', 'SmartSchool!Demo2026');
  await page.click('button[type=submit]');
  await page.waitForURL(/dashboard|security/, { timeout: 20000 });
  const links = await page.locator('nav a').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  const pages = [...links];
  if (links.includes('/classes')) pages.push('/attendance/today');
  if (links.includes('/report-cards')) { await page.goto(BASE + '/report-cards', { waitUntil: 'networkidle' }).catch(() => undefined); const rc = await page.locator('main a[href^="/report-cards/"]').first().getAttribute('href').catch(() => null); if (rc) pages.push(rc); }
  for (const list of ['/courses', '/classes', '/assignments', '/students', '/content', '/organizations', '/announcements', '/messages', '/tutor']) {
    if (!links.includes(list)) continue;
    await page.goto(`${BASE}${list}`, { waitUntil: 'networkidle' }).catch(() => undefined);
    const detail = await page.locator(`main a[href^="${list}/"]:not([href$="/new"]):not([href$="/import"])`).first().getAttribute('href').catch(() => null);
    if (detail) pages.push(detail);
  }
  if (links.includes('/classes')) {
    await page.goto(BASE + '/classes', { waitUntil: 'networkidle' }).catch(() => undefined);
    const klass = await page.locator('main a[href^="/classes/"]:not([href$="/new"])').first().getAttribute('href').catch(() => null);
    if (klass && role !== 'student' && role !== 'parent') pages.push(`${klass}/assignments`, `${klass}/gradebook`, `${klass}/attendance`, `${klass}/motivation`, `${klass}/learning`, `${klass}/insight`);
  }
  if (role === 'principal') pages.push('/classes/new', '/courses/new', '/students/new', '/students/import');
  let n = 0;
  for (const url of [...new Set(pages)]) n += await audit(page, role, url);
  console.log(`${role}: ${new Set(pages).size} pages, ${n} violations`);
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/a11y.json`, JSON.stringify(results, null, 2));
const byRule = {};
for (const r of results) (byRule[`${r.impact} ${r.id}: ${r.help}`] ??= []).push(`${r.role}${r.url} (${r.count})`);
for (const [k, v] of Object.entries(byRule).sort()) console.log(`${v.length}x ${k}\n     ${[...new Set(v)].slice(0, 6).join(', ')}`);
console.log(results.length === 0 ? 'NO VIOLATIONS' : `${results.length} violations across ${Object.keys(byRule).length} rules`);
process.exit(results.length === 0 ? 0 : 1);
