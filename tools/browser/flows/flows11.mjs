// End-to-end user flows through the real UI for slices 10 and 11, as a teacher, principal, student and parent.
// Every step asserts what a person would see; console errors and failed API calls are collected as findings.
import { launch, BASE, outDir } from '../lib.mjs';
import { writeFileSync } from 'node:fs';

const stamp = Date.now();
const findings = [];
const note = (step, text) => findings.push({ step, text });
let current = 'start';
const browser = await launch();

async function login(role) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_ABORTED/.test(m.text())) note(current, `console: ${m.text().slice(0, 200)}`); });
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/v1/') && r.status() >= 400 && !/auth\/refresh/.test(u)) note(current, `http ${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`); });
  await page.goto(`${BASE}/login`);
  await page.fill('input[name=email]', `${role}@smartschool.local`);
  await page.fill('input[name=password]', 'SmartSchool!Demo2026');
  await page.click('button[type=submit]');
  await page.waitForURL(/dashboard|security/, { timeout: 20000 });
  pages[role] = page;
  return page;
}
async function expectText(page, text, step) {
  try {
    await page.getByText(text, { exact: false }).first().waitFor({ timeout: 10000 });
  } catch {
    note(step, `expected to see "${text}" but did not`);
  }
}
let shot = 0;
const pages = {};
async function step(name, fn) {
  current = name;
  try {
    await fn();
    console.log('ok   ', name);
  } catch (e) {
    note(name, `threw: ${e.message.split('\n')[0]}`);
    console.log('FAIL ', name, e.message.split('\n')[0]);
    const who = /principal/.test(name) ? 'principal' : /student/.test(name) ? 'student' : 'teacher';
    await pages[who]?.screenshot({ path: `${OUT}/flow-fail-${++shot}.png`, fullPage: true }).catch(() => undefined);
  }
}

// ----------------------------------------------------------------------------- principal: structure, scales
const principal = await login('principal');
let orgHref = '';
await step('principal opens the organisation page', async () => {
  await principal.goto(`${BASE}/organizations`, { waitUntil: 'networkidle' });
  orgHref = await principal.locator('main a[href^="/organizations/"]').first().getAttribute('href');
  await principal.goto(`${BASE}${orgHref}`, { waitUntil: 'networkidle' });
  await expectText(principal, 'Grade levels and attendance deadline', current);
  await expectText(principal, 'School years and terms', current);
});
await step('principal adds a school year, a term and a grading period', async () => {
  const years = principal.locator('section', { hasText: 'School years and terms' }).first();
  await years.getByLabel('New school year').fill(`2031-2032 ${stamp % 100}`);
  await years.getByLabel('Starts').last().fill('2031-08-15');
  await years.getByLabel('Ends').last().fill('2032-06-05');
  await principal.getByRole('button', { name: 'Add year' }).click();
  await expectText(principal, 'School year added.', current);
  const yearRow = principal.locator('div', { hasText: `2031-2032 ${stamp % 100}` }).filter({ has: principal.getByRole('button', { name: 'Add term' }) }).last();
  await yearRow.getByRole('button', { name: 'Add term' }).click();
  await principal.getByLabel('Term name').fill('Fall');
  await principal.getByRole('button', { name: 'Add', exact: true }).click();
  await expectText(principal, 'Term added.', current);
});
await step('principal adds a bell schedule period and an attendance code', async () => {
  const bells = principal.locator('section', { hasText: 'Bell schedules and periods' }).first();
  await bells.getByLabel('New bell schedule').fill(`Assembly day ${stamp % 100}`);
  await principal.getByRole('button', { name: 'Add schedule' }).click();
  await expectText(principal, 'Bell schedule added.', current);
  const sched = principal.locator('div', { hasText: `Assembly day ${stamp % 100}` }).filter({ has: principal.getByRole('button', { name: 'Add period' }) }).last();
  await sched.getByRole('button', { name: 'Add period' }).click();
  await bells.getByLabel('Period', { exact: true }).fill('1');
  await bells.getByLabel('Starts').fill('08:00');
  await bells.getByLabel('Ends').fill('08:40');
  await bells.getByRole('button', { name: 'Add', exact: true }).click();
  await expectText(principal, 'Period added.', current);
  await principal.getByLabel('Code', { exact: true }).fill(`Z${stamp % 10}`);
  await principal.getByLabel('Meaning').fill('Testing day');
  await principal.getByRole('button', { name: 'Add code' }).click();
  await expectText(principal, 'Code added.', current);
});
await step('principal saves the grading scale', async () => {
  await principal.getByRole('button', { name: 'Save scale' }).click();
  await expectText(principal, 'Grading scale saved.', current);
});
await step('principal removes the test year and bell schedule', async () => {
  const yearRow = principal.locator('div', { hasText: `2031-2032 ${stamp % 100}` }).filter({ has: principal.getByRole('button', { name: 'Remove' }) }).last();
  await yearRow.getByRole('button', { name: 'Remove' }).first().click();
  await expectText(principal, 'Year removed.', current);
  const sched = principal.locator('div', { hasText: `Assembly day ${stamp % 100}` }).filter({ has: principal.getByRole('button', { name: 'Remove' }) }).last();
  await sched.getByRole('button', { name: 'Remove' }).first().click();
  await expectText(principal, 'Bell schedule removed.', current);
});

