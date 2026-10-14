// Slice 25 user flows through the real UI: the teacher opens the class discussion and starts a topic and
// creates a club; the student replies, is held for a phone number, reacts and joins the club; the teacher
// approves from the moderation queue; the parent reads, cannot reply, and reports; the principal closes it.
import { launch, BASE, outDir } from '../lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const stamp = Date.now();
const findings = [];
const note = (step, text) => findings.push({ step, text });
let current = 'start';
const pages = {};
const OUT = outDir(process.argv[2] ?? 'out25');
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

const topicTitle = `Field trip ideas ${stamp}`;
const clubName = `Chess club ${stamp}`;
let topicUrl = '';

const student = await login('student');
let classPath = '';
let groupUrl = '';
await step('student opens the class discussion from the class page', 'student', async () => {
  await student.goto(`${BASE}/classes`, { waitUntil: 'networkidle' });
  await student.locator('main a[href^="/classes/"]:not([href$="/new"])').first().click();
  await student.waitForURL(/\/classes\/[0-9a-f-]+$/, { timeout: 15000 });
  classPath = new URL(student.url()).pathname;
  await student.getByRole('link', { name: 'Discussion' }).click();
  await student.waitForURL(/\/community\/groups\/[0-9a-f-]+/, { timeout: 20000 });
  groupUrl = new URL(student.url()).pathname;
  await expectText(student, 'discussion', current);
});

const teacher = await login('teacher');
await step('teacher opens the same class discussion from the class page and starts a topic', 'teacher', async () => {
  await teacher.goto(`${BASE}${classPath}`, { waitUntil: 'networkidle' });
  await teacher.getByRole('link', { name: 'Discussion' }).click();
  await teacher.waitForURL(/\/community\/groups\/[0-9a-f-]+/, { timeout: 20000 });
  if (new URL(teacher.url()).pathname !== groupUrl) note(current, `teacher landed on ${teacher.url()} not ${groupUrl}`);
  await teacher.fill('#topic-title', topicTitle);
  await teacher.fill('#topic-body', 'Where should we go this spring? Reply with one idea and why.');
  await teacher.getByRole('button', { name: 'Post topic' }).click();
  await expectText(teacher, 'Posted.', current);
  await teacher.getByRole('link', { name: topicTitle }).first().waitFor({ timeout: 10000 });
  topicUrl = await teacher.getByRole('link', { name: topicTitle }).first().getAttribute('href');
  await teacher.screenshot({ path: `${OUT}/class-discussion.png`, fullPage: true });
});

await step('teacher creates a club under Groups', 'teacher', async () => {
  await teacher.goto(`${BASE}/community?tab=groups`, { waitUntil: 'networkidle' });
  await teacher.getByRole('button', { name: 'New group' }).click();
  await teacher.fill('#g-name', clubName);
  await teacher.fill('#g-description', 'Wednesdays after school in room 12.');
  await teacher.getByRole('button', { name: 'Create group' }).click();
  await teacher.getByRole('link', { name: clubName }).first().waitFor({ timeout: 10000 });
  await teacher.screenshot({ path: `${OUT}/groups.png`, fullPage: true });
});

await step('student sees the topic under recent activity, replies, is held for a phone number, and reacts', 'student', async () => {
  await student.goto(`${BASE}/community`, { waitUntil: 'networkidle' });
  await student.getByRole('link', { name: topicTitle }).first().click();
  await student.waitForURL(/\/community\/topics\//, { timeout: 15000 });
  await student.fill('#reply-body', 'The science museum, because the planetarium show fits our unit.');
  await student.getByRole('button', { name: 'Post reply' }).click();
  await expectText(student, 'Reply posted.', current);
  await student.fill('#reply-body', 'Or call my mom at 555-123-4567, she knows a farm.');
  await student.getByRole('button', { name: 'Post reply' }).click();
  await expectText(student, 'waiting for a teacher', current);
  await expectText(student, 'Waiting for a teacher', current);
  await student.getByRole('button', { name: 'Helpful (0)' }).first().click();
  await student.getByRole('button', { name: 'Helpful (1)' }).first().waitFor({ timeout: 10000 });
  await student.screenshot({ path: `${OUT}/topic-student.png`, fullPage: true });
});
await step('student joins the club', 'student', async () => {
  await student.goto(`${BASE}/community?tab=groups`, { waitUntil: 'networkidle' });
  await student.getByRole('button', { name: `Join ${clubName}` }).click();
  await expectText(student, `You joined ${clubName}`, current);
});

await step('teacher approves the held reply from the moderation queue', 'teacher', async () => {
  await teacher.goto(`${BASE}/community?tab=moderation`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'Waiting for a look (1)', current);
  await expectText(teacher, 'reach someone outside school', current);
  await teacher.getByRole('button', { name: 'Approve' }).first().click();
  await expectText(teacher, 'Approved.', current);
  await expectText(teacher, 'Waiting for a look (0)', current);
  await teacher.screenshot({ path: `${OUT}/moderation.png`, fullPage: true });
});

const parent = await login('parent');
await step('parent reads the topic, cannot reply, and reports it', 'parent', async () => {
  await parent.goto(`${BASE}${topicUrl}`, { waitUntil: 'networkidle' });
  await expectText(parent, 'Family accounts read the community', current);
  if (await parent.locator('#reply-body').count()) note(current, 'parent saw a reply box');
  await parent.getByRole('button', { name: 'Report' }).first().click();
  await parent.selectOption(`select[id^="report-reason-"]`, 'other');
  await parent.getByRole('button', { name: 'Send report' }).click();
  await expectText(parent, 'The moderators have been told', current);
});

const principal = await login('principal');
await step('principal closes the report with a reminder', 'principal', async () => {
  await principal.goto(`${BASE}/community?tab=moderation`, { waitUntil: 'networkidle' });
  await expectText(principal, 'Reports (1)', current);
  await principal.selectOption('select[id^="report-res-"]', 'warn');
  await principal.getByRole('button', { name: 'Close report' }).first().click();
  await expectText(principal, 'Report closed.', current);
  await expectText(principal, 'Reports (0)', current);
});

await step('teacher archives the club so the demo data stays clean', 'teacher', async () => {
  await teacher.goto(`${BASE}/community?tab=groups`, { waitUntil: 'networkidle' });
  await teacher.getByRole('link', { name: clubName }).first().click();
  await teacher.waitForURL(/\/community\/groups\//, { timeout: 15000 });
  await teacher.getByRole('radio', { name: 'Settings' }).click();
  await teacher.getByRole('button', { name: 'Archive this group' }).click();
  await expectText(teacher, 'Archived.', current);
});

await browser.close();
writeFileSync(`${OUT}/flows25.json`, JSON.stringify(findings, null, 2));
for (const f of findings) console.log(`${f.step} | ${f.text}`);
console.log(findings.length === 0 ? 'FLOWS25 CLEAN' : `${findings.length} flow findings`);
