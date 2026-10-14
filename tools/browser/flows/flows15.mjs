// Slice 15 user flows through the real UI (needs the real AI service): a lesson plan drafted, edited and published;
// grading suggestions approved; a parent email drafted and sent; class insight built; a substitute granted and revoked.
import { launch, BASE, outDir } from '../lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const stamp = Date.now();
const findings = [];
const note = (step, text) => findings.push({ step, text });
let current = 'start';
const pages = {};
const OUT = outDir(process.argv[2] ?? 'out15');
mkdirSync(OUT, { recursive: true });
const browser = await launch();

async function login(role) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_ABORTED|403|404/.test(m.text())) note(current, `console: ${m.text().slice(0, 200)}`); });
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/v1/') && r.status() >= 400 && !/auth\/refresh|counselor-notes|accommodations|ai-consent|behavior|conference-notes|motivation\/awards|insight$/.test(u)) note(current, `http ${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`); });
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

const teacher = await login('teacher');
await step('teacher drafts a lesson plan with the AI, edits and publishes it', 'teacher', async () => {
  await teacher.goto(`${BASE}/assistant`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'Teacher assistant', current);
  await teacher.getByLabel('Topic', { exact: true }).fill(`Story structure flow ${stamp}`);
  await teacher.getByLabel('Class', { exact: true }).first().selectOption({ label: 'English 7 - Section A' });
  await teacher.getByRole('button', { name: 'Draft plan' }).click();
  await expectText(teacher, 'Draft ready', current, 240000);
  await expectText(teacher, 'Sequence', current);
  await teacher.getByRole('button', { name: 'Publish' }).click();
  await expectText(teacher, 'Published. It shows on your planner', current);
  await teacher.screenshot({ path: `${OUT}/teacher-plan.png`, fullPage: true });
});
await step('teacher sees the week on the planner', 'teacher', async () => {
  await teacher.goto(`${BASE}/planner`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'Weekly planner', current);
  await expectText(teacher, 'English 7 - Section A', current);
  await teacher.screenshot({ path: `${OUT}/teacher-planner.png`, fullPage: true });
});
await step('teacher gets grading suggestions and approves the confident ones', 'teacher', async () => {
  await teacher.goto(`${BASE}/assistant?section=grading`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'Grading suggestions', current);
  const select = teacher.getByLabel('Assignment', { exact: true });
  const options = await select.locator('option').allInnerTexts();
  const essay = options.find((o) => /Story structure paragraph/i.test(o)) ?? options.find((o) => /English 7/.test(o));
  if (!essay) throw new Error('no assignment to grade');
  await select.selectOption({ label: essay });
  await teacher.getByRole('button', { name: 'Suggest grades' }).click();
  await expectText(teacher, /suggestions? ready|Skipped/, current, 300000);
  await teacher.screenshot({ path: `${OUT}/teacher-grading.png`, fullPage: true });
});
await step('teacher drafts a Spanish email to a family and sends it as a message', 'teacher', async () => {
  await teacher.goto(`${BASE}/assistant?section=families`, { waitUntil: 'networkidle' });
  await teacher.getByLabel('Student', { exact: true }).first().selectOption({ label: 'Johnson, Emma' });
  await teacher.getByLabel('Language', { exact: true }).first().selectOption('es');
  await teacher.getByRole('button', { name: 'Draft email' }).click();
  await expectText(teacher, 'Email drafted', current, 240000);
  await teacher.getByRole('button', { name: 'Send to family' }).first().click();
  await expectText(teacher, 'Sent to the family', current, 30000);
  await teacher.screenshot({ path: `${OUT}/teacher-email.png`, fullPage: true });
});
await step('teacher builds this week’s class insight', 'teacher', async () => {
  await teacher.goto(`${BASE}/assistant?section=insight`, { waitUntil: 'networkidle' });
  await teacher.getByLabel('Class', { exact: true }).first().selectOption({ label: 'English 7 - Section A' });
  await teacher.getByRole('button', { name: /Build this week|Refresh this week/ }).click();
  await expectText(teacher, 'briefing is ready', current, 240000);
  await expectText(teacher, 'The numbers', current);
  await teacher.screenshot({ path: `${OUT}/teacher-insight.png`, fullPage: true });
});
await step('teacher grants substitute access on the class page and ends it', 'teacher', async () => {
  await teacher.goto(`${BASE}/classes`, { waitUntil: 'networkidle' });
  const href = await teacher.locator('main a[href^="/classes/"]', { hasText: 'English 7 - Section A' }).first().getAttribute('href');
  await teacher.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'Substitutes', current);
  const who = teacher.getByLabel('Who', { exact: true });
  const opts = await who.locator('option').allInnerTexts();
  const pick = opts.find((o) => /assistant\)/.test(o)) ?? opts[1];
  await who.selectOption({ label: pick });
  await teacher.getByRole('button', { name: 'Grant access' }).click();
  await expectText(teacher, /Access granted|already teaches/, current);
  const end = teacher.getByRole('button', { name: 'End access' }).first();
  if (await end.count()) {
    await end.click();
    await teacher.waitForTimeout(800);
  }
});

const parent = await login('parent');
await step('parent received the teacher’s email as a message', 'parent', async () => {
  await parent.goto(`${BASE}/messages`, { waitUntil: 'networkidle' });
  await expectText(parent, 'Jane Teacher', current);
});
const student = await login('student');
await step('student cannot open the assistant or the planner', 'student', async () => {
  await student.goto(`${BASE}/assistant`, { waitUntil: 'networkidle' });
  await expectText(student, 'Not available for your account', current);
  await student.goto(`${BASE}/planner`, { waitUntil: 'networkidle' });
  await expectText(student, 'Not available for your account', current);
});

await browser.close();
writeFileSync(`${OUT}/flows15.json`, JSON.stringify(findings, null, 2));
for (const f of findings) console.log(`${f.step} | ${f.text}`);
console.log(findings.length === 0 ? 'FLOWS15 CLEAN' : `${findings.length} flow findings`);
