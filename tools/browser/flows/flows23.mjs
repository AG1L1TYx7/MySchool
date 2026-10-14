// Slice 23 user flows through the real UI: the student's learning page with the health score and next steps,
// the teacher building a path from a student's page, the student ticking a step, the class paths card,
// and the parent reading the child's profile from the student page.
import { launch, BASE, outDir } from '../lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const findings = [];
const note = (step, text) => findings.push({ step, text });
let current = 'start';
const pages = {};
const OUT = outDir(process.argv[2] ?? 'out23');
mkdirSync(OUT, { recursive: true });
const browser = await launch();

async function login(role) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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

const student = await login('student');
await step('student sees the learning health score, its parts and next steps', 'student', async () => {
  await student.goto(`${BASE}/paths`, { waitUntil: 'networkidle' });
  await expectText(student, 'How learning is going', current);
  await expectText(student, 'Mastery', current);
  await expectText(student, 'Engagement', current);
  await expectText(student, 'Next steps', current);
  await student.screenshot({ path: `${OUT}/student-learning.png`, fullPage: true });
});

const teacher = await login('teacher');
let studentUrl = '';
await step('teacher builds a path from the student page', 'teacher', async () => {
  await teacher.goto(`${BASE}/students`, { waitUntil: 'networkidle' });
  await teacher.getByRole('link', { name: /Johnson/ }).first().click();
  await teacher.waitForURL(/\/students\/[0-9a-f-]+$/, { timeout: 15000 });
  studentUrl = teacher.url();
  await expectText(teacher, 'learning health', current);
  await teacher.getByRole('button', { name: 'Build a path from mastery' }).click();
  await expectText(teacher, 'built from mastery', current, 30000);
  await teacher.screenshot({ path: `${OUT}/teacher-path.png`, fullPage: true });
});

await step('student ticks a step on the new path', 'student', async () => {
  await student.goto(`${BASE}/paths`, { waitUntil: 'networkidle' });
  await expectText(student, 'My paths', current);
  await student.getByRole('button', { name: 'Done', exact: true }).first().click();
  await expectText(student, 'Marked done by the student', current);
});

await step('teacher sees the path on the class learning page', 'teacher', async () => {
  await teacher.goto(`${BASE}/classes`, { waitUntil: 'networkidle' });
  await teacher.getByRole('link', { name: /English 7 - Section A/ }).first().click();
  await teacher.waitForURL(/\/classes\/[0-9a-f-]+$/, { timeout: 15000 });
  await teacher.goto(`${teacher.url()}/learning`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'Learning paths', current);
  await expectText(teacher, 'Emma Johnson', current);
});

await step('teacher archives the path so the demo data stays clean', 'teacher', async () => {
  await teacher.goto(studentUrl, { waitUntil: 'networkidle' });
  await teacher.getByRole('button', { name: 'Archive' }).first().click();
  await expectText(teacher, 'Reactivate', current);
});

const parent = await login('parent');
await step('parent cannot open the student learning page meant for students', 'parent', async () => {
  await parent.goto(`${BASE}/paths`, { waitUntil: 'networkidle' });
  await expectText(parent, 'Not available for your account', current);
});

await browser.close();
writeFileSync(`${OUT}/flows23.json`, JSON.stringify(findings, null, 2));
for (const f of findings) console.log(`${f.step} | ${f.text}`);
console.log(findings.length === 0 ? 'FLOWS23 CLEAN' : `${findings.length} flow findings`);
