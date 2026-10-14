// Slice 24 user flows through the real UI: a student builds a portfolio project and publishes it, takes the
// interest inventory, runs a code lesson; a teacher endorses a skill and leaves feedback; the public page shows
// the published project without signing in; a parent cannot open the student-only pages.
import { launch, BASE, outDir } from '../lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const stamp = Date.now();
const findings = [];
const note = (step, text) => findings.push({ step, text });
let current = 'start';
const pages = {};
const OUT = outDir(process.argv[2] ?? 'out24');
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

const title = `Flow bridge ${stamp}`;
const student = await login('student');
let publicPath = '';
await step('student adds a project, publishes it and opens the portfolio to the world', 'student', async () => {
  await student.goto(`${BASE}/portfolio`, { waitUntil: 'networkidle' });
  await student.fill('#pj-title', title);
  await student.fill('#pj-summary', 'A popsicle bridge that held 4 kg');
  await student.fill('#pj-skills', 'Problem solving, Teamwork');
  await student.getByRole('button', { name: 'Add project' }).click();
  await expectText(student, 'Added as a draft', current);
  const card = student.locator('section', { hasText: title }).first();
  await card.getByRole('button', { name: 'Publish' }).click();
  await expectText(card, 'published', current);
  await student.fill('#pf-headline', 'Curious builder');
  await student.selectOption('#pf-visibility', 'public');
  await student.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expectText(student, 'Your public page is at', current);
  const text = await student.getByText('Your public page is at').textContent();
  publicPath = (text?.match(/\/p\/[a-z0-9-]+/) ?? [''])[0];
  await student.screenshot({ path: `${OUT}/portfolio.png`, fullPage: true });
});
await step('student adds a skill and takes the interest inventory', 'student', async () => {
  await student.getByRole('radio', { name: 'Skills' }).click();
  await student.selectOption('#skill-pick', { label: 'Coding (technology)' });
  await student.getByRole('button', { name: 'Add or update' }).click();
  await student.locator('li', { hasText: 'Coding' }).first().waitFor({ timeout: 15000 });
  await student.getByRole('radio', { name: 'Career and college' }).click();
  await expectText(student, 'not me', current);
  const groups = student.locator('[role=radiogroup]:not([aria-label="portfolio-tab"])');
  const count = await groups.count();
  for (let i = 0; i < count; i += 1) await groups.nth(i).getByRole('radio', { name: i % 3 === 0 ? '5' : '2' }).click();
  await student.getByRole('button', { name: 'See my results' }).click();
  await expectText(student, 'Your code is', current);
  await expectText(student, 'Readiness checklist', current);
  await student.screenshot({ path: `${OUT}/career.png`, fullPage: true });
});
await step('student downloads the resume and runs a code lesson', 'student', async () => {
  await expectDownload(student, () => student.getByRole('button', { name: 'Download my resume' }).click(), current, /^resume-/);
  await student.goto(`${BASE}/code`, { waitUntil: 'networkidle' });
  await student.getByRole('button', { name: /Add two numbers/ }).click();
  await expectText(student, 'Your code', current);
  await student.fill('#code-source', 'function add(a, b) { return a + b; }');
  await student.getByRole('button', { name: 'Run the tests' }).click();
  await expectText(student, 'All tests pass', current);
  await student.screenshot({ path: `${OUT}/code.png`, fullPage: true });
});

const teacher = await login('teacher');
await step('teacher endorses the skill and leaves feedback from the student page', 'teacher', async () => {
  await teacher.goto(`${BASE}/students`, { waitUntil: 'networkidle' });
  await teacher.getByRole('link', { name: /Johnson/ }).first().click();
  await teacher.waitForURL(/\/students\/[0-9a-f-]+$/, { timeout: 15000 });
  await expectText(teacher, 'Portfolio', current);
  await teacher.getByRole('button', { name: 'Endorse' }).first().click();
  await expectText(teacher, '1 endorsement', current);
  const card = teacher.locator('section', { hasText: title }).first();
  await card.locator('input[id^=review-]').fill('Clear write-up and a strong build.');
  await card.getByRole('button', { name: 'Send' }).click();
  await expectText(card, 'strong build', current);
});

await step('the public page shows the published project without signing in', 'none', async () => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}${publicPath}`, { waitUntil: 'networkidle' });
  await expectText(page, 'Emma Johnson', current);
  await expectText(page, title, current);
  await expectText(page, 'Curious builder', current);
  await page.screenshot({ path: `${OUT}/public.png`, fullPage: true });
  await ctx.close();
});

await step('student makes the portfolio private again so the demo data stays clean', 'student', async () => {
  await student.goto(`${BASE}/portfolio`, { waitUntil: 'networkidle' });
  await student.selectOption('#pf-visibility', 'private');
  await student.getByRole('button', { name: 'Save', exact: true }).first().click();
  await expectText(student, 'Saved.', current);
});

const parent = await login('parent');
await step('parent cannot open the student-only portfolio page', 'parent', async () => {
  await parent.goto(`${BASE}/portfolio`, { waitUntil: 'networkidle' });
  await expectText(parent, 'Not available for your account', current);
});

await browser.close();
writeFileSync(`${OUT}/flows24.json`, JSON.stringify(findings, null, 2));
for (const f of findings) console.log(`${f.step} | ${f.text}`);
console.log(findings.length === 0 ? 'FLOWS24 CLEAN' : `${findings.length} flow findings`);
