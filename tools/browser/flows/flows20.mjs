// Slice 20 user flows through the real UI: the superintendent's district page (overview, reports, policies,
// state exports), the platform administrator's tenants page and district picker, the branded sign-in page,
// and what a principal cannot open.
import { launch, BASE, outDir } from '../lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const stamp = Date.now();
const findings = [];
const note = (step, text) => findings.push({ step, text });
let current = 'start';
const pages = {};
const OUT = outDir(process.argv[2] ?? 'out20');
mkdirSync(OUT, { recursive: true });
const browser = await launch();

async function login(role) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_ABORTED|403|404/.test(m.text())) note(current, `console: ${m.text().slice(0, 200)}`); });
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/v1/') && r.status() >= 400 && !/auth\/refresh/.test(u)) note(current, `http ${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=email]', `${role}@smartschool.local`);
  await page.fill('input[name=password]', 'SmartSchool!Demo2026');
  await page.click('button[type=submit]');
  await page.waitForURL(/dashboard|security/, { timeout: 20000 });
  pages[role] = page;
  return page;
}
async function expectText(page, text, step, timeout = 10000) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout });
  } catch {
    note(step, `expected to see "${text}" but did not`);
  }
}
let shot = 0;
async function step(name, who, fn) {
  current = name;
  try {
    await fn();
    console.log('ok   ', name);
  } catch (e) {
    note(name, `threw: ${e.message.split('\n')[0]}`);
    console.log('FAIL ', name, e.message.split('\n')[0]);
    await pages[who]?.screenshot({ path: `${OUT}/flow-fail-${++shot}.png`, fullPage: true }).catch(() => undefined);
  }
}
async function expectDownload(page, trigger, step, pattern) {
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), trigger()]);
  const name = dl.suggestedFilename();
  if (!pattern.test(name)) note(step, `download named ${name}`);
}

await step('sign-in page shows the hosting district', 'none', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await expectText(page, 'Demo District', current);
  await page.screenshot({ path: `${OUT}/login-branded.png` });
  await ctx.close();
});

const sup = await login('superintendent');
await step('superintendent sees every school on the district overview', 'superintendent', async () => {
  await sup.goto(`${BASE}/district`, { waitUntil: 'networkidle' });
  await expectText(sup, 'Demo School', current);
  await expectText(sup, 'Schools', current);
  await sup.screenshot({ path: `${OUT}/district-overview.png`, fullPage: true });
});
await step('superintendent downloads a cross-school report', 'superintendent', async () => {
  await sup.getByRole('radio', { name: 'Reports' }).click();
  await expectText(sup, 'Schools at a glance', current);
  await expectDownload(sup, () => sup.getByRole('button', { name: 'Download CSV' }).first().click(), current, /^district-schools/);
});
await step('superintendent changes a district policy and sees it saved', 'superintendent', async () => {
  await sup.getByRole('radio', { name: 'Policies' }).click();
  await expectText(sup, 'Schools may turn on student-to-student messaging', current);
  const features = sup.locator('#district-features');
  await features.waitFor({ timeout: 10000 });
  await features.fill('h5p.nothing-such');
  await sup.getByRole('button', { name: 'Save policies' }).click();
  await expectText(sup, 'Policies saved', current);
  // Undo so later checks and demo accounts are unaffected.
  await features.fill('');
  await sup.getByRole('button', { name: 'Save policies' }).click();
  await expectText(sup, 'Policies saved', current);
  await sup.screenshot({ path: `${OUT}/district-policies.png`, fullPage: true });
});
await step('superintendent downloads a state export', 'superintendent', async () => {
  await sup.getByRole('radio', { name: 'State reporting' }).click();
  await expectText(sup, 'Enrollment', current);
  await expectDownload(sup, () => sup.getByRole('button', { name: 'Download CSV' }).first().click(), current, /^state-enrollment/);
});

const admin = await login('superadmin');
await step('platform administrator creates a tenant and sees its DNS record', 'superadmin', async () => {
  await admin.goto(`${BASE}/tenants`, { waitUntil: 'networkidle' });
  await expectText(admin, 'Demo District', current);
  await admin.fill('#tenant-name', `Flow District ${stamp}`);
  await admin.getByRole('button', { name: 'Create' }).click();
  await expectText(admin, `Flow District ${stamp}`, current);
  const card = admin.locator('section', { hasText: `Flow District ${stamp}` }).first();
  await card.locator('input[id^=tenant-domain-]').fill(`flow-${stamp}.example.invalid`);
  await card.getByRole('button', { name: 'Save' }).click();
  await expectText(admin, `_smartschool.flow-${stamp}.example.invalid`, current);
  await admin.screenshot({ path: `${OUT}/tenants.png`, fullPage: true });
});
await step('platform administrator switches districts on the district page', 'superadmin', async () => {
  await admin.goto(`${BASE}/district`, { waitUntil: 'networkidle' });
  await admin.selectOption('#district-tenant', { label: `Flow District ${stamp}` });
  await expectText(admin, 'No schools in this district yet', current);
});

const principal = await login('principal');
await step('principal cannot open the district page or tenants', 'principal', async () => {
  await principal.goto(`${BASE}/district`, { waitUntil: 'networkidle' });
  await expectText(principal, 'Not available for your account', current);
  await principal.goto(`${BASE}/tenants`, { waitUntil: 'networkidle' });
  await expectText(principal, 'Not available for your account', current);
});

await browser.close();
writeFileSync(`${OUT}/flows20.json`, JSON.stringify(findings, null, 2));
for (const f of findings) console.log(`${f.step} | ${f.text}`);
console.log(findings.length === 0 ? 'FLOWS20 CLEAN' : `${findings.length} flow findings`);
