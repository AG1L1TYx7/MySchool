/**
 * Tenant rules (ADR-005, docs/07 row 20): slugs and domains, branding and the district policy switches
 * that sit above every school's own settings. Pure.
 */
import { createHash } from 'node:crypto';

export const TENANT_STATUSES = ['active', 'trial', 'suspended'] as const;
export type TenantStatus = (typeof TENANT_STATUSES)[number];

export interface Branding {
  displayName: string | null;
  primaryColor: string | null;
  logoUrl: string | null;
  supportEmail: string | null;
}

export interface TenantPolicies {
  /** AI tutor and assistant for the whole district; a school cannot switch it on when the district is off. */
  aiEnabled: boolean;
  /** Per-school overrides, by organisation id, when the district leaves AI on. */
  aiDisabledSchools: string[];
  /** Student-to-student messaging may be switched on by a school only when the district allows it. */
  studentMessagingAllowed: boolean;
  /** Feature codes nobody in the district may use (SuperAdmin excepted). */
  disabledFeatures: string[];
  /** Retention days that apply to a school that has not set its own. */
  retention: Partial<
    Record<
      | 'aiConversations'
      | 'notifications'
      | 'auditLogs'
      | 'learningRecords'
      | 'pushLogs'
      | 'withdrawnStudents',
      number
    >
  >;
}

export const DEFAULT_POLICIES: TenantPolicies = {
  aiEnabled: true,
  aiDisabledSchools: [],
  studentMessagingAllowed: true,
  disabledFeatures: [],
  retention: {},
};

const FEATURE_CODE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parsePolicies(json: string | null | undefined): TenantPolicies {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = json ? (JSON.parse(json) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }
  const strings = (v: unknown, ok: (s: string) => boolean) =>
    Array.isArray(v)
      ? v.filter((x): x is string => typeof x === 'string' && ok(x))
      : [];
  const retention: TenantPolicies['retention'] = {};
  if (parsed.retention && typeof parsed.retention === 'object')
    for (const [k, v] of Object.entries(
      parsed.retention as Record<string, unknown>,
    ))
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0)
        (retention as Record<string, number>)[k] = Math.round(v);
  return {
    aiEnabled:
      parsed.aiEnabled === undefined ? true : parsed.aiEnabled === true,
    aiDisabledSchools: strings(parsed.aiDisabledSchools, (s) => UUID.test(s)),
    studentMessagingAllowed:
      parsed.studentMessagingAllowed === undefined
        ? true
        : parsed.studentMessagingAllowed === true,
    disabledFeatures: strings(parsed.disabledFeatures, (s) =>
      FEATURE_CODE.test(s),
    ),
    retention,
  };
}

export function parseBranding(json: string | null | undefined): Branding {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = json ? (JSON.parse(json) as Record<string, unknown>) : {};
  } catch {
    parsed = {};
  }
  const str = (v: unknown, max: number) =>
    typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null;
  const color = str(parsed.primaryColor, 7);
  return {
    displayName: str(parsed.displayName, 80),
    primaryColor:
      color && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null,
    logoUrl: (() => {
      const u = str(parsed.logoUrl, 500);
      return u && /^https?:\/\//.test(u) ? u : null;
    })(),
    supportEmail: str(parsed.supportEmail, 120),
  };
}

/** Whether AI features may run for a school under its district's policy. */
export function aiAllowedForSchool(
  policies: TenantPolicies,
  organizationId: string,
): boolean {
  return (
    policies.aiEnabled && !policies.aiDisabledSchools.includes(organizationId)
  );
}

export function featureDisabled(
  policies: TenantPolicies,
  feature: string,
): boolean {
  return policies.disabledFeatures.includes(feature);
}

/** Slugs are DNS labels: lowercase letters, digits and single dashes, 3 to 63 characters. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 63);
}

export function isValidSlug(slug: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(slug) &&
    !/--/.test(slug) &&
    !['www', 'api', 'admin', 'default'].includes(slug)
    ? true
    : slug === 'default';
}

export function isValidDomain(domain: string): boolean {
  return /^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(
    domain,
  );
}

/**
 * Which tenant a request is for, from the Host header: `slug.<baseDomain>` is a subdomain tenant, any other
 * host is looked up as a custom domain, and the bare base domain (or localhost) is the default.
 */
export function tenantFromHost(
  host: string | undefined,
  baseDomain: string,
): { slug: string } | { customDomain: string } | { default: true } {
  const h = (host ?? '').toLowerCase().split(':')[0];
  if (!h || h === baseDomain || h === 'localhost' || h === '127.0.0.1')
    return { default: true };
  if (h.endsWith(`.${baseDomain}`)) {
    const slug = h.slice(0, -(baseDomain.length + 1));
    return slug.includes('.') || !slug ? { default: true } : { slug };
  }
  return { customDomain: h };
}

/** The DNS TXT record a district publishes to prove it owns a custom domain. */
export function domainVerification(
  tenantId: string,
  domain: string,
  secret: string,
): { name: string; value: string } {
  const value = createHash('sha256')
    .update(`${tenantId}:${domain}:${secret}`)
    .digest('hex')
    .slice(0, 32);
  return {
    name: `_smartschool.${domain}`,
    value: `smartschool-verify=${value}`,
  };
}

export interface SchoolRow {
  organizationId: string;
  name: string;
  students: number;
  staff: number;
  attendanceRate30: number | null;
  presentToday: number | null;
  missingItems: number;
  failing: number;
  gradebookCompleteness: number | null;
  aiConversations7: number;
  openIncidents: number;
}

/** District totals from the school rows: sums for counts, student-weighted means for rates. */
export function districtTotals(rows: SchoolRow[]) {
  const sum = (f: (r: SchoolRow) => number) =>
    rows.reduce((s, r) => s + f(r), 0);
  const weighted = (f: (r: SchoolRow) => number | null) => {
    const pairs = rows.filter((r) => f(r) !== null && r.students > 0);
    const weight = pairs.reduce((s, r) => s + r.students, 0);
    return weight
      ? Math.round(
          (pairs.reduce((s, r) => s + (f(r) as number) * r.students, 0) /
            weight) *
            10,
        ) / 10
      : null;
  };
  return {
    schools: rows.length,
    students: sum((r) => r.students),
    staff: sum((r) => r.staff),
    attendanceRate30: weighted((r) => r.attendanceRate30),
    presentToday: weighted((r) => r.presentToday),
    missingItems: sum((r) => r.missingItems),
    failing: sum((r) => r.failing),
    gradebookCompleteness: weighted((r) => r.gradebookCompleteness),
    aiConversations7: sum((r) => r.aiConversations7),
    openIncidents: sum((r) => r.openIncidents),
  };
}

/** Average daily attendance for state reports: present-like records over records, as a share with four decimals. */
export function averageDailyAttendance(
  records: Array<{ status: string }>,
): number | null {
  if (records.length === 0) return null;
  const present = records.filter((r) =>
    ['PRESENT', 'LATE', 'TARDY', 'LEFT_EARLY'].includes(r.status),
  ).length;
  return Math.round((present / records.length) * 10000) / 10000;
}

export const STATE_EXPORT_KINDS = [
  'enrollment',
  'attendance',
  'discipline',
  'grades',
] as const;
export type StateExportKind = (typeof STATE_EXPORT_KINDS)[number];
export const DISTRICT_REPORT_KINDS = [
  'schools',
  'enrollment_by_grade',
  'attendance_daily',
  'ai_usage',
] as const;
export type DistrictReportKind = (typeof DISTRICT_REPORT_KINDS)[number];
