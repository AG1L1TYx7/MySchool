// Slice 13 user flows through the real UI: Spanish interface, the family home and digest preview,
// a family-language lesson summary drafted, released and read by a parent, and conference talking points.
import { launch, BASE, outDir } from '../lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const findings = [];
const note = (step, text) => findings.push({ step, text });
let current = 'start';
const pages = {};
const OUT = outDir(process.argv[2] ?? 'out13');
mkdirSync(OUT, { recursive: true });
const browser = await launch();

async function login(role) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_ABORTED/.test(m.text())) note(current, `console: ${m.text().slice(0, 200)}`); });
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
async function openLesson(page, step) {
  await page.goto(`${BASE}/courses`, { waitUntil: 'networkidle' });
  const href = await page.locator('main a[href^="/courses/"]', { hasText: 'English Language Arts 7' }).first().getAttribute('href');
  await page.goto(`${BASE}${href}`, { waitUntil: 'networkidle' });
  await page.locator('main button', { hasText: '1.1' }).first().click();
  await expectText(page, 'Family summary', step);
}

const parent = await login('parent');
await step('parent switches the whole interface to Spanish', 'parent', async () => {
  await parent.locator('header select').first().selectOption('es');
  await expectText(parent, 'Mi familia', current);
  await expectText(parent, 'Cerrar sesión', current);
  const lang = await parent.evaluate(() => document.documentElement.lang);
  if (lang !== 'es') note(current, `html lang is ${lang}`);
  await parent.screenshot({ path: `${OUT}/parent-spanish-dashboard.png`, fullPage: true });
});
await step('parent reads the family home and previews the digest in Spanish', 'parent', async () => {
  await parent.goto(`${BASE}/family`, { waitUntil: 'networkidle' });
  await expectText(parent, 'Emma Johnson', current);
  await expectText(parent, 'Clases', current);
  await expectText(parent, 'Trabajos pendientes', current);
  await parent.getByRole('button', { name: 'Ver el correo de esta semana' }).click();
  await expectText(parent, 'Esta semana en la escuela', current);
  await expectText(parent, 'Hola', current);
  await parent.screenshot({ path: `${OUT}/parent-family-es.png`, fullPage: true });
});
await step('parent switches back to English and the choice sticks after a reload', 'parent', async () => {
  await parent.locator('header select').first().selectOption('en');
  await expectText(parent, 'My family', current);
  await parent.reload({ waitUntil: 'networkidle' });
  await expectText(parent, 'My family', current);
  await expectText(parent, 'Missing work', current);
});

const teacher = await login('teacher');
await step('teacher drafts a Spanish family summary with the AI and releases it', 'teacher', async () => {
  await openLesson(teacher, current);
  // Clean any summary left by a previous run so the draft button is live.
  while (await teacher.getByRole('button', { name: 'Delete' }).filter({ has: teacher.locator(':scope') }).count() > 1) {
    const del = teacher.locator('section[aria-label="Family summary"] button', { hasText: 'Delete' }).first();
    if (!(await del.count())) break;
    await del.click();
    await teacher.waitForTimeout(800);
  }
  await teacher.getByRole('button', { name: 'Draft in Spanish' }).click();
  await expectText(teacher, 'Draft, not yet visible to families', current, 180000);
  await expectText(teacher, 'AI-generated draft', current);
  await teacher.screenshot({ path: `${OUT}/teacher-summary-draft.png`, fullPage: true });
  await teacher.getByRole('button', { name: 'Release to families' }).click();
  await expectText(teacher, 'Released. Families can read it now.', current);
});
await step('parent reads the released summary on the lesson, labelled AI-generated and reviewed', 'parent', async () => {
  await openLesson(parent, current);
  await expectText(parent, 'In Spanish', current);
  await expectText(parent, 'AI-generated', current);
  await expectText(parent, 'Reviewed by', current);
  const drafts = await parent.getByText('Draft, not yet visible').count();
  if (drafts) note(current, 'parent can see a draft summary');
  await parent.screenshot({ path: `${OUT}/parent-summary.png`, fullPage: true });
});
await step('teacher drafts conference talking points for Emma', 'teacher', async () => {
  await teacher.goto(`${BASE}/students`, { waitUntil: 'networkidle' });
  const emma = await teacher.locator('main a[href^="/students/"]', { hasText: 'Johnson' }).first().getAttribute('href');
  await teacher.goto(`${BASE}${emma}`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'Conference talking points', current);
  await teacher.getByRole('button', { name: 'Draft talking points' }).click();
  await expectText(teacher, 'Strengths', current, 180000);
  await expectText(teacher, 'Next steps', current);
  await teacher.screenshot({ path: `${OUT}/teacher-conference.png`, fullPage: true });
});
await step('teacher removes the released summary so the demo data stays clean', 'teacher', async () => {
  await openLesson(teacher, current);
  await teacher.locator('section[aria-label="Family summary"] button', { hasText: 'Delete' }).first().click();
  await expectText(teacher, 'Summary removed.', current);
});

const student = await login('student');
await step('student sees the family home for themselves', 'student', async () => {
  await student.goto(`${BASE}/family`, { waitUntil: 'networkidle' });
  await expectText(student, 'Emma Johnson', current);
  const digest = await student.getByText('Weekly summary email').count();
  if (!digest) note(current, 'digest card missing for the student');
});

const counselor = await login('counselor');
await step('counselor sees the talking points; the parent never does', 'counselor', async () => {
  await counselor.goto(`${BASE}/students`, { waitUntil: 'networkidle' });
  const emma = await counselor.locator('main a[href^="/students/"]', { hasText: 'Johnson' }).first().getAttribute('href');
  await counselor.goto(`${BASE}${emma}`, { waitUntil: 'networkidle' });
  await expectText(counselor, 'Conference talking points', current);
  await expectText(counselor, 'AI-generated', current);
  await parent.goto(`${BASE}/grades`, { waitUntil: 'networkidle' });
  if (await parent.getByText('Conference talking points').count()) note(current, 'parent can see conference talking points');
});

await browser.close();
writeFileSync(`${OUT}/flows13.json`, JSON.stringify(findings, null, 2));
for (const f of findings) console.log(`${f.step} | ${f.text}`);
console.log(findings.length === 0 ? 'FLOWS13 CLEAN' : `${findings.length} flow findings`);
