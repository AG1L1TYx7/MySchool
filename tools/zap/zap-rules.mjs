/**
 * Pure rules for the OWASP ZAP scan (slice 29): which alerts fail the build, which only warn, and which are
 * accepted with a written reason. ZAP's JSON report lists alerts per site with a risk code
 * (3 high, 2 medium, 1 low, 0 informational). No ZAP, no files here.
 */

/** Accepted alerts, by ZAP plugin id, each with the reason the product keeps it. Reviewed in docs/16. */
export const ACCEPTED = [
  { pluginid: '10055', reason: "the web client's CSP allows 'unsafe-inline' scripts for Next.js hydration; no inline user content is rendered (docs/11 informational)" },
  { pluginid: '10202', reason: 'the sign-in and sign-up forms are JSON posts authenticated by a bearer token, not cookie forms; the cookie route requires the X-Requested-With header' },
  { pluginid: '10096', reason: 'timestamps in page text are dates the page shows on purpose' },
  { pluginid: '10027', reason: 'the compiled client bundle carries framework comments, not secrets' },
];

export const RISK = { 3: 'high', 2: 'medium', 1: 'low', 0: 'informational' };

/** Flattens ZAP's report into one list: { pluginid, name, risk, count, example }. */
export function alertsFrom(report) {
  const out = [];
  for (const site of report?.site ?? []) {
    for (const a of site.alerts ?? []) {
      const risk = Number(a.riskcode);
      const first = (a.instances ?? [])[0];
      out.push({
        pluginid: String(a.pluginid),
        name: a.alert ?? a.name ?? 'unnamed',
        risk: Number.isFinite(risk) ? risk : 0,
        count: Number(a.count ?? (a.instances ?? []).length ?? 0),
        example: first ? `${first.method ?? ''} ${first.uri ?? ''}`.trim() : '',
        site: site['@name'] ?? site.name ?? '',
      });
    }
  }
  return out;
}

/**
 * The verdict: high and medium alerts fail unless accepted; low and informational only warn.
 * Returns { ok, failures, warnings, accepted } with one printable line per alert.
 */
export function verdict(reports, accepted = ACCEPTED) {
  const acceptedById = new Map(accepted.map((a) => [String(a.pluginid), a.reason]));
  const failures = [];
  const warnings = [];
  const acceptedHits = [];
  for (const report of reports ?? []) {
    for (const a of alertsFrom(report)) {
      const line = `[${RISK[a.risk]}] ${a.pluginid} ${a.name} (${a.count}) ${a.example}`.trim();
      const reason = acceptedById.get(a.pluginid);
      if (reason && a.risk >= 2) acceptedHits.push({ ...a, line: `${line}: accepted, ${reason}` });
      else if (a.risk >= 2) failures.push({ ...a, line });
      else warnings.push({ ...a, line });
    }
  }
  return { ok: failures.length === 0, failures, warnings, accepted: acceptedHits };
}

export function summarize(v) {
  if (v.ok) return `zap: clean (${v.warnings.length} low or informational, ${v.accepted.length} accepted)`;
  return `zap: ${v.failures.length} alert${v.failures.length === 1 ? '' : 's'} at medium or high`;
}
