// WCAG 2.2 AA at phone width (360 x 740): axe-core on every page as each role, plus the reflow check
// (1.4.10: no horizontal page scroll at 320 CSS px of content width) and text zoom at 200% on three pages.
import { launch, BASE, outDir, axeSource } from './lib.mjs';
import { writeFileSync } from 'node:fs';
const out = outDir(process.argv[2]);
const axe = axeSource();
const ROLES = ['teacher', 'student', 'parent', 'principal', 'counselor'];
const PUBLIC = ['/login', '/register', '/forgot-password'];
const browser = await launch();
const results = [];
const reflow = [];

async function audit(page, role, url) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => undefined);
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth }));
  if (overflow.scroll > overflow.inner + 1) reflow.push({ role, url, ...overflow });
  await page.addScriptTag({ content: axe });
  const r = await page.evaluate(async () => {
    const res = await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] } });
    return res.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 160) })), count: v.nodes.length }));
  });
  for (const v of r) results.push({ role, url, ...v });
  return r.length;
}

const viewport = { width: 360, height: 740, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const pub = await (await browser.newContext({ viewport })).newPage();
for (const url of PUBLIC) await audit(pub, 'public', url);

for (const role of ROLES) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  await page.goto(BASE + '/login');
  await page.fill('input[name=email]', `${role}@smartschool.local`);
  await page.fill('input[name=password]', 'SmartSchool!Demo2026');
  await page.click('button[type=submit]');
  await page.waitForURL(/dashboard|security/, { timeout: 20000 });
  const links = await page.locator('nav a').evaluateAll((els) => els.map((e) => e.getAttribute('href')));
  const pages = [...new Set(links)];
  for (const list of ['/courses', '/classes', '/assignments', '/students']) {
    if (!links.includes(list)) continue;
    await page.goto(`${BASE}${list}`, { waitUntil: 'networkidle' }).catch(() => undefined);
    const detail = await page.locator(`main a[href^="${list}/"]:not([href$="/new"]):not([href$="/import"])`).first().getAttribute('href').catch(() => null);
    if (detail) pages.push(detail);
  }
  let n = 0;
  for (const url of pages) n += await audit(page, role, url);
  console.log(`${role} @360px: ${pages.length} pages, ${n} violations`);
  await ctx.close();
}

// Text zoom 200% (1.4.4): content still readable and no clipped overflow on three dense pages.
const zoomCtx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const zp = await zoomCtx.newPage();
await zp.goto(BASE + '/login');
await zp.fill('input[name=email]', 'principal@smartschool.local');
await zp.fill('input[name=password]', 'SmartSchool!Demo2026');
await zp.click('button[type=submit]');
await zp.waitForURL(/dashboard|security/, { timeout: 20000 });
for (const url of ['/dashboard', '/insight', '/compliance']) {
  await zp.goto(`${BASE}${url}`, { waitUntil: 'networkidle' }).catch(() => undefined);
  await zp.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await zp.waitForTimeout(500);
  const clipped = await zp.evaluate(() => {
    let n = 0;
    for (const el of document.querySelectorAll('main *')) {
      const cs = getComputedStyle(el);
      if (cs.overflow === 'hidden' && el.scrollWidth > el.clientWidth + 2 && el.textContent && el.textContent.trim().length > 20 && !el.classList.contains('truncate')) n += 1;
    }
    return n;
  });
  if (clipped) reflow.push({ role: 'principal@200%', url, clipped });
}
await zoomCtx.close();
await browser.close();
writeFileSync(`${out}/a11y-mobile.json`, JSON.stringify({ results, reflow }, null, 2));
const byRule = {};
for (const r of results) (byRule[`${r.impact} ${r.id}: ${r.help}`] ??= []).push(`${r.role}${r.url} (${r.count})`);
for (const [k, v] of Object.entries(byRule).sort()) console.log(`${v.length}x ${k}\n     ${[...new Set(v)].slice(0, 6).join(', ')}`);
for (const r of reflow) console.log(`REFLOW ${r.role} ${r.url} ${JSON.stringify(r)}`);
console.log(results.length === 0 && reflow.length === 0 ? 'MOBILE AUDIT CLEAN' : `${results.length} violations, ${reflow.length} reflow findings`);
process.exit(results.length === 0 && reflow.length === 0 ? 0 : 1);
