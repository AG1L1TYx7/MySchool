// Slice 18 user flows through the real UI (needs the real AI service): the Notifications page with the push column
// and devices card; a tutor message written offline that waits, then sends once when the browser is back online.
import { launch, BASE, outDir } from '../lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const stamp = Date.now();
const findings = [];
const note = (step, text) => findings.push({ step, text });
let current = 'start';
const pages = {};
const OUT = outDir(process.argv[2] ?? 'out18');
mkdirSync(OUT, { recursive: true });
const browser = await launch();

async function login(role) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_ABORTED|ERR_INTERNET_DISCONNECTED|403|404/.test(m.text())) note(current, `console: ${m.text().slice(0, 200)}`); });
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/v1/') && r.status() >= 400 && !/auth\/refresh|counselor-notes|accommodations|ai-consent|behavior|conference-notes/.test(u)) note(current, `http ${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=email]', `${role}@smartschool.local`);
  await page.fill('input[name=password]', 'SmartSchool!Demo2026');
  await page.click('button[type=submit]');
  await page.waitForURL(/dashboard|security/, { timeout: 20000 });
  pages[role] = page;
  return { page, ctx };
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

const { page: student, ctx } = await login('student');
await step('student sees the push column and the devices card on Notifications', 'student', async () => {
  await student.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' });
  await expectText(student, 'Preferences', current);
  if ((await student.getByRole('columnheader', { name: 'Push' }).count()) === 0) note(current, 'no Push column');
  await expectText(student, 'Your devices', current);
  await expectText(student, /No devices registered yet|Push is not switched on/, current);
  const box = student.getByLabel(/Grades push to your phone/).first();
  const before = await box.isChecked();
  await box.click();
  await student.waitForTimeout(800);
  await student.reload({ waitUntil: 'networkidle' });
  if ((await student.getByLabel(/Grades push to your phone/).first().isChecked()) === before) note(current, 'push switch did not persist');
  await student.getByLabel(/Grades push to your phone/).first().click();
  await student.waitForTimeout(500);
  await student.screenshot({ path: `${OUT}/student-notifications.png`, fullPage: true });
});
await step('student writes a tutor message offline, sees it wait, and it sends once when back online', 'student', async () => {
  await student.goto(`${BASE}/tutor`, { waitUntil: 'networkidle' });
  const existing = await student.locator('main a[href^="/tutor/"]').first().getAttribute('href').catch(() => null);
  if (existing) await student.goto(`${BASE}${existing}`, { waitUntil: 'networkidle' });
  else {
    await student.getByRole('button', { name: /Start|Empezar/ }).first().click();
    await student.waitForURL(/\/tutor\/[0-9a-f-]+/, { timeout: 20000 });
  }
  await student.waitForTimeout(800);
  await ctx.setOffline(true);
  await student.getByLabel(/Your message|Tu mensaje/).fill(`Offline question ${stamp}: what is a variable?`);
  await student.getByRole('button', { name: /Send|Enviar/ }).click();
  await expectText(student, 'Waiting to send', current);
  await expectText(student, 'You are offline', current);
  await student.screenshot({ path: `${OUT}/student-tutor-offline.png`, fullPage: true });
  await ctx.setOffline(false);
  await student.evaluate(() => window.dispatchEvent(new Event('online')));
  await expectText(student, /Sent now that you are back online/, current, 240000);
  await student.waitForTimeout(1000);
  const waiting = await student.getByText('Waiting to send').count();
  if (waiting) note(current, 'a message still shows Waiting to send after reconnecting');
  const copies = await student.getByText(`Offline question ${stamp}`).count();
  if (copies !== 1) note(current, `expected the message once, found ${copies}`);
  await student.screenshot({ path: `${OUT}/student-tutor-online.png`, fullPage: true });
});
await step('student reads the devices card in Spanish', 'student', async () => {
  await student.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' });
  await student.getByRole('combobox', { name: 'Language' }).first().selectOption('es');
  await student.waitForTimeout(800);
  await expectText(student, 'Tus dispositivos', current);
  await student.screenshot({ path: `${OUT}/student-notifications-es.png`, fullPage: true });
  await student.getByRole('combobox', { name: 'Idioma' }).first().selectOption('en');
  await student.waitForTimeout(800);
});

await browser.close();
writeFileSync(`${OUT}/flows18.json`, JSON.stringify(findings, null, 2));
for (const f of findings) console.log(`${f.step} | ${f.text}`);
console.log(findings.length === 0 ? 'FLOWS18 CLEAN' : `${findings.length} flow findings`);
