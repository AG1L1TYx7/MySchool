'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { PillGroup, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, download, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dollars, INVOICE_LABELS, invoiceClass, SUBSCRIPTION_LABELS, type BillingOverview, type Invoice, type Plan, type SubscriptionView, type UsageReport } from '@/lib/billing';
import type { Tenant } from '@/lib/district';

type Tab = 'subscription' | 'invoices' | 'usage' | 'districts' | 'plans';
const TAB_LABELS: Record<Tab, string> = { subscription: 'Subscription', invoices: 'Invoices', usage: 'Usage', districts: 'All districts', plans: 'Plans' };

/** Billing (docs/02 section 32): a district's plan, invoices and usage; the platform administrator sees every district and the plans. */
export default function BillingPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <Billing />
    </Suspense>
  );
}

function Billing() {
  const { can, user } = useAuth();
  const params = useSearchParams();
  const raw = params.get('tab');
  const manage = can('billing.manage');
  const tabs: Tab[] = manage ? ['districts', 'subscription', 'invoices', 'usage', 'plans'] : ['subscription', 'invoices', 'usage'];
  const [tab, setTabState] = useState<Tab>((tabs as string[]).includes(raw ?? '') ? (raw as Tab) : tabs[0]);
  const [tenantId, setTenantId] = useState(params.get('tenant') ?? '');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, '', `/billing?tab=${t}${tenantId ? `&tenant=${tenantId}` : ''}`);
  };
  useEffect(() => {
    if (!manage) return;
    api<{ data: Tenant[] }>('/tenants?pageSize=100')
      .then((r) => {
        setTenants(r.data);
        if (!tenantId && r.data[0]) setTenantId(r.data[0].id);
      })
      .catch(() => setTenants([]));
  }, [manage, tenantId]);
  if (!can('billing.view')) return <NotForYou what="billing" back="/dashboard" />;
  const q = manage && tenantId ? `tenantId=${tenantId}` : '';
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Billing</h1>
        <p className="mt-1 text-sm text-slate-600">{manage ? 'Every district, its plan and invoices, and the usage the platform meters. Changes are written to the audit log.' : 'Your district plan, invoices and metered usage. Questions go to the platform administrator.'}</p>
      </div>
      {manage && tab !== 'districts' && tab !== 'plans' && (
        <Select label="District" id="billing-tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
          {tenants.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      )}
      <PillGroup name="billing-tab" options={tabs} value={tab} onChange={setTab} labels={(v) => TAB_LABELS[v]} />
      {tab === 'districts' && <DistrictsView onPick={(id) => { setTenantId(id); setTab('subscription'); }} />}
      {tab === 'subscription' && (manage ? !!tenantId : !!user) && <SubscriptionView key={q} q={q} manage={manage} />}
      {tab === 'invoices' && <InvoicesView key={q} q={q} manage={manage} />}
      {tab === 'usage' && <UsageView key={q} q={q} />}
      {tab === 'plans' && <PlansView manage={manage} />}
    </div>
  );
}

