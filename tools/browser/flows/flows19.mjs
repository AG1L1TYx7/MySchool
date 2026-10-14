// Slice 19 user flows through the real UI: the compliance screens for a principal, the family's copy of records
// and deletion request, the legal hold on a student page, the skip link, and what teachers cannot open.
import { launch, BASE, outDir } from '../lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const stamp = Date.now();
const findings = [];
const note = (step, text) => findings.push({ step, text });
let current = 'start';
const pages = {};
const OUT = outDir(process.argv[2] ?? 'out19');
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
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), trigger()]);
  const name = dl.suggestedFilename();
  if (!pattern.test(name)) note(step, `download named ${name}`);
}

const principal = await login('principal');
await step('skip link is the first focusable element and lands on the main content', 'principal', async () => {
  await principal.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await principal.keyboard.press('Tab');
  const text = await principal.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  if (!/Skip to main content/.test(text)) note(current, `first focus was "${text}"`);
  await principal.keyboard.press('Enter');
  await principal.waitForTimeout(300);
  const onMain = await principal.evaluate(() => document.activeElement?.id === 'main-content' || location.hash === '#main-content');
  if (!onMain) note(current, 'skip link did not move focus to main');
});
await step('principal reads the data map, saves retention and applies it', 'principal', async () => {
  await principal.getByRole('link', { name: 'Compliance' }).click();
  await principal.waitForURL(/\/compliance/);
  await expectText(principal, 'Data map', current);
  await expectText(principal, 'Students', current);
  await expectText(principal, 'AiConversations', current);
  await principal.screenshot({ path: `${OUT}/principal-data-map.png`, fullPage: true });
  await principal.getByRole('radio', { name: 'Retention' }).click();
  await expectText(principal, 'AI tutor conversations', current);
  const field = principal.getByLabel(/In-app notifications/);
  await field.fill('200');
  await principal.getByRole('button', { name: 'Save', exact: true }).click();
  await expectText(principal, 'Retention saved', current);
  await principal.getByRole('button', { name: 'Apply now' }).click();
  await expectText(principal, /Removed now|Nothing was old enough/, current);
  await field.fill('180');
  await principal.getByRole('button', { name: 'Save', exact: true }).click();
  await expectText(principal, 'Retention saved', current);
});
await step('principal opens, contains, notifies and closes an incident', 'principal', async () => {
  await principal.getByRole('radio', { name: 'Incidents' }).click();
  await expectText(principal, 'Open an incident', current);
  const title = principal.getByRole('textbox', { name: 'Title', exact: true });
  await title.waitFor({ state: 'visible' });
  await title.fill(`Flow incident ${stamp}`);
  if ((await title.inputValue()) !== `Flow incident ${stamp}`) await title.fill(`Flow incident ${stamp}`);
  await principal.getByLabel('Severity', { exact: true }).selectOption('high');
  await principal.getByLabel('What happened', { exact: true }).fill('A misdirected email with a class roster.');
  await principal.getByLabel('People affected (estimate)').fill('24');
  await principal.getByRole('button', { name: 'Open incident' }).click();
  await expectText(principal, 'Incident opened', current);
  await expectText(principal, `Flow incident ${stamp}`, current);
  await principal.getByRole('button', { name: 'Contained' }).first().click();
  await expectText(principal, 'Marked contained', current);
  await principal.getByRole('button', { name: 'Notify administrators' }).first().click();
  await expectText(principal, /Notified \d+ administrators/, current);
  await principal.screenshot({ path: `${OUT}/principal-incidents.png`, fullPage: true });
  await principal.getByRole('button', { name: 'Close', exact: true }).first().click();
  await expectText(principal, 'Closed.', current);
});

const parent = await login('parent');
await step('parent downloads a copy of the records and asks for erasure', 'parent', async () => {
  await parent.goto(`${BASE}/family`, { waitUntil: 'networkidle' });
  await expectText(parent, 'Your records', current);
  await expectDownload(parent, () => parent.getByRole('button', { name: 'Download a copy of the records' }).first().click(), current, /^records-.*\.zip$/);
  const ask = parent.getByRole('button', { name: 'Ask the school to erase these records' }).first();
  if (await ask.count()) {
    await ask.click();
    await expectText(parent, /Request sent|waiting for the school/, current);
  } else await expectText(parent, /waiting for the school|Deletion approved/, current);
  await parent.screenshot({ path: `${OUT}/parent-records.png`, fullPage: true });
  await parent.getByRole('combobox', { name: 'Language' }).first().selectOption('es');
  await parent.waitForTimeout(800);
  await expectText(parent, 'Sus registros', current);
  await parent.getByRole('combobox', { name: 'Idioma' }).first().selectOption('en');
  await parent.waitForTimeout(800);
});
await step('principal sees the request, sets and lifts a legal hold on the student, and declines the request', 'principal', async () => {
  await principal.goto(`${BASE}/compliance?tab=deletion`, { waitUntil: 'networkidle' });
  await expectText(principal, 'Deletion requests', current);
  await expectText(principal, 'Johnson', current);
  await principal.goto(`${BASE}/students`, { waitUntil: 'networkidle' });
  const href = await principal.locator('main a[href^="/students/"]', { hasText: 'Johnson' }).first().getAttribute('href');
  await principal.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
  await expectText(principal, 'Records and retention', current);
  await principal.getByRole('button', { name: 'Set legal hold' }).click();
  await expectText(principal, 'Legal hold set', current);
  await principal.getByRole('button', { name: 'Lift legal hold' }).click();
  await expectText(principal, 'Legal hold lifted', current);
  await principal.screenshot({ path: `${OUT}/principal-student-records.png`, fullPage: true });
  await principal.goto(`${BASE}/compliance?tab=deletion`, { waitUntil: 'networkidle' });
  const decline = principal.getByRole('button', { name: 'Decline' }).first();
  if (await decline.count()) {
    await decline.click();
    await expectText(principal, 'Declined.', current);
  }
});

const teacher = await login('teacher');
await step('teacher cannot open compliance', 'teacher', async () => {
  await teacher.goto(`${BASE}/compliance`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'Not available for your account', current);
});

await browser.close();
writeFileSync(`${OUT}/flows19.json`, JSON.stringify(findings, null, 2));
for (const f of findings) console.log(`${f.step} | ${f.text}`);
console.log(findings.length === 0 ? 'FLOWS19 CLEAN' : `${findings.length} flow findings`);
