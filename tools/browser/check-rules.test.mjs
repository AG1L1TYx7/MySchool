import assert from 'node:assert/strict';
import { test } from 'node:test';
import { budgetVerdict, isNoise, realFindings, summarize } from './check-rules.mjs';

test('cancelled navigations and socket polling are noise, everything else is real', () => {
  assert.equal(isNoise({ kind: 'requestfailed', text: 'http://x/api/v1/me net::ERR_ABORTED' }), true);
  assert.equal(isNoise({ kind: 'requestfailed', text: 'http://x/api/socket.io?EIO=4 net::ERR_FAILED' }), true);
  assert.equal(isNoise({ kind: 'http 500', text: 'GET /api/v1/classes' }), false);
  assert.equal(isNoise({ kind: 'console', text: 'TypeError: x is undefined' }), false);
  assert.equal(isNoise(null), false);
  assert.equal(realFindings([{ kind: 'http 403', text: 'GET /a' }, { kind: 'requestfailed', text: 'net::ERR_ABORTED' }]).length, 1);
});

test('the Lighthouse budget fails on a real page below budget and only notes an informational one', () => {
  const rows = [
    { url: 'http://localhost:3000/login', performance: 90, accessibility: 100, bestPractices: 100, seo: 100 },
    { url: 'http://localhost:3000/status', performance: 78, accessibility: 100, bestPractices: 100, seo: 100 },
  ];
  // Since slice 28 the status page is held to the budget like every other public page.
  const strict = budgetVerdict(rows);
  assert.equal(strict.ok, false);
  assert.equal(strict.failures.length, 1);
  const ok = budgetVerdict(rows, undefined, ['/status']);
  assert.equal(ok.ok, true);
  assert.equal(ok.failures.length, 1);
  assert.match(ok.failures[0].line, /informational/);
  const bad = budgetVerdict([{ url: 'http://localhost:3000/login', performance: 70, accessibility: 99, bestPractices: 100, seo: 100 }]);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.failures.map((f) => f.key), ['performance', 'accessibility']);
  assert.equal(budgetVerdict([]).ok, true);
});

test('summaries read as one line', () => {
  assert.equal(summarize('sweep', 0, '261 pages'), 'sweep: clean (261 pages)');
  assert.equal(summarize('axe', 1), 'axe: 1 finding');
  assert.equal(summarize('axe', 3, '5 roles'), 'axe: 3 findings (5 roles)');
});
