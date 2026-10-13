import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Pure rules for billing (docs/02 section 32, slice 26): plans and what a month costs, billing periods,
 * invoice numbers and lines, when an invoice is overdue and a subscription past due, idempotency keys for
 * the write routes, usage roll-ups and the signature check for a payment provider's webhook. No clock of
 * its own, no database.
 */

export const SUBSCRIPTION_STATUSES = [
  'trialing',
  'active',
  'past_due',
  'canceled',
] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const INVOICE_STATUSES = ['open', 'paid', 'void', 'overdue'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const PROVIDERS = ['manual', 'stripe'] as const;

/** Days after the due date before an open invoice counts as overdue and the subscription as past due. */
export const GRACE_DAYS = 14;
export const NET_DAYS = 30;
/** How long a stored idempotent response is replayed. */
export const IDEMPOTENCY_HOURS = 24;
/** A provider webhook older than this is refused (replay protection). */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

export interface PlanLike {
  code: string;
  name: string;
  pricePerStudentCents: number;
  minimumCents: number;
  includedStudents: number;
}

/** The platform's plans; prices are the defaults a platform administrator may change per plan row. */
export const PLATFORM_PLANS: Array<
  PlanLike & { description: string; features: string[]; sortOrder: number }
> = [
  {
    code: 'starter',
    name: 'Starter',
    description:
      'One school trying SmartSchool: the full product for up to 150 students at no charge.',
    pricePerStudentCents: 0,
    minimumCents: 0,
    includedStudents: 150,
    features: [
      'All teaching and learning features',
      'Local AI tutor and assistant',
      'Email support',
    ],
    sortOrder: 1,
  },
  {
    code: 'district',
    name: 'District',
    description:
      'Every school in a district with rostering, SSO, state exports and integrations.',
    pricePerStudentCents: 300,
    minimumCents: 50_000,
    includedStudents: 0,
    features: [
      'Everything in Starter',
      'Rostering and SSO',
      'State reporting exports',
      'Webhooks, API keys and LTI',
      'Priority support',
    ],
    sortOrder: 2,
  },
  {
    code: 'enterprise',
    name: 'Enterprise',
    description:
      'Large districts and consortia with a custom domain, data residency and a named contact.',
    pricePerStudentCents: 500,
    minimumCents: 200_000,
    includedStudents: 0,
    features: [
      'Everything in District',
      'Custom domain and branding',
      'Dedicated contact and response times',
      'Security review support',
    ],
    sortOrder: 3,
  },
];

/** What a month costs: students beyond the included ones at the per-student price, never below the minimum. */
export function monthlyAmountCents(plan: PlanLike, seats: number): number {
  const billable = Math.max(0, Math.floor(seats) - plan.includedStudents);
  return Math.max(plan.minimumCents, billable * plan.pricePerStudentCents);
}

/** The month that starts at `start`: ends the same day next month (clamped to that month's length). */
export function periodFrom(start: Date): { start: Date; end: Date } {
  const s = new Date(
    Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()),
  );
  const daysInNext = new Date(
    Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 2, 0),
  ).getUTCDate();
  const end = new Date(
    Date.UTC(
      s.getUTCFullYear(),
      s.getUTCMonth() + 1,
      Math.min(s.getUTCDate(), daysInNext),
    ),
  );
  return { start: s, end };
}

export function invoiceNumber(year: number, sequence: number): string {
  return `INV-${year}-${String(sequence).padStart(5, '0')}`;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
}

/** Lines for one billing period. The minimum shows as its own line when it is what the customer pays. */
export function buildInvoiceLines(
  plan: PlanLike,
  seats: number,
  period: { start: Date; end: Date },
): {
  lines: InvoiceLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
} {
  const label = `${period.start.toISOString().slice(0, 10)} to ${period.end.toISOString().slice(0, 10)}`;
  const billable = Math.max(0, Math.floor(seats) - plan.includedStudents);
  const usage = billable * plan.pricePerStudentCents;
  const lines: InvoiceLine[] = [];
  if (plan.pricePerStudentCents > 0 && billable > 0) {
    lines.push({
      description: `${plan.name} plan, ${billable} student${billable === 1 ? '' : 's'}${plan.includedStudents ? ` beyond ${plan.includedStudents} included` : ''} (${label})`,
      quantity: billable,
      unitCents: plan.pricePerStudentCents,
      amountCents: usage,
    });
  }
  if (plan.minimumCents > usage) {
    lines.push({
      description: lines.length
        ? `Minimum for the ${plan.name} plan (difference)`
        : `${plan.name} plan minimum (${label})`,
      quantity: 1,
      unitCents: plan.minimumCents - usage,
      amountCents: plan.minimumCents - usage,
    });
  }
  if (lines.length === 0) {
    lines.push({
      description: `${plan.name} plan (${label}), ${Math.floor(seats)} students, no charge`,
      quantity: 1,
      unitCents: 0,
      amountCents: 0,
    });
  }
  const subtotalCents = lines.reduce((a, l) => a + l.amountCents, 0);
  return { lines, subtotalCents, taxCents: 0, totalCents: subtotalCents };
}

export function dueDateFor(issuedAt: Date, netDays = NET_DAYS): Date {
  return new Date(issuedAt.getTime() + netDays * 86_400_000);
}

