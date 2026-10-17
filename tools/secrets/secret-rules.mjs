/**
 * Pure rules for the secret scan (slice 33, docs/21 section 5): which tracked files are looked at, what counts
 * as a leaked credential, and which values are known placeholders or fixtures. No git, no files here.
 */

/** Files never scanned: lock files, generated documents, binaries, vendored data. */
export function isScannable(path) {
  if (!path) return false;
  const p = path.replace(/\\/g, '/');
  if (/(^|\/)(pnpm-lock\.yaml|package-lock\.json|yarn\.lock|openapi\.json|load-test\.json)$/.test(p)) return false;
  // The scanner's own test holds sample credentials on purpose.
  if (p === 'tools/secrets/secret-rules.test.mjs') return false;
  if (/\.(png|jpg|jpeg|gif|webp|svg|ico|woff2?|ttf|pdf|zip|mp3|mp4|h5p|pyc)$/i.test(p)) return false;
  if (/(^|\/)(node_modules|\.next|dist|coverage|coverage-e2e|\.venv|generated)\//.test(p)) return false;
  return true;
}

/** Values that look like credentials but are documented placeholders or test fixtures. */
export const ALLOWED_VALUES = [
  /CHANGE_ME/i,
  /^(x|y|z|k|a)\1{15,}$/,
  /^(sk|pk)_test_/,
  /whsec_fixture/,
  /fixture|example|placeholder|dummy|sample|e2e-|ci-only|unit-test|test-service-token|live-service-token/i,
];

/** The patterns, each with the group that holds the value when one is needed. */
export const PATTERNS = [
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/, needsValue: false },
  { id: 'aws-access-key', re: /\b(AKIA[0-9A-Z]{16})\b/, needsValue: true },
  { id: 'google-api-key', re: /\b(AIza[0-9A-Za-z_-]{35})\b/, needsValue: true },
  { id: 'github-token', re: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/, needsValue: true },
  { id: 'stripe-live-key', re: /\b((?:sk|rk)_live_[0-9A-Za-z]{16,})\b/, needsValue: true },
  { id: 'slack-token', re: /\b(xox[abpr]-[0-9A-Za-z-]{20,})\b/, needsValue: true },
  { id: 'openai-key', re: /\b(sk-[A-Za-z0-9]{32,})\b/, needsValue: true },
  { id: 'jwt', re: /\b(eyJ[A-Za-z0-9_-]{20,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,})\b/, needsValue: true },
  {
    id: 'assigned-secret',
    re: /\b(?:[A-Z0-9_]*(?:SECRET|PASSWORD|TOKEN|API_KEY|PRIVATE_KEY)[A-Z0-9_]*)\s*[=:]\s*["']?([A-Za-z0-9+/=_\-]{24,})["']?/,
    needsValue: true,
  },
];

export function isAllowedValue(value) {
  return ALLOWED_VALUES.some((re) => re.test(value ?? ''));
}

/** Findings in one file's text: { id, line, snippet }. A line with `secret-scan: allow` is skipped. */
export function findSecrets(path, text) {
  const findings = [];
  if (!isScannable(path)) return findings;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/secret-scan:\s*allow/.test(line)) continue;
    for (const p of PATTERNS) {
      const m = p.re.exec(line);
      if (!m) continue;
      const value = p.needsValue ? m[1] : null;
      if (p.needsValue && isAllowedValue(value)) continue;
      findings.push({ id: p.id, line: i + 1, snippet: line.trim().slice(0, 80) });
      break;
    }
  }
  return findings;
}

export function summarize(findings) {
  if (findings.length === 0) return 'secrets: clean';
  return `secrets: ${findings.length} finding${findings.length === 1 ? '' : 's'}`;
}
