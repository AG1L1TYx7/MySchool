/**
 * Small in-memory counters for abuse that the global rate limit does not see (docs/21 F29, F39): wrong
 * school join codes from one address, and mail sent to one address. Both are per process; a deployment
 * with several API instances gets a per-instance bound, which is still a bound.
 */

export interface AttemptWindow {
  count: number;
  resetAt: number;
}

export const JOIN_CODE_FAILURE_LIMIT = { limit: 5, windowMs: 15 * 60_000 };
export const MAIL_COOLDOWN_MS = 5 * 60_000;

/** Counts a failed attempt for `key` and reports whether the window's limit is now exceeded. */
export function noteFailure(
  windows: Map<string, AttemptWindow>,
  key: string,
  now: number,
  rule: { limit: number; windowMs: number } = JOIN_CODE_FAILURE_LIMIT,
): boolean {
  const current = windows.get(key);
  const w =
    current && current.resetAt > now
      ? current
      : { count: 0, resetAt: now + rule.windowMs };
  w.count += 1;
  windows.set(key, w);
  sweep(windows, now);
  return w.count > rule.limit;
}

/** True while `key` is over the limit of an open window. */
export function isBlocked(
  windows: Map<string, AttemptWindow>,
  key: string,
  now: number,
  rule: { limit: number; windowMs: number } = JOIN_CODE_FAILURE_LIMIT,
): boolean {
  const w = windows.get(key);
  return !!w && w.resetAt > now && w.count > rule.limit;
}

/** Records a mail to `key` unless one went out within the cooldown; returns true when the mail may be sent. */
export function mailAllowed(
  lastSent: Map<string, number>,
  key: string,
  now: number,
  cooldownMs: number = MAIL_COOLDOWN_MS,
): boolean {
  const last = lastSent.get(key);
  if (last !== undefined && now - last < cooldownMs) return false;
  lastSent.set(key, now);
  if (lastSent.size > 10_000)
    for (const [k, t] of lastSent)
      if (now - t >= cooldownMs) lastSent.delete(k);
  return true;
}

function sweep(windows: Map<string, AttemptWindow>, now: number): void {
  if (windows.size < 10_000) return;
  for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k);
}
