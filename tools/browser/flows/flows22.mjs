// Slice 22 user flows through the real UI: a teacher adds a link to the library and publishes it, a student
// finds it by meaning, rates it and follows a collection, the teacher widens it to the district and the
// principal approves it from the review queue.
import { launch, BASE, outDir } from '../lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const stamp = Date.now();
const findings = [];
const note = (step, text) => findings.push({ step, text });
let current = 'start';
const pages = {};
const OUT = outDir(process.argv[2] ?? 'out22');
mkdirSync(OUT, { recursive: true });
const browser = await launch();

async function login(role) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_ABORTED|403|404/.test(m.text())) note(current, `console: ${m.text().slice(0, 200)}`); });
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/v1/') && r.status() >= 400 && !/auth\/refresh|assistant\/lesson-plans/.test(u)) note(current, `http ${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`); });
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

const title = `Flow fractions video ${stamp}`;
const teacher = await login('teacher');
await step('teacher adds a link to the library and publishes it to the school', 'teacher', async () => {
  await teacher.goto(`${BASE}/library?tab=mine`, { waitUntil: 'networkidle' });
  await teacher.getByRole('radio', { name: 'Link' }).click();
  await teacher.fill('#lib-title', title);
  await teacher.fill('#lib-description', 'A short video on equivalent fractions');
  await teacher.fill('#lib-form-subject', 'Math');
  await teacher.fill('#lib-form-grade', '5');
  await teacher.fill('#lib-url', 'https://www.khanacademy.org/math/fractions');
  await teacher.getByRole('button', { name: 'Add item' }).click();
  await expectText(teacher, `Added ${title}`, current);
  await teacher.getByRole('link', { name: title }).first().click();
  await teacher.waitForURL(/\/library\/[0-9a-f-]+$/, { timeout: 15000 });
  await teacher.getByRole('button', { name: 'Publish' }).click();
  await expectText(teacher, 'Published or sent for review', current);
  await expectText(teacher, 'Published', current);
  await teacher.screenshot({ path: `${OUT}/item-teacher.png`, fullPage: true });
});
let itemUrl = teacher.url();

const student = await login('student');
await step('student finds the item by meaning, rates it and follows a collection', 'student', async () => {
  await student.goto(`${BASE}/library`, { waitUntil: 'networkidle' });
  await student.fill('#lib-q', 'equivalent fractions video');
  await expectText(student, title, current);
  await student.getByRole('link', { name: title }).first().click();
  await student.waitForURL(/\/library\/[0-9a-f-]+$/, { timeout: 15000 });
  await student.getByRole('button', { name: 'Rate' }).click();
  await expectText(student, 'Thanks for rating', current);
  await expectText(student, '5 of 5', current);
  await student.screenshot({ path: `${OUT}/item-student.png`, fullPage: true });
});

await step('teacher creates a collection, adds the item, and the student follows it', 'teacher', async () => {
  await teacher.goto(`${BASE}/library?tab=collections`, { waitUntil: 'networkidle' });
  await teacher.fill('#col-title', `Flow unit ${stamp}`);
  await teacher.getByRole('button', { name: 'Create' }).click();
  await expectText(teacher, `Flow unit ${stamp}`, current);
  await teacher.goto(itemUrl, { waitUntil: 'networkidle' });
  await teacher.selectOption('#item-collection', { label: `Flow unit ${stamp}` });
  await teacher.getByRole('button', { name: 'Add', exact: true }).click();
  await expectText(teacher, 'Added to the collection', current);
  await student.goto(`${BASE}/library?tab=collections`, { waitUntil: 'networkidle' });
  const card = student.locator('li', { hasText: `Flow unit ${stamp}` }).first();
  await card.getByRole('button', { name: 'Follow' }).click();
  await expectText(card, 'Unfollow', current);
  await card.getByRole('link', { name: `Flow unit ${stamp}` }).click();
  await student.waitForURL(/\/library\/collections\//, { timeout: 15000 });
  await expectText(student, title, current);
});

await step('teacher widens the item to the district and the principal approves it', 'teacher', async () => {
  await teacher.goto(itemUrl, { waitUntil: 'networkidle' });
  await teacher.selectOption('#edit-visibility', 'district');
  await teacher.getByRole('button', { name: 'Save' }).click();
  await expectText(teacher, 'Waiting for review', current);
  const principal = await login('principal');
  await principal.goto(`${BASE}/library?tab=moderation`, { waitUntil: 'networkidle' });
  await expectText(principal, title, current);
  const row = principal.locator('li', { hasText: title }).first();
  await row.getByRole('button', { name: 'Approve' }).click();
  await expectText(principal, 'Nothing waiting', current);
  await principal.screenshot({ path: `${OUT}/moderation.png`, fullPage: true });
});

await step('student cannot open the review tab', 'student', async () => {
  await student.goto(`${BASE}/library?tab=moderation`, { waitUntil: 'networkidle' });
  const tabs = await student.getByRole('radio').allTextContents();
  if (tabs.some((t) => /Review/.test(t))) note(current, 'student saw the Review tab');
});

await browser.close();
writeFileSync(`${OUT}/flows22.json`, JSON.stringify(findings, null, 2));
for (const f of findings) console.log(`${f.step} | ${f.text}`);
console.log(findings.length === 0 ? 'FLOWS22 CLEAN' : `${findings.length} flow findings`);
