/**
 * Pure rules for operations (docs/02 section 35 and the rest of 32, slice 26): the status page's overall
 * state from component checks and open incidents, uptime by day, incident status transitions, and the
 * district security policy (password length, who must use 2FA, session age, administrator IP ranges).
 */

export const COMPONENTS = [
  { key: 'api', name: 'API' },
  { key: 'database', name: 'Database' },
  { key: 'ai', name: 'AI service' },
  { key: 'web', name: 'Web app' },
] as const;
export type ComponentKey = (typeof COMPONENTS)[number]['key'];

export const COMPONENT_STATES = [
  'operational',
  'degraded',
  'down',
  'disabled',
] as const;
export type ComponentState = (typeof COMPONENT_STATES)[number];

export const INCIDENT_KINDS = ['incident', 'maintenance'] as const;
export const INCIDENT_STATUSES = [
  'investigating',
  'identified',
  'monitoring',
  'resolved',
  'scheduled',
  'in_progress',
  'completed',
] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];
export const IMPACTS = ['none', 'minor', 'major', 'critical'] as const;
export type Impact = (typeof IMPACTS)[number];

export const OVERALL_STATES = [
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
  'maintenance',
] as const;
export type OverallState = (typeof OVERALL_STATES)[number];

export const CLOSED_STATUSES: readonly string[] = ['resolved', 'completed'];

/** Which statuses an incident may move to from where it is. */
export const TRANSITIONS: Record<string, readonly IncidentStatus[]> = {
  investigating: ['identified', 'monitoring', 'resolved'],
  identified: ['monitoring', 'resolved', 'investigating'],
  monitoring: ['resolved', 'investigating'],
  resolved: ['monitoring'],
  scheduled: ['in_progress', 'completed'],
  in_progress: ['completed'],
  completed: [],
};

export function canTransition(from: string, to: string): boolean {
  return (TRANSITIONS[from] ?? []).includes(to as IncidentStatus);
}

export function isOpen(status: string): boolean {
  return !CLOSED_STATUSES.includes(status);
}

/** Maps a health report's checks onto the status page components. */
export function componentsFromHealth(report: {
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: Record<'database' | 'aiService' | 'redis', { status: string }>;
}): Record<ComponentKey, ComponentState> {
  const map = (s: string): ComponentState =>
    s === 'up' ? 'operational' : s === 'disabled' ? 'disabled' : 'down';
  return {
    api: report.status === 'unhealthy' ? 'down' : 'operational',
    database: map(report.checks.database.status),
    ai: map(report.checks.aiService.status),
    web: 'operational',
  };
}

/** The one word at the top of the status page. */
export function overallStatus(
  components: Record<string, ComponentState>,
  incidents: Array<{ kind: string; status: string; impact: string }>,
): OverallState {
  const open = incidents.filter((i) => isOpen(i.status));
  if (open.some((i) => i.kind === 'maintenance' && i.status === 'in_progress'))
    return 'maintenance';
  const states = Object.values(components).filter((s) => s !== 'disabled');
  if (
    components.api === 'down' ||
    components.database === 'down' ||
    open.some((i) => i.impact === 'critical')
  )
    return 'major_outage';
  if (states.includes('down') || open.some((i) => i.impact === 'major'))
    return 'partial_outage';
  if (
    states.includes('degraded') ||
    open.some((i) => i.kind === 'incident' && i.impact === 'minor')
  )
    return 'degraded';
  return 'operational';
}

export const OVERALL_LABELS: Record<OverallState, string> = {
  operational: 'All systems operational',
  degraded: 'Some things are slower than usual',
  partial_outage: 'Part of the service is down',
  major_outage: 'The service is down',
  maintenance: 'Planned maintenance in progress',
};

/** Uptime per day over the last `days` days: the share of checks that did not find the service down. */
export function uptimeByDay(
  checks: Array<{ checkedAt: Date; status: string }>,
  days: number,
  now: Date,
): Array<{ day: string; percent: number | null; checks: number }> {
  const byDay = new Map<string, { ok: number; total: number }>();
  for (const c of checks) {
    const key = c.checkedAt.toISOString().slice(0, 10);
    const row = byDay.get(key) ?? { ok: 0, total: 0 };
    row.total += 1;
    if (c.status !== 'unhealthy') row.ok += 1;
    byDay.set(key, row);
  }
  const out: Array<{ day: string; percent: number | null; checks: number }> =
    [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i),
    );
    const key = d.toISOString().slice(0, 10);
    const row = byDay.get(key);
    out.push({
      day: key,
      percent: row ? Math.round((row.ok / row.total) * 10000) / 100 : null,
      checks: row?.total ?? 0,
    });
  }
  return out;
}

export function uptimeOverall(
  days: Array<{ percent: number | null }>,
): number | null {
  const known = days.filter((d) => d.percent !== null) as Array<{
    percent: number;
  }>;
  if (known.length === 0) return null;
  return (
    Math.round(
      (known.reduce((a, d) => a + d.percent, 0) / known.length) * 100,
    ) / 100
  );
}

export interface IncidentUpdate {
  at: string;
  status: string;
  message: string;
  byId: string | null;
}

