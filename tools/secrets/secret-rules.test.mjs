import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findSecrets, isAllowedValue, isScannable, summarize } from './secret-rules.mjs';

test('skips lock files, generated documents, binaries and build output', () => {
  assert.equal(isScannable('pnpm-lock.yaml'), false);
  assert.equal(isScannable('docs/openapi.json'), false);
  assert.equal(isScannable('apps/web/public/icon.png'), false);
  assert.equal(isScannable('apps/api/src/generated/prisma/client.ts'), false);
  assert.equal(isScannable('apps/api/src/main.ts'), true);
  assert.equal(isScannable('.env.example'), true);
});

test('finds real credentials and leaves placeholders and fixtures alone', () => {
  const found = findSecrets('apps/api/.env', [
    'JWT_SECRET=CHANGE_ME_TO_A_LONG_RANDOM_VALUE_______',
    'AI_CALLBACK_TOKEN=e2e-ai-service-token-0123456789',
    'STRIPE_SECRET_KEY=sk_test_fixture',
    'AWS_KEY=AKIAIOSFODNN7EXAMPLE',
    'DB_PASSWORD=Qm7pX2vL9sT4wR8nK3jH6bF1',
    'GOOGLE=AIzaSyA1234567890abcdefghijklmnopqrstuv',
    // Built at run time so this file never holds a string that scanners (ours or GitHub's) would flag.
    `LEAK=${['sk', 'live', 'Qm7pX2vL9sT4wR8nK3jH6bF1'].join('_')}`,
    '-----BEGIN RSA PRIVATE KEY-----',
    'TOKEN=abcdefghijklmnopqrstuvwx123456 # secret-scan: allow',
  ].join('\n'));
  assert.deepEqual(found.map((f) => [f.line, f.id]), [
    [5, 'assigned-secret'],
    [6, 'google-api-key'],
    [7, 'stripe-live-key'],
    [8, 'private-key'],
  ]);
  assert.equal(isAllowedValue('whsec_fixture_0123456789'), true);
  assert.equal(isAllowedValue('xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), true);
  assert.equal(isAllowedValue('Qm7pX2vL9sT4wR8nK3jH6bF1'), false);
  assert.equal(findSecrets('pnpm-lock.yaml', 'PASSWORD=Qm7pX2vL9sT4wR8nK3jH6bF1').length, 0);
});

test('summaries read as one line', () => {
  assert.equal(summarize([]), 'secrets: clean');
  assert.equal(summarize([{}]), 'secrets: 1 finding');
  assert.equal(summarize([{}, {}]), 'secrets: 2 findings');
});
