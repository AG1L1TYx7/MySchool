// Bug sweep: log in as every demo role, visit every navigation page and the main detail pages,
// and record console errors, page errors, failed requests and 4xx/5xx API responses.
import { launch, BASE, outDir } from './lib.mjs';
import { realFindings, summarize } from './check-rules.mjs';
import { writeFileSync } from 'node:fs';
const out = outDir(process.argv[2]);
const ROLES = ['superadmin', 'superintendent', 'principal', 'teacher', 'student', 'parent', 'assistant', 'counselor'];
const browser = await launch();
const findings = [];

for (const role of ROLES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const current = { url: '' };
  const note = (kind, text) => findings.push({ role, page: current.url, kind, text: String(text).slice(0, 300) });
  page.on('console', (m) => { if (m.type() === 'error' && !/RSC payload/.test(m.text())) note('console', m.text()); });
  page.on('pageerror', (e) => note('pageerror', e));
  page.on('requestfailed', (r) => { if (!/_rsc=|\/_next\//.test(r.url())) note('requestfailed', `${r.url()} ${r.failure()?.errorText}`); });
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/v1/') && r.status() >= 400 && !/auth\/refresh/.test(u)) note(`http ${r.status()}`, `${r.request().method()} ${u.replace(BASE + '', '')}`); });

  current.url = '/login';
  await page.goto(BASE + '/login');
  await page.fill('input[name=email]', `${role}@smartschool.local`);
  await page.fill('input[name=password]', 'SmartSchool!Demo2026');
  await page.click('button[type=submit]');
  try {
    await page.waitForURL(/dashboard|security/, { timeout: 20000 });
  } catch {
    note('login', 'did not reach the dashboard: ' + page.url());
    await ctx.close();
    continue;
  }
  const navLinks = await page.locator('nav a').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  const visited = new Set();
  const visit = async (href) => {
    if (!href || visited.has(href)) return;
    visited.add(href);
    current.url = href;
    console.log(`visit ${role} ${href} ${new Date().toISOString().slice(11, 19)}`);
    try {
      await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(800);
      const alerts = await page.locator('[role=alert]').allInnerTexts();
      for (const a of alerts) if (a.trim()) note('alert', a.trim());
      const loading = await page.locator('text=/^Loading…$/').count();
      if (loading) note('stuck', 'page still shows Loading… after network idle');
    } catch (e) {
      note('navigation', e.message.split('\n')[0]);
    }
  };
  for (const href of navLinks) await visit(href);
  if (navLinks.includes('/classes')) await visit('/attendance/today');
  if (navLinks.includes('/report-cards')) { await page.goto(BASE + '/report-cards', { waitUntil: 'networkidle' }).catch(() => undefined); const rc = await page.locator('main a[href^="/report-cards/"]').first().getAttribute('href').catch(() => null); if (rc) await visit(rc); }
  // Detail pages: first link in each list page
  for (const list of ['/courses', '/classes', '/assignments', '/students', '/content', '/organizations', '/announcements', '/messages']) {
    if (!navLinks.includes(list)) continue;
    current.url = list;
    await page.goto(`${BASE}${list}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => undefined);
    const detail = await page.locator(`main a[href^="${list}/"]:not([href$="/new"]):not([href$="/import"])`).first().getAttribute('href').catch(() => null);
    if (detail) await visit(detail);
  }
  if (navLinks.includes('/classes')) {
    await page.goto(BASE + '/classes', { waitUntil: 'networkidle' }).catch(() => undefined);
    const klass = await page.locator('main a[href^="/classes/"]:not([href$="/new"])').first().getAttribute('href').catch(() => null);
    if (klass) for (const sub of ['assignments', 'gradebook', 'attendance', 'motivation', 'learning', 'insight']) await visit(`${klass}/${sub}`);
  }
  console.log(`${role}: visited ${visited.size} pages, ${findings.filter((f) => f.role === role).length} findings`);
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/sweep.json`, JSON.stringify(findings, null, 2));
const grouped = {};
for (const f of findings) (grouped[`${f.kind} | ${f.text}`] ??= []).push(`${f.role}@${f.page}`);
for (const [k, v] of Object.entries(grouped)) console.log(`${v.length}x ${k}\n     ${[...new Set(v)].slice(0, 6).join(', ')}`);
const real = realFindings(findings);
console.log(summarize('SWEEP', real.length, `${findings.length - real.length} cancelled navigations discounted`));
process.exit(real.length === 0 ? 0 : 1);
