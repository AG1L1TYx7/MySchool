// Slice 21 user flows through the real UI: a principal sets up a webhook, an API key and an LTI tool;
// a teacher downloads the Canvas and Google Classroom sheets and sees the tool on the class page;
// the superintendent exports the audit log; a teacher cannot open Integrations.
import { launch, BASE, outDir } from '../lib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const stamp = Date.now();
const findings = [];
const note = (step, text) => findings.push({ step, text });
let current = 'start';
const pages = {};
const OUT = outDir(process.argv[2] ?? 'out21');
mkdirSync(OUT, { recursive: true });
const browser = await launch();
// A local receiver for the webhook test delivery (the API posts to it directly).
const receiver = createServer((req, res) => { req.on('data', () => undefined); req.on('end', () => res.end('ok')); });
await new Promise((r) => receiver.listen(0, '127.0.0.1', r));
const receiverUrl = `http://127.0.0.1:${receiver.address().port}/hook`;

async function login(role) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|ERR_ABORTED|403|404/.test(m.text())) note(current, `console: ${m.text().slice(0, 200)}`); });
  page.on('response', (r) => { const u = r.url(); if (u.includes('/api/v1/') && r.status() >= 400 && !/auth\/refresh/.test(u)) note(current, `http ${r.status()} ${r.request().method()} ${u.replace(BASE, '')}`); });
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
  const [dl] = await Promise.all([page.waitForEvent('download', { timeout: 20000 }), trigger()]);
  const name = dl.suggestedFilename();
  if (!pattern.test(name)) note(step, `download named ${name}`);
}

const principal = await login('principal');
await step('principal creates a webhook, sees the secret once and sends a test', 'principal', async () => {
  await principal.goto(`${BASE}/integrations`, { waitUntil: 'networkidle' });
  await principal.fill('#wh-name', `Flow hook ${stamp}`);
  await principal.fill('#wh-url', receiverUrl);
  await principal.getByLabel('Grade posted', { exact: false }).check();
  await principal.getByRole('button', { name: 'Create webhook' }).click();
  await expectText(principal, 'shown once', current);
  await expectText(principal, 'whsec_', current);
  const card = principal.locator('section', { hasText: `Flow hook ${stamp}` }).first();
  await card.getByRole('button', { name: 'Send test' }).click();
  await expectText(principal, 'Delivered, the receiver answered', current);
  await card.getByRole('button', { name: 'Deliveries' }).click();
  await expectText(principal, 'webhook.test', current);
  await principal.screenshot({ path: `${OUT}/webhooks.png`, fullPage: true });
});
await step('principal creates an API key, sees it once and revokes it', 'principal', async () => {
  await principal.getByRole('radio', { name: 'API keys' }).click();
  await principal.fill('#key-name', `Flow key ${stamp}`);
  await principal.getByLabel('Read students', { exact: false }).check();
  await principal.getByRole('button', { name: 'Create key' }).click();
  await expectText(principal, 'ssk_', current);
  const row = principal.locator('tr', { hasText: `Flow key ${stamp}` }).first();
  await row.getByRole('button', { name: 'Revoke' }).click();
  await expectText(row, 'revoked', current);
  await principal.screenshot({ path: `${OUT}/api-keys.png`, fullPage: true });
});
await step('principal registers an LTI tool and sees the platform details', 'principal', async () => {
  await principal.getByRole('radio', { name: 'LTI 1.3' }).click();
  await expectText(principal, 'Login initiation URL', current);
  await principal.fill('#t-name', `Flow tool ${stamp}`);
  await principal.fill('#t-login', 'https://tool.example.org/login');
  await principal.fill('#t-launch', 'https://tool.example.org/launch');
  await principal.getByRole('button', { name: 'Add tool' }).click();
  await expectText(principal, `Flow tool ${stamp}`, current);
  await expectText(principal, 'Deployment id', current);
  await principal.screenshot({ path: `${OUT}/lti.png`, fullPage: true });
});

const teacher = await login('teacher');
await step('teacher downloads the Canvas and Google Classroom sheets', 'teacher', async () => {
  await teacher.goto(`${BASE}/classes`, { waitUntil: 'networkidle' });
  await teacher.getByRole('link', { name: /English 7 - Section A/ }).first().click();
  await teacher.waitForURL(/\/classes\/[0-9a-f-]+$/, { timeout: 15000 });
  await expectText(teacher, `Open Flow tool ${stamp}`, current);
  const classUrl = teacher.url();
  await teacher.goto(`${classUrl}/gradebook`, { waitUntil: 'networkidle' });
  await expectDownload(teacher, () => teacher.getByRole('button', { name: 'For Canvas' }).click(), current, /^canvas-/);
  await expectDownload(teacher, () => teacher.getByRole('button', { name: 'For Google Classroom' }).click(), current, /^classroom-/);
});
await step('teacher cannot open integrations', 'teacher', async () => {
  await teacher.goto(`${BASE}/integrations`, { waitUntil: 'networkidle' });
  await expectText(teacher, 'Not available for your account', current);
});

const sup = await login('superintendent');
await step('superintendent exports the audit log', 'superintendent', async () => {
  await sup.goto(`${BASE}/audit-logs`, { waitUntil: 'networkidle' });
  await expectDownload(sup, () => sup.getByRole('button', { name: 'Export CSV' }).click(), current, /^audit-/);
});

await browser.close();
receiver.close();
writeFileSync(`${OUT}/flows21.json`, JSON.stringify(findings, null, 2));
for (const f of findings) console.log(`${f.step} | ${f.text}`);
console.log(findings.length === 0 ? 'FLOWS21 CLEAN' : `${findings.length} flow findings`);
