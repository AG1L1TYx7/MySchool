// Slice 12 user flows through the real UI: support plan, consent, behaviour, counselor notes and caseload,
// support settings, and the student's screens with the plan applied.
import { launch, BASE, outDir } from '../lib.mjs';
import { writeFileSync } from 'node:fs';

const stamp = Date.now();
const findings = [];
const note = (step, text) => findings.push({ step, text });
let current = 'start';
const pages = {};
const browser = await launch();

async function login(role) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_ABORTED/.test(m.text())) note(current, `console: ${m.text().slice(0, 200)}`); });
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/v1/') && r.status() >= 400 && !/auth\/refresh|counselor-notes|accommodations|ai-consent|behavior/.test(u)) note(current, `http ${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`); });
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
let emmaHref = '';
await step('teacher opens Emma and records her support plan', 'teacher', async () => {
  await teacher.goto(`${BASE}/students`, { waitUntil: 'networkidle' });
  emmaHref = await teacher.locator('main a[href^="/students/"]', { hasText: 'Johnson' }).first().getAttribute('href');
  await teacher.goto(`${BASE}${emmaHref}`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'Support plan (IEP / 504)', current);
  await teacher.getByLabel('Extended time (%)').fill('50');
  await teacher.getByLabel('Larger text').check();
  await teacher.getByLabel('Read aloud').check();
  await teacher.getByLabel('Notes for teachers').fill(`Flow plan ${stamp}`);
  await teacher.getByRole('button', { name: /Save plan|Record plan/ }).click();
  await expectText(teacher, 'Accommodations saved', current);
  await expectText(teacher, 'Behaviour', current);
  await teacher.getByLabel('What happened').fill(`Flow kindness ${stamp}`);
  await teacher.getByRole('button', { name: 'Record', exact: true }).click();
  await expectText(teacher, 'Recorded.', current);
  await expectText(teacher, 'family can see', current);
  const hasNotes = await teacher.getByText('Counselor notes (private)').count();
  if (hasNotes) note(current, 'teacher can see the counselor notes card');
});

const counselor = await login('counselor');
await step('counselor sees the caseload, the wellness queue and private notes', 'counselor', async () => {
  await counselor.goto(`${BASE}/caseload`, { waitUntil: 'networkidle' });
  await expectText(counselor, 'Johnson, Emma', current);
  await counselor.goto(`${BASE}/wellness`, { waitUntil: 'networkidle' });
  await expectText(counselor, 'Wellness queue', current);
  await counselor.goto(`${BASE}${emmaHref}`, { waitUntil: 'networkidle' });
  await expectText(counselor, 'Counselor notes (private)', current);
  await counselor.getByLabel('New note').fill(`Flow note ${stamp}`);
  await counselor.getByRole('button', { name: 'Save note' }).click();
  await expectText(counselor, 'Only counselors can read it', current);
  const canAssign = await counselor.locator('nav a[href="/assignments"]').count();
  console.log('     counselor nav shows assignments:', canAssign > 0);
});

const parent = await login('parent');
await step('parent reads the plan and the positive note, and manages AI consent', 'parent', async () => {
  await parent.goto(`${BASE}/grades`, { waitUntil: 'networkidle' });
  await expectText(parent, 'Support plan (IEP / 504)', current);
  await expectText(parent, '50% more time', current);
  await expectText(parent, `Flow kindness ${stamp}`, current);
  await expectText(parent, 'AI tutor and content: consent', current);
  const notes = await parent.getByText('Counselor notes (private)').count();
  if (notes) note(current, 'parent can see counselor notes');
});

const student = await login('student');
await step('student gets larger text and read-aloud from the plan', 'student', async () => {
  await student.goto(`${BASE}/assignments`, { waitUntil: 'networkidle' });
  const large = await student.evaluate(() => document.documentElement.classList.contains('a11y-large-text'));
  if (!large) note(current, 'large text class not applied');
  const href = await student.locator('main a[href^="/assignments/"]', { hasText: 'Story structure' }).first().getAttribute('href');
  await student.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
  await student.waitForTimeout(800);
  const readAloud = await student.getByRole('button', { name: 'Read aloud' }).count();
  if (!readAloud) note(current, 'read aloud button missing');
  await student.screenshot({ path: `${OUT}/student-large-text.png` });
});

const principal = await login('principal');
await step('principal changes support settings on the organisation page', 'principal', async () => {
  await principal.goto(`${BASE}/organizations`, { waitUntil: 'networkidle' });
  const org = await principal.locator('main a[href^="/organizations/"]').first().getAttribute('href');
  await principal.goto(`${BASE}${org}`, { waitUntil: 'networkidle' });
  await expectText(principal, 'Support and safety', current);
  await principal.getByLabel('Behaviour records families can see').selectOption('ALL');
  await principal.getByRole('button', { name: 'Save support settings' }).click();
  await expectText(principal, 'Support settings saved.', current);
  await principal.getByLabel('Behaviour records families can see').selectOption('POSITIVE_ONLY');
  await principal.getByRole('button', { name: 'Save support settings' }).click();
  await expectText(principal, 'Support settings saved.', current);
  await principal.goto(`${BASE}/wellness`, { waitUntil: 'networkidle' });
  await expectText(principal, 'Wellness queue', current);
});

await browser.close();
writeFileSync(`${OUT}/flows12.json`, JSON.stringify(findings, null, 2));
for (const f of findings) console.log(`${f.step} | ${f.text}`);
console.log(findings.length === 0 ? 'FLOWS12 CLEAN' : `${findings.length} flow findings`);
