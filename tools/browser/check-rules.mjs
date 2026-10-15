/**
 * Pure rules for the browser checks: which sweep findings are noise, how a Lighthouse run measures up to the
 * budget, and the one-line verdict a CI step prints. No browser, no files.
 */

/** A request the sweep cancelled itself by moving to the next page is not a finding. */
export function isNoise(finding) {
  if (!finding || typeof finding.text !== 'string') return false;
  if (/ERR_ABORTED/.test(finding.text)) return true;
  if (finding.kind === 'requestfailed' && /socket\.io/.test(finding.text)) return true;
  return false;
}

export function realFindings(findings) {
  return (findings ?? []).filter((f) => !isNoise(f));
}

/** Default budget: performance 80 on the public pages, accessibility, best practices and SEO 100. */
export const DEFAULT_BUDGET = { performance: 80, accessibility: 100, bestPractices: 100, seo: 100 };

/** Pages whose budget is informational only, by path. Empty since slice 28: /status renders on the server now. */
export const INFORMATIONAL = [];

export function budgetVerdict(rows, budget = DEFAULT_BUDGET, informational = INFORMATIONAL) {
  const failures = [];
  for (const r of rows ?? []) {
    const path = new URL(r.url).pathname;
    for (const key of Object.keys(budget)) {
      const value = r[key];
      if (typeof value !== 'number') continue;
      if (value < budget[key]) {
        const line = `${path}: ${key} ${value} < ${budget[key]}`;
        if (informational.includes(path)) failures.push({ path, key, value, informational: true, line: `${line} (informational)` });
        else failures.push({ path, key, value, informational: false, line });
      }
    }
  }
  return { ok: failures.every((f) => f.informational), failures };
}

/** One line for the CI log and the step summary. */
export function summarize(name, count, detail) {
  return count === 0 ? `${name}: clean${detail ? ` (${detail})` : ''}` : `${name}: ${count} finding${count === 1 ? '' : 's'}${detail ? ` (${detail})` : ''}`;
}
