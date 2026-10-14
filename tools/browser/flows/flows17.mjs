// Slice 17 user flows through the real UI: the principal's overview and reports, a teacher's class insight,
// the student page insight card with the transcript, the family transcript download, and what students cannot open.
import { launch, BASE, outDir } from '../lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const stamp = Date.now();
const findings = [];
const note = (step, text) => findings.push({ step, text });
let current = 'start';
const pages = {};
const OUT = outDir(process.argv[2] ?? 'out17');
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
  const path = await dl.path();
  if (!path) note(step, 'download had no file');
  return name;
}

const principal = await login('principal');
await step('principal sees School today on the dashboard and opens Insight', 'principal', async () => {
  await expectText(principal, 'School today', current);
  await expectText(principal, 'Attendance taken', current);
  await principal.getByRole('link', { name: 'Open insight' }).click();
  await principal.waitForURL(/\/insight/);
  await expectText(principal, 'Attendance today', current);
  await expectText(principal, 'Missing work by grade level', current);
  await expectText(principal, 'Students failing by class', current);
  await expectText(principal, 'Gradebook completeness', current);
  await expectText(principal, 'AI usage', current);
  await principal.screenshot({ path: `${OUT}/principal-overview.png`, fullPage: true });
});
await step('principal downloads a CSV report and schedules one by email, runs it now', 'principal', async () => {
  await principal.getByRole('radio', { name: 'Reports and schedules' }).click();
  await expectText(principal, 'Download a report now', current);
  await principal.getByLabel('Report', { exact: true }).first().selectOption('missing_work');
  await expectDownload(principal, () => principal.getByRole('button', { name: 'Download CSV' }).click(), current, /missing_work-\d{4}-\d{2}-\d{2}\.csv/);
  await principal.getByLabel('Name', { exact: true }).fill(`Flow report ${stamp}`);
  await principal.getByLabel('Report to send', { exact: true }).selectOption('failing_students');
  await principal.getByLabel('Recipients (staff emails, comma separated)').fill('teacher@smartschool.local');
  await principal.getByRole('button', { name: 'Save schedule' }).click();
  await expectText(principal, 'Schedule saved', current);
  await expectText(principal, `Flow report ${stamp}`, current);
  await principal.getByRole('button', { name: 'Run now' }).last().click();
  await expectText(principal, /Sent to|no mail transport/, current, 20000);
  await principal.getByRole('button', { name: 'Runs' }).last().click();
  await expectText(principal, /rows/, current);
  await principal.screenshot({ path: `${OUT}/principal-reports.png`, fullPage: true });
  await principal.getByRole('button', { name: 'Delete' }).last().click();
  await principal.waitForTimeout(800);
});
await step('principal opens a student page, sees the Insight card and downloads the transcript', 'principal', async () => {
  await principal.goto(`${BASE}/students`, { waitUntil: 'networkidle' });
  const href = await principal.locator('main a[href^="/students/"]', { hasText: 'Johnson' }).first().getAttribute('href');
  await principal.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
  await expectText(principal, 'Insight', current);
  await expectText(principal, 'Current grades', current);
  await expectDownload(principal, () => principal.getByRole('button', { name: 'Download transcript (PDF)' }).click(), current, /^transcript-.*\.pdf$/);
  await principal.screenshot({ path: `${OUT}/principal-student.png`, fullPage: true });
});

const teacher = await login('teacher');
await step('teacher opens class insight from the class page', 'teacher', async () => {
  await teacher.goto(`${BASE}/classes`, { waitUntil: 'networkidle' });
  const href = await teacher.locator('main a[href^="/classes/"]', { hasText: 'English 7 - Section A' }).first().getAttribute('href');
  await teacher.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
  await teacher.locator('main').getByRole('link', { name: 'Insight', exact: true }).click();
  await teacher.waitForURL(/\/insight/);
  await expectText(teacher, 'Class insight', current);
  await expectText(teacher, 'Grade distribution', current);
  await expectText(teacher, 'Who needs a conversation', current);
  await teacher.screenshot({ path: `${OUT}/teacher-class-insight.png`, fullPage: true });
});
await step('teacher sees only the by-class list on Insight, not the school overview', 'teacher', async () => {
  await teacher.goto(`${BASE}/insight`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'Your classes, one picture each', current);
  if (await teacher.getByText('Attendance today').count()) note(current, 'teacher can see the school overview');
});

const parent = await login('parent');
await step('parent downloads the transcript from the family home, in Spanish too', 'parent', async () => {
  await parent.goto(`${BASE}/family`, { waitUntil: 'networkidle' });
  await expectText(parent, 'Download transcript (PDF)', current);
  await expectDownload(parent, () => parent.getByRole('button', { name: 'Download transcript (PDF)' }).first().click(), current, /^transcript-.*\.pdf$/);
  await parent.getByRole('combobox', { name: 'Language' }).first().selectOption('es');
  await parent.waitForTimeout(800);
  await expectText(parent, 'Descargar el historial académico', current);
  await parent.screenshot({ path: `${OUT}/parent-transcript-es.png`, fullPage: true });
  await parent.getByRole('combobox', { name: 'Idioma' }).first().selectOption('en');
  await parent.waitForTimeout(800);
});
await step('parent and student cannot open Insight', 'parent', async () => {
  await parent.goto(`${BASE}/insight`, { waitUntil: 'networkidle' });
  await expectText(parent, 'Not available for your account', current);
  const student = await login('student');
  await student.goto(`${BASE}/insight`, { waitUntil: 'networkidle' });
  await expectText(student, 'Not available for your account', current);
});

await browser.close();
writeFileSync(`${OUT}/flows17.json`, JSON.stringify(findings, null, 2));
for (const f of findings) console.log(`${f.step} | ${f.text}`);
console.log(findings.length === 0 ? 'FLOWS17 CLEAN' : `${findings.length} flow findings`);
