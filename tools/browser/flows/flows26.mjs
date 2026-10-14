// Slice 26 user flows through the real UI: the platform administrator looks at billing, issues an invoice for the
// demo district and records a payment, opens an incident that the public status page shows and resolves it;
// the superintendent sees their own billing and sets a security policy; a teacher cannot open billing.
import { launch, BASE, outDir } from '../lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const stamp = Date.now();
const findings = [];
const note = (step, text) => findings.push({ step, text });
let current = 'start';
const pages = {};
const OUT = outDir(process.argv[2] ?? 'out26');
mkdirSync(OUT, { recursive: true });
const browser = await launch();

async function login(role) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_ABORTED|403|404/.test(m.text())) note(current, `console: ${m.text().slice(0, 200)}`); });
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/v1/') && r.status() >= 400 && !/auth\/refresh|counselor-notes|accommodations|ai-consent|behavior|conference-notes/.test(u)) note(current, `http ${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`); });
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
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), trigger()]);
  const name = dl.suggestedFilename();
  if (!pattern.test(name)) note(step, `download named ${name}`);
}

const admin = await login('superadmin');
await step('platform administrator sees every district and the demo subscription', 'superadmin', async () => {
  await admin.goto(`${BASE}/billing`, { waitUntil: 'networkidle' });
  await expectText(admin, 'Monthly recurring', current);
  await admin.getByRole('button', { name: 'Demo District' }).first().click();
  await expectText(admin, 'Students billed', current);
  await admin.screenshot({ path: `${OUT}/billing-admin.png`, fullPage: true });
});
await step('platform administrator issues an invoice, downloads the PDF and records the payment', 'superadmin', async () => {
  await admin.getByRole('radio', { name: 'Invoices' }).click();
  await admin.getByRole('button', { name: 'Issue invoice for this period' }).click();
  const issued = await admin.getByText('Invoice issued for the current period.').first().waitFor({ timeout: 10000 }).then(() => true).catch(() => false);
  if (!issued) await expectText(admin, 'already has invoice', current);
  const first = admin.locator('main li').filter({ hasText: /INV-/ }).first();
  await first.waitFor({ timeout: 10000 });
  await expectDownload(admin, () => first.getByRole('button', { name: 'PDF' }).click(), current, /^INV-/);
  const openOne = admin.locator('main li').filter({ hasText: /Open|Overdue/ }).first();
  if (await openOne.count()) {
    await openOne.getByRole('button', { name: /INV-/ }).click();
    await openOne.locator('input[id^=ref-]').fill(`CHK ${stamp}`);
    await openOne.getByRole('button', { name: 'Record payment' }).click();
    await expectText(admin, 'recorded as paid', current);
  }
  await admin.screenshot({ path: `${OUT}/invoices.png`, fullPage: true });
});
const incidentTitle = `AI tutor slow ${stamp}`;
await step('platform administrator opens an incident under Operations', 'superadmin', async () => {
  await admin.goto(`${BASE}/operations`, { waitUntil: 'networkidle' });
  await admin.getByRole('button', { name: 'Run a health check now' }).click();
  await expectText(admin, 'Checked.', current);
  await admin.getByRole('button', { name: 'Open an incident or plan maintenance' }).click();
  await admin.fill('#inc-title', incidentTitle);
  await admin.fill('#inc-message', 'Answers from the tutor are slow. We are looking into it.');
  await admin.selectOption('#inc-impact', 'major');
  await admin.getByLabel('API', { exact: true }).uncheck();
  await admin.getByLabel('AI service', { exact: true }).check();
  await admin.getByRole('button', { name: 'Open incident' }).click();
  await expectText(admin, 'It is on the status page now', current);
  await admin.screenshot({ path: `${OUT}/operations.png`, fullPage: true });
});
await step('the public status page shows the incident and the affected component without signing in', 'none', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/status`, { waitUntil: 'networkidle' });
  await expectText(page, 'Part of the service is down', current);
  await expectText(page, incidentTitle, current);
  await page.screenshot({ path: `${OUT}/status.png`, fullPage: true });
  await ctx.close();
});
await step('platform administrator resolves the incident', 'superadmin', async () => {
  const row = admin.locator('main li').filter({ hasText: incidentTitle }).first();
  await row.locator('select[id^=inc-status-]').selectOption('resolved');
  await row.locator('input[id^=inc-update-]').fill('A model restart fixed it.');
  await row.getByRole('button', { name: 'Post update' }).click();
  await expectText(admin, 'Updated.', current);
  await expectText(row, 'Resolved', current);
});

const sup = await login('superintendent');
await step('superintendent sees only their district and sets the security policy', 'superintendent', async () => {
  await sup.goto(`${BASE}/billing`, { waitUntil: 'networkidle' });
  await expectText(sup, 'Demo District', current);
  await expectText(sup, 'Students billed', current);
  if (await sup.getByRole('radio', { name: 'All districts' }).count()) note(current, 'superintendent saw the all-districts tab');
  await sup.goto(`${BASE}/district?tab=policies`, { waitUntil: 'networkidle' });
  await sup.fill('#district-pw-min', '14');
  await sup.getByRole('button', { name: 'Save policies' }).click();
  await expectText(sup, 'Policies saved', current);
  await sup.reload({ waitUntil: 'networkidle' });
  const v = await sup.inputValue('#district-pw-min');
  if (v !== '14') note(current, `password minimum shows ${v}`);
  await sup.fill('#district-pw-min', '12');
  await sup.getByRole('button', { name: 'Save policies' }).click();
  await expectText(sup, 'Policies saved', current);
  await sup.screenshot({ path: `${OUT}/policies.png`, fullPage: true });
});

const teacher = await login('teacher');
await step('teacher cannot open billing or operations', 'teacher', async () => {
  await teacher.goto(`${BASE}/billing`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'Not available for your account', current);
  await teacher.goto(`${BASE}/operations`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'Not available for your account', current);
});

await browser.close();
writeFileSync(`${OUT}/flows26.json`, JSON.stringify(findings, null, 2));
for (const f of findings) console.log(`${f.step} | ${f.text}`);
console.log(findings.length === 0 ? 'FLOWS26 CLEAN' : `${findings.length} flow findings`);
