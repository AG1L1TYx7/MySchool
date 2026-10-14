// Slice 14 user flows through the real UI: a student finishes a lesson and sees XP, streak, a badge and the
// progress map; the teacher console awards a badge and starts a class quest; the parent sees the private view.
import { launch, BASE, outDir } from '../lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const stamp = Date.now();
const findings = [];
const note = (step, text) => findings.push({ step, text });
let current = 'start';
const pages = {};
const OUT = outDir(process.argv[2] ?? 'out14');
mkdirSync(OUT, { recursive: true });
const browser = await launch();

async function login(role) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_ABORTED|403/.test(m.text())) note(current, `console: ${m.text().slice(0, 200)}`); });
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/v1/') && r.status() >= 400 && !/auth\/refresh|counselor-notes|accommodations|ai-consent|behavior|conference-notes|motivation\/awards/.test(u)) note(current, `http ${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`); });
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
await step('student sees the progress card and the XP pill on the dashboard', 'student', async () => {
  await expectText(student, 'Your progress', current);
  await student.locator('header a[href="/motivation"]').first().waitFor({ timeout: 15000 }).catch(() => note(current, 'XP pill missing from the header'));
});
await step('student opens a course, sees the path and marks a lesson finished', 'student', async () => {
  await student.goto(`${BASE}/courses`, { waitUntil: 'networkidle' });
  const href = await student.locator('main a[href^="/courses/"]', { hasText: 'English Language Arts 7' }).first().getAttribute('href');
  await student.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
  await expectText(student, 'Your path', current);
  await student.locator('main button', { hasText: '1.2' }).first().click();
  const btn = student.getByRole('button', { name: /Mark lesson finished|Finished/ }).first();
  await btn.waitFor({ timeout: 10000 });
  const label = await btn.innerText();
  if (/Mark lesson finished/.test(label)) {
    await btn.click();
    await expectText(student, /Lesson finished|Level|New badge|already finished/, current);
  }
  await student.screenshot({ path: `${OUT}/student-course-path.png`, fullPage: true });
});
await step('student reads the private progress page', 'student', async () => {
  await student.goto(`${BASE}/motivation`, { waitUntil: 'networkidle' });
  await expectText(student, 'My progress', current);
  await expectText(student, 'Badges', current);
  await expectText(student, 'Quests this week', current);
  await expectText(student, 'Recent rewards', current);
  const rank = await student.getByText(/rank|leaderboard/i).count();
  if (rank) note(current, 'ranking words on the progress page');
  await student.screenshot({ path: `${OUT}/student-progress.png`, fullPage: true });
});

const teacher = await login('teacher');
await step('teacher opens the class motivation console, awards a badge and starts a quest', 'teacher', async () => {
  await teacher.goto(`${BASE}/classes`, { waitUntil: 'networkidle' });
  const href = await teacher.locator('main a[href^="/classes/"]', { hasText: 'English 7 - Section A' }).first().getAttribute('href');
  await teacher.goto(`${BASE}${href}/motivation`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'Motivation', current);
  await expectText(teacher, 'Johnson, Emma', current);
  await teacher.getByLabel('Student', { exact: true }).selectOption({ label: 'Johnson, Emma' });
  await teacher.getByLabel('Badge', { exact: true }).first().check();
  await teacher.getByLabel('Reason', { exact: true }).fill(`Flow helper ${stamp}`);
  await teacher.getByRole('button', { name: 'Award' }).click();
  await expectText(teacher, /Awarded\.|already has that badge/, current);
  await teacher.getByLabel('Title', { exact: true }).fill(`Flow quest ${stamp}`);
  await teacher.getByLabel('Class goal').fill('5');
  await teacher.getByRole('button', { name: 'Start quest' }).click();
  await expectText(teacher, 'Quest started.', current);
  await expectText(teacher, `Flow quest ${stamp}`, current);
  await teacher.screenshot({ path: `${OUT}/teacher-console.png`, fullPage: true });
});
await step('teacher never sees a ranking and can open one student’s page', 'teacher', async () => {
  const rank = await teacher.getByText(/rank|leaderboard/i).count();
  if (rank) note(current, 'ranking words on the console');
  await teacher.locator('main a[href^="/motivation?studentId="]', { hasText: 'Johnson, Emma' }).first().click();
  await expectText(teacher, 'Emma Johnson', current);
  await expectText(teacher, 'Badges', current);
});

const parent = await login('parent');
await step('parent sees progress and rewards on the family home', 'parent', async () => {
  await parent.goto(`${BASE}/family`, { waitUntil: 'networkidle' });
  await expectText(parent, 'Progress and rewards', current);
  await expectText(parent, 'Latest badges', current);
  await parent.getByRole('link', { name: 'See everything' }).first().click();
  await expectText(parent, 'Emma Johnson', current);
  await parent.screenshot({ path: `${OUT}/parent-progress.png`, fullPage: true });
});
await step('parent in Spanish reads the same screens in Spanish', 'parent', async () => {
  await parent.locator('header select').first().selectOption('es');
  await parent.goto(`${BASE}/family`, { waitUntil: 'networkidle' });
  await expectText(parent, 'Progreso y recompensas', current);
  await parent.locator('header select').first().selectOption('en');
  await expectText(parent, 'My family', current);
});

await browser.close();
writeFileSync(`${OUT}/flows14.json`, JSON.stringify(findings, null, 2));
for (const f of findings) console.log(`${f.step} | ${f.text}`);
console.log(findings.length === 0 ? 'FLOWS14 CLEAN' : `${findings.length} flow findings`);
