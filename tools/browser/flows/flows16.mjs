// Slice 16 user flows through the real UI: a teacher publishes a flashcard set; a student imports it, reviews cards,
// finishes a lesson and sees mastery and the learning curve; the family sees the mastery card; the teacher sees the class page.
import { launch, BASE, outDir } from '../lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const API = 'http://localhost:5000/api/v1';
const stamp = Date.now();
const findings = [];
const note = (step, text) => findings.push({ step, text });
let current = 'start';
const pages = {};
const OUT = outDir(process.argv[2] ?? 'out16');
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
async function token(role) {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: `${role}@smartschool.local`, password: 'SmartSchool!Demo2026' }) });
  return (await r.json()).accessToken;
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

// A flashcard set through the API as the teacher (the content editor UI is covered by the slice 8 flows).
const teacherToken = await token('teacher');
const created = await fetch(`${API}/h5p/contents`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${teacherToken}` },
  body: JSON.stringify({
    title: `Story vocabulary ${stamp}`,
    library: 'H5P.Dialogcards 1.9',
    parameters: { dialogs: [
      { text: 'Protagonist', answer: 'The main character of a story', tips: { front: 'Who the story follows' } },
      { text: 'Climax', answer: 'The turning point where the tension is highest' },
      { text: 'Resolution', answer: 'How the story ends and the conflict is settled' },
    ] },
  }),
});
const contentId = (await created.json()).id;
await fetch(`${API}/h5p/contents/${contentId}/publish`, { method: 'POST', headers: { authorization: `Bearer ${teacherToken}` } });

const student = await login('student');
await step('student sees the Learning card on the dashboard and opens Practice from the nav', 'student', async () => {
  await expectText(student, 'Learning', current);
  await student.locator('header a[href="/practice"], nav a[href="/practice"]').first().click();
  await student.waitForURL(/\/practice/);
  await expectText(student, 'A few minutes a day', current);
});
await step('student imports the flashcard set as practice cards', 'student', async () => {
  await student.getByRole('radio', { name: 'My cards' }).or(student.getByRole('button', { name: 'My cards' })).first().click();
  await expectText(student, 'Add from a flashcard set', current);
  await student.getByLabel('Flashcard set', { exact: true }).selectOption({ label: `Story vocabulary ${stamp}` });
  await student.getByRole('button', { name: 'Add cards' }).click();
  await expectText(student, '3 cards added', current);
  await expectText(student, 'Protagonist', current);
  await student.screenshot({ path: `${OUT}/student-cards.png`, fullPage: true });
});
await step('student reviews cards one at a time and sees the next review', 'student', async () => {
  await student.getByRole('radio', { name: 'Review' }).or(student.getByRole('button', { name: 'Review' })).first().click();
  await expectText(student, 'Card 1 of', current);
  await student.getByRole('button', { name: 'Show answer' }).click();
  await expectText(student, 'How well did you know it?', current);
  await student.getByRole('button', { name: 'Good', exact: true }).click();
  await expectText(student, 'Next review in 1 day', current);
  await student.getByRole('button', { name: 'Show answer' }).click();
  await student.getByRole('button', { name: 'Wrong', exact: true }).click();
  await expectText(student, 'Card 3 of', current);
  await student.screenshot({ path: `${OUT}/student-review.png`, fullPage: true });
});
await step('student finishes a lesson and sees a module ring and mastery on the course page', 'student', async () => {
  await student.goto(`${BASE}/courses`, { waitUntil: 'networkidle' });
  const href = await student.locator('main a[href^="/courses/"]', { hasText: 'Algebra' }).first().getAttribute('href');
  await student.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
  const done = student.getByRole('button', { name: /Mark lesson finished|Marcar/ }).first();
  if (await done.count()) {
    await done.click();
    await student.waitForTimeout(1500);
  }
  await expectText(student, 'Mastery in this course', current, 15000);
  await student.screenshot({ path: `${OUT}/student-course.png`, fullPage: true });
});
await step('student sees mastery by skill and the learning curve on the progress tab', 'student', async () => {
  await student.goto(`${BASE}/practice`, { waitUntil: 'networkidle' });
  await student.getByRole('radio', { name: 'Progress' }).or(student.getByRole('button', { name: 'Progress' })).first().click();
  await expectText(student, 'Learning curve', current);
  await expectText(student, 'Mastery by skill', current);
  await expectText(student, 'You remembered 50%', current);
  await student.screenshot({ path: `${OUT}/student-progress.png`, fullPage: true });
});
await step('student reads the practice screen in Spanish', 'student', async () => {
  await student.getByRole('combobox', { name: 'Language' }).first().selectOption('es');
  await student.waitForTimeout(800);
  await expectText(student, 'Unos minutos al día', current);
  await student.screenshot({ path: `${OUT}/student-practice-es.png`, fullPage: true });
  await student.getByRole('combobox', { name: 'Idioma' }).first().selectOption('en');
  await student.waitForTimeout(800);
});

const parent = await login('parent');
await step('parent sees the mastery card on the family home', 'parent', async () => {
  await parent.goto(`${BASE}/family`, { waitUntil: 'networkidle' });
  await expectText(parent, 'Mastery by skill', current);
  await expectText(parent, 'Learning curve', current);
  await parent.screenshot({ path: `${OUT}/parent-family.png`, fullPage: true });
});
await step('parent cannot open the practice screen', 'parent', async () => {
  await parent.goto(`${BASE}/practice`, { waitUntil: 'networkidle' });
  await expectText(parent, 'Not available for your account', current);
});

const teacher = await login('teacher');
await step('teacher opens the class learning page', 'teacher', async () => {
  await teacher.goto(`${BASE}/classes`, { waitUntil: 'networkidle' });
  const href = await teacher.locator('main a[href^="/classes/"]', { hasText: 'Algebra I - Section A' }).first().getAttribute('href');
  await teacher.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
  await teacher.getByRole('link', { name: 'Learning', exact: true }).click();
  await teacher.waitForURL(/\/learning/);
  await expectText(teacher, 'Class learning', current);
  await expectText(teacher, 'Standards', current);
  await expectText(teacher, 'Needs help', current);
  await teacher.screenshot({ path: `${OUT}/teacher-class-learning.png`, fullPage: true });
});

await browser.close();
// Tidy the flashcard set so repeated runs do not pile up.
await fetch(`${API}/h5p/contents/${contentId}`, { method: 'DELETE', headers: { authorization: `Bearer ${teacherToken}` } }).catch(() => undefined);
writeFileSync(`${OUT}/flows16.json`, JSON.stringify(findings, null, 2));
for (const f of findings) console.log(`${f.step} | ${f.text}`);
console.log(findings.length === 0 ? 'FLOWS16 CLEAN' : `${findings.length} flow findings`);