/** An open invoice past its due date plus the grace period is overdue. */
export function effectiveInvoiceStatus(
  invoice: { status: string; dueAt: Date },
  now: Date,
  graceDays = GRACE_DAYS,
): InvoiceStatus {
  if (invoice.status === 'paid' || invoice.status === 'void')
    return invoice.status;
  return now.getTime() > invoice.dueAt.getTime() + graceDays * 86_400_000
    ? 'overdue'
    : 'open';
}

/** Canceled wins; then a trial still running; then past due when any invoice is overdue; otherwise active. */
export function subscriptionStatusFrom(
  subscription: { canceledAt: Date | null; trialEndsAt: Date | null },
  invoices: Array<{ status: string; dueAt: Date }>,
  now: Date,
): SubscriptionStatus {
  if (subscription.canceledAt) return 'canceled';
  if (subscription.trialEndsAt && subscription.trialEndsAt > now)
    return 'trialing';
  if (invoices.some((i) => effectiveInvoiceStatus(i, now) === 'overdue'))
    return 'past_due';
  return 'active';
}

/** Monthly recurring revenue across subscriptions that are not canceled. */
export function monthlyRecurringCents(
  rows: Array<{ status: string; seats: number; plan: PlanLike }>,
): number {
  return rows
    .filter((r) => r.status !== 'canceled')
    .reduce((a, r) => a + monthlyAmountCents(r.plan, r.seats), 0);
}

/** Students a tenant is billed for: active students across its schools. */
export function seatsFor(studentCounts: number[]): number {
  return studentCounts.reduce((a, n) => a + Math.max(0, n), 0);
}

// Idempotency -----------------------------------------------------------------------------------------

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

/** A stable fingerprint of a request body: the same body in any key order gives the same hash. */
export function requestFingerprint(body: unknown): string {
  return createHash('sha256').update(canonical(body)).digest('hex');
}

export type IdempotencyDecision = 'new' | 'replay' | 'mismatch';

/** Same key and same body: replay the stored answer. Same key, different body: refuse. Expired keys count as new. */
export function idempotencyDecision(
  stored: { requestHash: string; expiresAt: Date } | null,
  fingerprint: string,
  now: Date,
): IdempotencyDecision {
  if (!stored || stored.expiresAt <= now) return 'new';
  return stored.requestHash === fingerprint ? 'replay' : 'mismatch';
}

export function isValidIdempotencyKey(key: unknown): key is string {
  return typeof key === 'string' && /^[A-Za-z0-9_.:-]{8,120}$/.test(key);
}

// Provider webhooks -----------------------------------------------------------------------------------

/**
 * Stripe-style signature: header `t=<unix seconds>,v1=<hex hmac>` where the HMAC-SHA256 is over
 * `<t>.<raw body>` with the endpoint secret. Refuses stale timestamps and compares in constant time.
 */
export function verifyProviderSignature(
  header: string | undefined,
  rawBody: string,
  secret: string,
  now: Date,
  toleranceSeconds = WEBHOOK_TOLERANCE_SECONDS,
): boolean {
  if (!header || !secret) return false;
  const parts = Object.fromEntries(
    header.split(',').map((kv) => kv.trim().split('=') as [string, string]),
  );
  const t = Number(parts.t);
  const sig = parts.v1;
  if (!Number.isFinite(t) || !sig) return false;
  if (Math.abs(now.getTime() / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret)
    .update(`${t}.${rawBody}`)
    .digest('hex');
  if (expected.length !== sig.length) return false;
  return timingSafeEqual(
    Buffer.from(expected, 'utf8'),
    Buffer.from(sig, 'utf8'),
  );
}

export function signProviderPayload(
  rawBody: string,
  secret: string,
  at: Date,
): string {
  const t = Math.floor(at.getTime() / 1000);
  return `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex')}`;
}

// Usage -----------------------------------------------------------------------------------------------

export interface UsageRow {
  day: string;
  apiRequests: number;
  aiCalls: number;
  activeUsers: number;
  activeStudents: number;
  storageMb: number;
}

/** Totals over a range: counts add up; people, students and storage are the peak day. */
export function rollupUsage(rows: UsageRow[]): {
  apiRequests: number;
  aiCalls: number;
  peakActiveUsers: number;
  peakActiveStudents: number;
  storageMb: number;
  days: number;
} {
  return {
    apiRequests: rows.reduce((a, r) => a + r.apiRequests, 0),
    aiCalls: rows.reduce((a, r) => a + r.aiCalls, 0),
    peakActiveUsers: rows.reduce((a, r) => Math.max(a, r.activeUsers), 0),
    peakActiveStudents: rows.reduce((a, r) => Math.max(a, r.activeStudents), 0),
    storageMb: rows.length ? rows[rows.length - 1].storageMb : 0,
    days: new Set(rows.map((r) => r.day)).size,
  };
}

/** Requests to the AI tutor, assistant and content routes count as AI calls as well as requests. */
export function isAiRoute(path: string): boolean {
  return /\/(ai|tutor|assistant|summaries)(\/|$)/.test(path);
}

export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function centsToDollars(cents: number): string {
  return `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