export function parseUpdates(
  json: string | null | undefined,
): IncidentUpdate[] {
  try {
    const v = json ? (JSON.parse(json) as unknown) : [];
    return Array.isArray(v)
      ? (v.filter(
          (u) =>
            u &&
            typeof u === 'object' &&
            typeof (u as IncidentUpdate).message === 'string',
        ) as IncidentUpdate[])
      : [];
  } catch {
    return [];
  }
}

export function parseComponents(
  csv: string | null | undefined,
): ComponentKey[] {
  const keys = new Set<string>(COMPONENTS.map((c) => c.key));
  return (csv ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s): s is ComponentKey => keys.has(s));
}

// Security policy -------------------------------------------------------------------------------------

export interface SecurityPolicy {
  /** At least this many characters for new passwords in the district (the platform floor is 12). */
  passwordMinLength: number;
  /** Roles (API names such as principal, teacher) that must finish 2FA setup before using the product. */
  mfaRequiredRoles: string[];
  /** Sign-ins older than this many hours are closed, whatever the refresh token says; 0 keeps the platform default. */
  sessionMaxHours: number;
  /** Administrators (principal, superintendent) may sign in only from these IPv4 ranges; empty means anywhere. */
  adminIpAllowlist: string[];
}

export const PLATFORM_PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;
export const SESSION_MAX_HOURS_LIMIT = 24 * 90;
export const ADMIN_ROLES: readonly string[] = [
  'super_admin',
  'superintendent',
  'principal',
];

export const SECURITY_DEFAULTS: SecurityPolicy = {
  passwordMinLength: PLATFORM_PASSWORD_MIN,
  mfaRequiredRoles: [],
  sessionMaxHours: 0,
  adminIpAllowlist: [],
};

const ROLE_NAME = /^[a-z_]{3,24}$/;
const CIDR = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?:\/(\d{1,2}))?$/;

export function isValidCidr(s: string): boolean {
  const m = CIDR.exec(s);
  if (!m) return false;
  const octets = m.slice(1, 5).map(Number);
  if (octets.some((o) => o > 255)) return false;
  const bits = m[5] === undefined ? 32 : Number(m[5]);
  return bits >= 0 && bits <= 32;
}

/** Reads a stored policy leniently: anything odd falls back to the default for that field. */
export function parseSecurityPolicy(raw: unknown): SecurityPolicy {
  const r =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const n = (v: unknown, min: number, max: number, dflt: number) =>
    typeof v === 'number' && Number.isFinite(v)
      ? Math.min(max, Math.max(min, Math.round(v)))
      : dflt;
  const list = (v: unknown, ok: (s: string) => boolean) =>
    Array.isArray(v)
      ? Array.from(
          new Set(
            v
              .filter((x): x is string => typeof x === 'string' && ok(x.trim()))
              .map((x) => x.trim()),
          ),
        )
      : [];
  return {
    passwordMinLength: n(
      r.passwordMinLength,
      PLATFORM_PASSWORD_MIN,
      64,
      PLATFORM_PASSWORD_MIN,
    ),
    mfaRequiredRoles: list(r.mfaRequiredRoles, (s) => ROLE_NAME.test(s)),
    sessionMaxHours: n(r.sessionMaxHours, 0, SESSION_MAX_HOURS_LIMIT, 0),
    adminIpAllowlist: list(r.adminIpAllowlist, isValidCidr),
  };
}

export function passwordLongEnough(
  policy: SecurityPolicy,
  password: string,
): boolean {
  return password.length >= policy.passwordMinLength;
}

export function mfaRequiredByPolicy(
  policy: SecurityPolicy,
  roleApiName: string,
): boolean {
  return policy.mfaRequiredRoles.includes(roleApiName);
}

/** A session that began more than the policy's hours ago is over. 0 means no district limit. */
export function sessionTooOld(
  policy: SecurityPolicy,
  startedAt: Date,
  now: Date,
): boolean {
  if (policy.sessionMaxHours <= 0) return false;
  return (
    now.getTime() - startedAt.getTime() > policy.sessionMaxHours * 3_600_000
  );
}

function ipv4ToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(
    ip.replace(/^::ffff:/, ''),
  );
  if (!m) return null;
  const o = m.slice(1).map(Number);
  if (o.some((x) => x > 255)) return null;
  return ((o[0] << 24) | (o[1] << 16) | (o[2] << 8) | o[3]) >>> 0;
}

export function ipInCidr(ip: string, cidr: string): boolean {
  const m = CIDR.exec(cidr);
  const addr = ipv4ToInt(ip);
  if (!m || addr === null) return false;
  const base = ipv4ToInt(m.slice(1, 5).join('.'));
  if (base === null) return false;
  const bits = m[5] === undefined ? 32 : Number(m[5]);
  if (bits === 0) return true;
  const mask = (0xffffffff << (32 - bits)) >>> 0;
  return (addr & mask) >>> 0 === (base & mask) >>> 0;
}

/** Administrators are held to the allowlist when one is set; everyone else, and an empty list, pass. */
export function ipAllowed(
  policy: SecurityPolicy,
  roleApiName: string,
  ip: string | null,
): boolean {
  if (policy.adminIpAllowlist.length === 0) return true;
  if (!ADMIN_ROLES.includes(roleApiName)) return true;
  if (!ip) return false;
  if (ip === '::1' || ip === '127.0.0.1' || ip === '::ffff:127.0.0.1')
    return true;
  return policy.adminIpAllowlist.some((c) => ipInCidr(ip, c));
}