// ----------------------------------------------------------------------------- teacher: class grading, assignment, attendance, calendar
const teacher = await login('teacher');
let classHref = '';
await step('teacher opens English 7 and sees how it is graded', async () => {
  await teacher.goto(`${BASE}/classes`, { waitUntil: 'networkidle' });
  classHref = await teacher.locator('main a[href^="/classes/"]', { hasText: 'English 7' }).first().getAttribute('href');
  await teacher.goto(`${BASE}${classHref}`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'How this class is graded', current);
  await expectText(teacher, 'Weighted categories', current);
});
await step('teacher adds and removes a category', async () => {
  await teacher.getByLabel('Category', { exact: true }).fill(`Labs ${stamp % 100}`);
  await teacher.getByLabel('Weight %').fill('10');
  await teacher.getByRole('button', { name: 'Add category' }).click();
  await expectText(teacher, 'Category added.', current);
  await expectText(teacher, 'add up to 110', current);
  const row = teacher.locator('li', { hasText: `Labs ${stamp % 100}` }).first();
  await row.getByRole('button', { name: 'Remove' }).click();
  await expectText(teacher, 'removed; its assignments now count by points', current);
});
let assignmentHref = '';
await step('teacher creates an assignment with a category and a standard, then publishes it', async () => {
  await teacher.goto(`${BASE}${classHref}/assignments`, { waitUntil: 'networkidle' });
  await teacher.getByLabel('Title').fill(`Flow quiz ${stamp}`);
  await teacher.getByLabel('Category', { exact: true }).selectOption({ label: 'Quizzes (30%)' });
  await teacher.getByLabel('Max points').fill('20');
  await teacher.getByLabel('Find a standard').fill('story');
  await teacher.locator('ul[aria-label="Matching standards"] button').first().click();
  await teacher.locator('ul[aria-label="Chosen standards"] li').first().waitFor({ timeout: 5000 });
  await teacher.getByRole('button', { name: 'Create draft' }).click();
  await teacher.waitForURL(/\/assignments\//, { timeout: 15000 });
  assignmentHref = new URL(teacher.url()).pathname;
  await expectText(teacher, `Flow quiz ${stamp}`, current);
  await expectText(teacher, 'Quizzes', current);
  await teacher.getByRole('button', { name: 'Publish' }).click();
  await expectText(teacher, 'Published.', current);
});
await step('teacher marks Emma missing, then clears it', async () => {
  const sel = teacher.getByLabel(/Mark for Emma/);
  await sel.waitFor({ timeout: 10000 });
  await sel.selectOption('missing');
  await teacher.locator('li span', { hasText: /^Missing$/ }).first().waitFor({ timeout: 10000 });
  await sel.selectOption('');
  await teacher.waitForTimeout(800);
});
await step('teacher sees the gradebook grouped by category', async () => {
  await teacher.goto(`${BASE}${classHref}/gradebook`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'HOMEWORK', current);
  await expectText(teacher, `Flow quiz ${stamp}`, current);
  await expectText(teacher, 'Missing', current);
});
await step('teacher takes period attendance with codes', async () => {
  await teacher.goto(`${BASE}${classHref}/attendance`, { waitUntil: 'networkidle' });
  await teacher.getByLabel('Date').fill('2026-11-18');
  await teacher.waitForTimeout(800);
  await teacher.getByLabel('Period').selectOption({ index: 2 });
  const pills = teacher.locator('[role=radiogroup]').first();
  await pills.getByRole('radio', { name: 'Tardy' }).click();
  await teacher.getByRole('button', { name: /^Save 2026-11-18/ }).click();
  await expectText(teacher, 'Saved', current);
});
await step('teacher adds a class event to the calendar and removes it', async () => {
  await teacher.goto(`${BASE}/calendar`, { waitUntil: 'networkidle' });
  await teacher.getByRole('button', { name: 'Add event' }).click();
  await teacher.getByLabel('Title').fill(`Flow field trip ${stamp}`);
  await teacher.getByLabel('Class', { exact: true }).selectOption({ index: 1 });
  const today = new Date();
  const iso = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  await teacher.getByLabel('Date').fill(iso);
  await teacher.getByRole('button', { name: 'Add to calendar' }).click();
  await expectText(teacher, 'Event added.', current);
  await expectText(teacher, `Flow field trip ${stamp}`, current);
  const item = teacher.locator('li', { hasText: `Flow field trip ${stamp}` }).first();
  await item.getByRole('button', { name: 'Remove' }).click();
  await expectText(teacher, 'Event removed.', current);
  await teacher.getByRole('button', { name: 'Show my subscription link' }).click();
  await expectText(teacher, '/api/v1/calendar/ical/', current);
});

// ----------------------------------------------------------------------------- student submits, teacher grades
const student = await login('student');
await step('student sees the assignment with its mark and submits', async () => {
  await student.goto(`${BASE}${assignmentHref}`, { waitUntil: 'networkidle' });
  await expectText(student, `Flow quiz ${stamp}`, current);
  await expectText(student, 'Assigned', current);
  await student.locator('textarea').first().fill('My answer for the flow quiz.');
  await student.getByRole('button', { name: /Submit/ }).first().click();
  await expectText(student, 'Turned in', current);
});
await step('teacher grades the submission', async () => {
  await teacher.goto(`${BASE}${assignmentHref}`, { waitUntil: 'networkidle' });
  await teacher.getByRole('button', { name: 'View and grade' }).first().click();
  await teacher.getByLabel(/Score \(out of 20\)/).fill('17');
  await teacher.getByRole('button', { name: 'Post grade' }).click();
  await expectText(teacher, 'Returned', current);
});
await step('student sees the grade', async () => {
  await student.goto(`${BASE}${assignmentHref}`, { waitUntil: 'networkidle' });
  await expectText(student, '17 / 20', current);
  await expectText(student, 'Returned', current);
});

// ----------------------------------------------------------------------------- report cards
let cardHref = '';
await step('principal generates report cards for Q1', async () => {
  await principal.goto(`${BASE}/report-cards`, { waitUntil: 'networkidle' });
  await principal.getByLabel('Grading period').selectOption({ index: 1 });
  await principal.getByRole('button', { name: 'Generate drafts' }).click();
  await expectText(principal, 'Drafts generated', current);
  cardHref = await principal.locator('main a[href^="/report-cards/"]', { hasText: 'Johnson, Emma' }).first().getAttribute('href');
});
await step('teacher comments on Emma\'s report card', async () => {
  await teacher.goto(`${BASE}${cardHref}`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'English 7 - Section A', current);
  await teacher.locator('textarea').first().fill(`Emma reads with real voice. ${stamp}`);
  await teacher.getByRole('button', { name: 'Save comment' }).first().click();
  await expectText(teacher, 'Comment saved.', current);
});
await step('principal publishes all drafts', async () => {
  await principal.goto(`${BASE}/report-cards`, { waitUntil: 'networkidle' });
  await principal.getByLabel('Grading period').selectOption({ index: 1 });
  await principal.waitForTimeout(800);
  await principal.getByRole('button', { name: /Publish all drafts/ }).click();
  await expectText(principal, 'Published.', current);
});
await step('student and parent read the published report card with the comment', async () => {
  await student.goto(`${BASE}/report-cards`, { waitUntil: 'networkidle' });
  await expectText(student, 'Report card · Q1', current);
  await student.goto(`${BASE}${cardHref}`, { waitUntil: 'networkidle' });
  await expectText(student, `Emma reads with real voice. ${stamp}`, current);
  const parent = await login('parent');
  await parent.goto(`${BASE}${cardHref}`, { waitUntil: 'networkidle' });
  await expectText(parent, `Emma reads with real voice. ${stamp}`, current);
  await expectText(parent, 'Download PDF', current);
});
await step('principal sees attendance today and the standards page', async () => {
  await principal.goto(`${BASE}/attendance/today`, { waitUntil: 'networkidle' });
  await expectText(principal, 'Not yet taken', current);
  await principal.goto(`${BASE}/standards`, { waitUntil: 'networkidle' });
  await expectText(principal, 'Common Core State Standards: Mathematics', current);
  await principal.getByLabel('Search').fill('linear');
  await expectText(principal, 'CCSS.MATH.CONTENT.7.EE.A.1', current);
});

await browser.close();
writeFileSync(`${OUT}/flows.json`, JSON.stringify(findings, null, 2));
for (const f of findings) console.log(`${f.step} | ${f.text}`);
console.log(findings.length === 0 ? 'FLOWS CLEAN' : `${findings.length} flow findings`);
