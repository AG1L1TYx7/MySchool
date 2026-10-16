/** Billing and operations (docs/02 sections 32 and 35, slice 26): plans, the district subscription, invoices, usage, status and incidents. */

export interface Plan {
  id: string;
  code: string;
  name: string;
  description: string | null;
  pricePerStudentCents: number;
  minimumCents: number;
  includedStudents: number;
  features: string[];
  isActive: boolean;
}

export interface Subscription {
  id: string;
  tenantId: string;
  plan: Plan;
  status: 'trialing' | 'active' | 'past_due' | 'canceled';
  seats: number;
  billingEmail: string | null;
  billingName: string | null;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  trialEndsAt: string | null;
  provider: string;
  taxRatePercent: number;
  pendingAdjustmentCents: number;
  cardPayments: boolean;
  canceledAt: string | null;
}

export interface SubscriptionView {
  tenant: { id: string; name: string; slug: string };
  subscription: Subscription | null;
  seatsNow: number;
  estimate: { seats: number; monthlyCents: number; monthly: string } | null;
}

export interface InvoiceLine {
  description: string;
  quantity: number;
  unitCents: number;
  amountCents: number;
}

export interface Invoice {
  id: string;
  tenant: { id: string; name: string; slug: string };
  number: string;
  status: 'open' | 'paid' | 'void' | 'overdue';
  periodStart: string;
  periodEnd: string;
  lines: InvoiceLine[];
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  total: string;
  currency: string;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  voidedAt: string | null;
  provider: string;
  providerRef: string | null;
  note: string | null;
}

export interface UsageDay {
  day: string;
  apiRequests: number;
  aiCalls: number;
  activeUsers: number;
  activeStudents: number;
  storageMb: number;
}

export interface UsageReport {
  tenantId: string;
  from: string;
  to: string;
  days: UsageDay[];
  totals: { apiRequests: number; aiCalls: number; peakActiveUsers: number; peakActiveStudents: number; storageMb: number; days: number };
  schools: Array<{ organizationId: string; name: string; apiRequests: number; aiCalls: number; activeUsers: number; activeStudents: number; storageMb: number }>;
}

export interface BillingOverview {
  tenants: number;
  subscriptions: Array<{ tenant: { id: string; name: string; slug: string }; planCode: string; planName: string; seats: number; status: string; monthlyCents: number; currentPeriodEnd: string }>;
  byStatus: Record<string, number>;
  mrrCents: number;
  openInvoiceCents: number;
  overdueCents: number;
}

export type ComponentState = 'operational' | 'degraded' | 'down' | 'disabled';
export type OverallState = 'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance';

export interface Incident {
  id: string;
  kind: 'incident' | 'maintenance';
  title: string;
  status: string;
  impact: 'none' | 'minor' | 'major' | 'critical';
  components: string[];
  isPublic: boolean;
  startedAt: string;
  resolvedAt: string | null;
  scheduledFor: string | null;
  scheduledUntil: string | null;
  updates: Array<{ at: string; status: string; message: string }>;
  open: boolean;
}

export interface StatusPage {
  status: OverallState;
  label: string;
  checkedAt: string | null;
  components: Array<{ key: string; name: string; status: ComponentState }>;
  incidents: Incident[];
  maintenance: Incident[];
  uptime: { days: number; percent: number | null; byDay: Array<{ day: string; percent: number | null; checks: number }> };
}

export interface StatusCheck {
  id: string;
  checkedAt: string;
  status: string;
  components: Record<string, ComponentState>;
  latencyMs: number;
}

export const dollars = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export const SUBSCRIPTION_LABELS: Record<Subscription['status'], string> = { trialing: 'Trial', active: 'Active', past_due: 'Past due', canceled: 'Canceled' };
export const INVOICE_LABELS: Record<Invoice['status'], string> = { open: 'Open', paid: 'Paid', void: 'Void', overdue: 'Overdue' };
export const COMPONENT_LABELS: Record<ComponentState, string> = { operational: 'Operational', degraded: 'Slower than usual', down: 'Down', disabled: 'Not in use' };
export const STATUS_TONES: Record<OverallState, string> = {
  operational: 'bg-green-50 text-green-800 ring-green-200',
  degraded: 'bg-amber-50 text-amber-800 ring-amber-200',
  partial_outage: 'bg-orange-50 text-orange-800 ring-orange-200',
  major_outage: 'bg-red-50 text-red-800 ring-red-200',
  maintenance: 'bg-brand-50 text-brand-800 ring-brand-200',
};
export const COMPONENT_TONES: Record<ComponentState, string> = { operational: 'text-green-700', degraded: 'text-amber-700', down: 'text-red-700', disabled: 'text-slate-500' };
export const INCIDENT_STATUS_LABELS: Record<string, string> = { investigating: 'Investigating', identified: 'Cause found', monitoring: 'Fix in place, watching', resolved: 'Resolved', scheduled: 'Scheduled', in_progress: 'In progress', completed: 'Completed' };
export const IMPACT_LABELS: Record<Incident['impact'], string> = { none: 'No impact', minor: 'Minor', major: 'Major', critical: 'Critical' };
export const NEXT_STATUSES: Record<string, string[]> = {
  investigating: ['identified', 'monitoring', 'resolved'],
  identified: ['monitoring', 'resolved', 'investigating'],
  monitoring: ['resolved', 'investigating'],
  resolved: ['monitoring'],
  scheduled: ['in_progress', 'completed'],
  in_progress: ['completed'],
  completed: [],
};

export function invoiceClass(status: Invoice['status']): string {
  switch (status) {
    case 'paid':
      return 'bg-green-50 text-green-700';
    case 'overdue':
      return 'bg-red-50 text-red-700';
    case 'void':
      return 'bg-slate-200 text-slate-700';
    default:
      return 'bg-amber-50 text-amber-800';
  }
}
