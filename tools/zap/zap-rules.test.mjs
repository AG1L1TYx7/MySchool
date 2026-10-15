import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACCEPTED, alertsFrom, summarize, verdict } from './zap-rules.mjs';

const report = (alerts) => ({ site: [{ '@name': 'http://localhost:3000', alerts }] });
const alert = (pluginid, riskcode, name = 'x', uri = 'http://localhost:3000/login') => ({ pluginid, riskcode: String(riskcode), alert: name, count: '1', instances: [{ uri, method: 'GET' }] });

test('flattens the report with risk, count and an example', () => {
  const rows = alertsFrom(report([alert('10021', 1, 'X-Content-Type-Options Header Missing')]));
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].pluginid, rows[0].risk, rows[0].count], ['10021', 1, 1]);
  assert.match(rows[0].example, /GET http/);
  assert.deepEqual(alertsFrom(null), []);
});

test('high and medium fail, low and informational warn, accepted ids pass with their reason', () => {
  const v = verdict([report([alert('90001', 3, 'SQL Injection'), alert('10038', 2, 'CSP missing'), alert('10015', 1, 'cache'), alert('10055', 2, 'CSP unsafe-inline')])]);
  assert.equal(v.ok, false);
  assert.deepEqual(v.failures.map((f) => f.pluginid), ['90001', '10038']);
  assert.deepEqual(v.warnings.map((f) => f.pluginid), ['10015']);
  assert.equal(v.accepted.length, 1);
  assert.match(v.accepted[0].line, /accepted, the web client's CSP/);
  assert.equal(verdict([report([alert('10015', 1)])]).ok, true);
  assert.equal(verdict([]).ok, true);
});

test('every accepted alert has a reason and the summary reads as one line', () => {
  for (const a of ACCEPTED) assert.ok(a.pluginid && a.reason.length > 20);
  assert.equal(summarize({ ok: true, warnings: [1, 2], accepted: [1], failures: [] }), 'zap: clean (2 low or informational, 1 accepted)');
  assert.equal(summarize({ ok: false, failures: [1], warnings: [], accepted: [] }), 'zap: 1 alert at medium or high');
});