function DistrictsView({ onPick }: { onPick: (id: string) => void }) {
  const [data, setData] = useState<BillingOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<BillingOverview>('/billing/overview').then(setData).catch((e) => setError(errorMessage(e)));
  }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <SkeletonRows rows={4} />;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Districts" value={String(data.tenants)} />
        <Stat label="Monthly recurring" value={dollars(data.mrrCents)} />
        <Stat label="Open invoices" value={dollars(data.openInvoiceCents)} />
        <Stat label="Overdue" value={dollars(data.overdueCents)} tone={data.overdueCents > 0 ? 'text-red-700' : undefined} />
      </div>
      <Card title="Districts and plans">
        {data.subscriptions.length === 0 ? (
          <p className="text-sm text-slate-600">No district has a subscription yet. Pick a district above and start one.</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Districts and plans table">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1 pr-3">District</th>
                  <th className="py-1 pr-3">Plan</th>
                  <th className="py-1 pr-3">Students</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3">Per month</th>
                  <th className="py-1 pr-3">Period ends</th>
                </tr>
              </thead>
              <tbody>
                {data.subscriptions.map((s) => (
                  <tr key={s.tenant.id} className="border-t border-slate-100">
                    <td className="py-1 pr-3">
                      <button type="button" className="text-brand-700 hover:underline" onClick={() => onPick(s.tenant.id)}>
                        {s.tenant.name}
                      </button>
                    </td>
                    <td className="py-1 pr-3">{s.planName}</td>
                    <td className="py-1 pr-3">{s.seats}</td>
                    <td className="py-1 pr-3">{SUBSCRIPTION_LABELS[s.status as keyof typeof SUBSCRIPTION_LABELS] ?? s.status}</td>
                    <td className="py-1 pr-3">{dollars(s.monthlyCents)}</td>
                    <td className="py-1 pr-3">{s.currentPeriodEnd.slice(0, 10)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-xl font-semibold ${tone ?? ''}`}>{value}</p>
    </div>
  );
}

function SubscriptionView({ q, manage }: { q: string; manage: boolean }) {
  const [view, setView] = useState<SubscriptionView | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [form, setForm] = useState({ planCode: '', billingEmail: '', billingName: '', trialDays: '', taxRatePercent: '' });
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    api<SubscriptionView>(`/billing/subscription${q ? `?${q}` : ''}`)
      .then((v) => {
        setView(v);
        setForm({ planCode: v.subscription?.plan.code ?? 'district', billingEmail: v.subscription?.billingEmail ?? '', billingName: v.subscription?.billingName ?? '', trialDays: '', taxRatePercent: v.subscription ? String(v.subscription.taxRatePercent) : '' });
      })
      .catch((e) => setError(errorMessage(e)));
    api<Plan[]>('/billing/plans').then(setPlans).catch(() => setPlans([]));
  }, [q]);
  useEffect(load, [load]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    setError(null);
    setNote(null);
    try {
      await api('/billing/subscription', {
        method: 'PUT',
        headers: { 'Idempotency-Key': `web-${view?.tenant.id}-${Date.now()}` },
        body: { ...(view ? { tenantId: view.tenant.id } : {}), planCode: form.planCode, billingEmail: form.billingEmail || undefined, billingName: form.billingName || undefined, trialDays: form.trialDays ? Number(form.trialDays) : undefined, ...(manage && form.taxRatePercent !== '' ? { taxRatePercent: Number(form.taxRatePercent) } : {}) },
      });
      setNote('Saved.');
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const cancel = async () => {
    setBusy('cancel');
    setError(null);
    try {
      await api(`/billing/subscription/cancel${q ? `?${q}` : ''}`, { method: 'POST' });
      setNote('Canceled. Invoices already issued stay due.');
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  if (error && !view) return <Alert>{error}</Alert>;
  if (!view) return <SkeletonRows rows={4} />;
  const s = view.subscription;
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      <Card title={`${view.tenant.name}: ${s ? s.plan.name : 'no plan yet'}`} description={s ? `${SUBSCRIPTION_LABELS[s.status]} · period ${s.currentPeriodStart.slice(0, 10)} to ${s.currentPeriodEnd.slice(0, 10)}${s.trialEndsAt ? ` · trial until ${s.trialEndsAt.slice(0, 10)}` : ''}` : 'Students are counted from the district\'s active enrolments; the estimate is what a month costs on the chosen plan.'}>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-xs text-slate-500">Students billed</dt>
            <dd className="font-medium">{s ? s.seats : '–'}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Active students now</dt>
            <dd className="font-medium">{view.seatsNow}</dd>
          </div>
          <div>
            <dt className="text-xs text-slate-500">Per month</dt>
            <dd className="font-medium">{view.estimate ? view.estimate.monthly : '–'}</dd>
          </div>
          {s && (s.taxRatePercent > 0 || s.pendingAdjustmentCents !== 0) && (
            <div>
              <dt className="text-xs text-slate-500">On the next invoice</dt>
              <dd className="font-medium">
                {s.taxRatePercent > 0 ? `${s.taxRatePercent}% sales tax` : ''}
                {s.taxRatePercent > 0 && s.pendingAdjustmentCents !== 0 ? ' · ' : ''}
                {s.pendingAdjustmentCents > 0 ? `${dollars(s.pendingAdjustmentCents)} proration` : s.pendingAdjustmentCents < 0 ? `${dollars(-s.pendingAdjustmentCents)} credit` : ''}
              </dd>
            </div>
          )}
          {s?.portalAvailable && (
            <div>
              <dt className="text-xs text-slate-500">Card on file</dt>
              <dd>
                <Button variant="secondary" onClick={() => void api<{ url: string }>(`/billing/portal${view.tenant ? `?tenantId=${view.tenant.id}` : ''}`, { method: 'POST', body: {} }).then((r) => window.location.assign(r.url)).catch((e) => setError(errorMessage(e)))}>
                  Manage payment methods and receipts
                </Button>
              </dd>
            </div>
          )}
          {s?.billingEmail && (
            <div>
              <dt className="text-xs text-slate-500">Billing contact</dt>
              <dd className="font-medium">{s.billingName ? `${s.billingName} · ` : ''}{s.billingEmail}</dd>
            </div>
          )}
        </dl>
      </Card>
      {manage && (
        <Card title={s ? 'Change the plan' : 'Start a subscription'} description="Each save sends a fresh Idempotency-Key, so a retried request never creates a second subscription.">
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <Select label="Plan" id="sub-plan" value={form.planCode} onChange={(e) => setForm({ ...form, planCode: e.target.value })}>
              {plans.map((p) => (
                <option key={p.code} value={p.code}>
                  {p.name} · {p.pricePerStudentCents ? `${dollars(p.pricePerStudentCents)} per student, at least ${dollars(p.minimumCents)}` : `free up to ${p.includedStudents} students`}
                </option>
              ))}
            </Select>
            <Input label="Trial days (optional)" id="sub-trial" type="number" min={0} max={365} value={form.trialDays} onChange={(e) => setForm({ ...form, trialDays: e.target.value })} />
            <Input label="Sales tax rate (%)" id="sub-tax" type="number" min={0} max={30} step={0.01} value={form.taxRatePercent} onChange={(e) => setForm({ ...form, taxRatePercent: e.target.value })} />
            <Input label="Billing contact name" id="sub-name" value={form.billingName} onChange={(e) => setForm({ ...form, billingName: e.target.value })} />
            <Input label="Billing email" id="sub-email" type="email" value={form.billingEmail} onChange={(e) => setForm({ ...form, billingEmail: e.target.value })} />
            <div className="flex flex-wrap justify-between gap-2 sm:col-span-2">
              {s && s.status !== 'canceled' ? (
                <Button type="button" variant="danger" loading={busy === 'cancel'} onClick={() => void cancel()}>
                  Cancel subscription
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" loading={busy === 'save'}>
                {s ? 'Save' : 'Start subscription'}
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}

function InvoicesView({ q, manage }: { q: string; manage: boolean }) {
  const [rows, setRows] = useState<Invoice[] | null>(null);
  const [open, setOpen] = useState<Invoice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [reference, setReference] = useState('');
  const [cardPayments, setCardPayments] = useState(false);
  const load = useCallback(() => {
    api<Invoice[]>(`/billing/invoices${q ? `?${q}` : ''}`).then(setRows).catch((e) => setError(errorMessage(e)));
    api<SubscriptionView>(`/billing/subscription${q ? `?${q}` : ''}`)
      .then((v) => setCardPayments(!!v.subscription?.cardPayments))
      .catch(() => setCardPayments(false));
  }, [q]);
  const payByCard = async (id: string) => {
    setBusy(`card-${id}`);
    setError(null);
    try {
      const r = await api<{ url: string }>(`/billing/invoices/${id}/checkout`, { method: 'POST', body: {} });
      window.location.assign(r.url);
    } catch (e) {
      setError(errorMessage(e));
      setBusy('');
    }
  };
  useEffect(load, [load]);
  const act = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      await fn();
      setNote(done);
      setOpen(null);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const tenantId = q.replace('tenantId=', '');
  if (error && !rows) return <Alert>{error}</Alert>;
  if (!rows) return <SkeletonRows rows={4} />;
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      {manage && (
        <div className="flex justify-end">
          <Button loading={busy === 'issue'} onClick={() => void act('issue', () => api('/billing/invoices', { method: 'POST', headers: { 'Idempotency-Key': `web-inv-${tenantId}-${Date.now()}` }, body: tenantId ? { tenantId } : {} }), 'Invoice issued for the current period.')}>
            Issue invoice for this period
          </Button>
        </div>
      )}
      <Card title={`Invoices (${rows.length})`}>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-600">No invoices yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {rows.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setOpen(open?.id === i.id ? null : i)}>
                    {i.number}
                  </button>
                  <span className="ml-2 text-slate-500">
                    {manage ? `${i.tenant.name} · ` : ''}
                    {i.periodStart.slice(0, 10)} to {i.periodEnd.slice(0, 10)} · due {i.dueAt.slice(0, 10)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs ${invoiceClass(i.status)}`}>{INVOICE_LABELS[i.status]}</span>
                  <span className="font-medium">{i.total}</span>
                  <Button variant="ghost" onClick={() => void download(`/billing/invoices/${i.id}/pdf`, `${i.number}.pdf`)}>
                    PDF
                  </Button>
                  {manage && i.status === 'paid' && i.providerRef && (
                    <Button variant="danger" loading={busy === `refund-${i.id}`} onClick={() => void act(`refund-${i.id}`, () => api(`/billing/invoices/${i.id}/refund`, { method: 'POST', body: {} }), `Invoice ${i.number} refunded through the provider.`)}>
                      Refund
                    </Button>
                  )}
                  {cardPayments && (i.status === 'open' || i.status === 'overdue') && i.totalCents > 0 && (
                    <Button loading={busy === `card-${i.id}`} onClick={() => void payByCard(i.id)}>
                      Pay by card
                    </Button>
                  )}
                </div>
                {open?.id === i.id && (
                  <div className="w-full rounded-md bg-slate-50 p-3">
                    <ul className="space-y-1 text-sm">
                      {i.lines.map((l, n) => (
                        <li key={n} className="flex justify-between gap-2">
                          <span className="min-w-0">{l.description}</span>
                          <span className="whitespace-nowrap">{l.quantity} × {dollars(l.unitCents)} = {dollars(l.amountCents)}</span>
                        </li>
                      ))}
                    </ul>
                    {i.note && <p className="mt-2 text-xs text-slate-600">{i.note}</p>}
                    {i.providerRef && <p className="mt-1 text-xs text-slate-600">Payment reference: {i.providerRef}</p>}
                    {manage && (i.status === 'open' || i.status === 'overdue') && (
                      <div className="mt-3 flex flex-wrap items-end gap-2">
                        <Input label="Payment reference" id={`ref-${i.id}`} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Check number or transfer id" />
                        <Button variant="secondary" loading={busy === `pay-${i.id}`} onClick={() => void act(`pay-${i.id}`, () => api(`/billing/invoices/${i.id}/pay`, { method: 'POST', body: { reference: reference || undefined } }), `${i.number} recorded as paid.`)}>
                          Record payment
                        </Button>
                        <Button variant="danger" loading={busy === `void-${i.id}`} onClick={() => void act(`void-${i.id}`, () => api(`/billing/invoices/${i.id}/void`, { method: 'POST', body: {} }), `${i.number} voided.`)}>
                          Void
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function UsageView({ q }: { q: string }) {
  const [data, setData] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<UsageReport>(`/billing/usage${q ? `?${q}` : ''}`).then(setData).catch((e) => setError(errorMessage(e)));
  }, [q]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <SkeletonRows rows={4} />;
  const t = data.totals;
  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        {data.from} to {data.to}. Requests and AI calls add up over the days; people, students and storage are the highest day.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat label="Requests" value={t.apiRequests.toLocaleString()} />
        <Stat label="AI calls" value={t.aiCalls.toLocaleString()} />
        <Stat label="People active (peak day)" value={String(t.peakActiveUsers)} />
        <Stat label="Active students" value={String(t.peakActiveStudents)} />
        <Stat label="Storage" value={`${t.storageMb} MB`} />
      </div>
      <Card title="By school">
        {data.schools.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing metered in this range yet.</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Usage by school table">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1 pr-3">School</th>
                  <th className="py-1 pr-3">Requests</th>
                  <th className="py-1 pr-3">AI calls</th>
                  <th className="py-1 pr-3">People (peak day)</th>
                  <th className="py-1 pr-3">Active students</th>
                  <th className="py-1 pr-3">Storage</th>
                </tr>
              </thead>
              <tbody>
                {data.schools.map((s) => (
                  <tr key={s.organizationId} className="border-t border-slate-100">
                    <td className="py-1 pr-3">{s.name}</td>
                    <td className="py-1 pr-3">{s.apiRequests.toLocaleString()}</td>
                    <td className="py-1 pr-3">{s.aiCalls.toLocaleString()}</td>
                    <td className="py-1 pr-3">{s.activeUsers}</td>
                    <td className="py-1 pr-3">{s.activeStudents}</td>
                    <td className="py-1 pr-3">{s.storageMb} MB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title="By day">
        {data.days.length === 0 ? (
          <p className="text-sm text-slate-600">No days in this range.</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Usage by day table">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1 pr-3">Day</th>
                  <th className="py-1 pr-3">Requests</th>
                  <th className="py-1 pr-3">AI calls</th>
                  <th className="py-1 pr-3">People</th>
                  <th className="py-1 pr-3">Active students</th>
                  <th className="py-1 pr-3">Storage</th>
                </tr>
              </thead>
              <tbody>
                {data.days.map((d) => (
                  <tr key={d.day} className="border-t border-slate-100">
                    <td className="py-1 pr-3">{d.day}</td>
                    <td className="py-1 pr-3">{d.apiRequests.toLocaleString()}</td>
                    <td className="py-1 pr-3">{d.aiCalls.toLocaleString()}</td>
                    <td className="py-1 pr-3">{d.activeUsers}</td>
                    <td className="py-1 pr-3">{d.activeStudents}</td>
                    <td className="py-1 pr-3">{d.storageMb} MB</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function PlansView({ manage }: { manage: boolean }) {
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ code: string; name: string; description: string; pricePerStudentCents: string; minimumCents: string; includedStudents: string; features: string; isActive: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => {
    api<Plan[]>('/billing/plans').then(setPlans).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    setBusy(true);
    setError(null);
    try {
      await api('/billing/plans', { method: 'PUT', body: { code: edit.code, name: edit.name, description: edit.description || undefined, pricePerStudentCents: Number(edit.pricePerStudentCents), minimumCents: Number(edit.minimumCents), includedStudents: Number(edit.includedStudents || 0), features: edit.features.split('\n').map((f) => f.trim()).filter(Boolean), isActive: edit.isActive } });
      setNote(`Plan ${edit.name} saved.`);
      setEdit(null);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (error && !plans) return <Alert>{error}</Alert>;
  if (!plans) return <SkeletonRows rows={3} />;
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      <div className="grid gap-3 sm:grid-cols-3">
        {plans.map((p) => (
          <div key={p.code} className={`rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200 ${p.isActive ? '' : 'opacity-60'}`}>
            <h2 className="font-medium">{p.name}</h2>
            <p className="mt-1 text-sm text-slate-600">{p.description}</p>
            <p className="mt-2 text-sm">{p.pricePerStudentCents ? `${dollars(p.pricePerStudentCents)} per student per month, at least ${dollars(p.minimumCents)}` : `Free for up to ${p.includedStudents} students`}</p>
            <ul className="mt-2 list-inside list-disc text-xs text-slate-600">
              {p.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            {manage && (
              <Button variant="ghost" onClick={() => setEdit({ code: p.code, name: p.name, description: p.description ?? '', pricePerStudentCents: String(p.pricePerStudentCents), minimumCents: String(p.minimumCents), includedStudents: String(p.includedStudents), features: p.features.join('\n'), isActive: p.isActive })}>
                Edit
              </Button>
            )}
          </div>
        ))}
      </div>
      {manage && edit && (
        <Card title={`Edit plan ${edit.code}`}>
          <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
            <Input label="Name" id="plan-name" required value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
            <Input label="Description" id="plan-description" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            <Input label="Cents per student per month" id="plan-price" type="number" min={0} value={edit.pricePerStudentCents} onChange={(e) => setEdit({ ...edit, pricePerStudentCents: e.target.value })} />
            <Input label="Minimum cents per month" id="plan-min" type="number" min={0} value={edit.minimumCents} onChange={(e) => setEdit({ ...edit, minimumCents: e.target.value })} />
            <Input label="Students included" id="plan-included" type="number" min={0} value={edit.includedStudents} onChange={(e) => setEdit({ ...edit, includedStudents: e.target.value })} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />
              Offered to new districts
            </label>
            <div className="sm:col-span-2">
              <label htmlFor="plan-features" className="block text-sm font-medium text-slate-700">
                Features, one per line
              </label>
              <textarea id="plan-features" rows={4} value={edit.features} onChange={(e) => setEdit({ ...edit, features: e.target.value })} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm" />
            </div>
            <div className="flex justify-end gap-2 sm:col-span-2">
              <Button type="button" variant="ghost" onClick={() => setEdit(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={busy}>
                Save plan
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
