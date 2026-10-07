'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { MotionItem, MotionList, PillGroup, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { RETENTION_KEYS, RETENTION_LABELS, severityClass, statusClass, type DataMap, type DeletionPlan, type DeletionRequest, type Incident, type RetentionKey } from '@/lib/compliance';

type Tab = 'data-map' | 'retention' | 'deletion' | 'incidents';
const TABS: readonly Tab[] = ['data-map', 'retention', 'deletion', 'incidents'];
const TAB_LABELS: Record<Tab, string> = { 'data-map': 'Data map', retention: 'Retention', deletion: 'Deletion requests', incidents: 'Incidents' };

/** Compliance (docs/13 section 10): what we hold and why, how long we keep it, erasure on request, and incidents. Administrators, English. */
export default function CompliancePage() {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <Compliance />
    </Suspense>
  );
}

function Compliance() {
  const { user, can } = useAuth();
  const params = useSearchParams();
  const raw = params.get('tab');
  // The tab lives in state and is only mirrored to the URL: re-rendering from the URL would remount the forms and lose typed input.
  const [tab, setTabState] = useState<Tab>((TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'data-map');
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, '', t === 'data-map' ? '/compliance' : `/compliance?tab=${t}`);
  };
  if (!can('compliance.view')) return <NotForYou what="compliance" back="/dashboard" />;
  const orgId = user?.organizationId ?? '';
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Compliance</h1>
        <p className="mt-1 text-sm text-slate-500">What the school holds about people and why, how long it is kept, erasure on request, and the record of any security incident. FERPA, COPPA and state student-privacy law, in one place.</p>
      </div>
      <PillGroup name="compliance-tab" options={TABS} value={tab} onChange={setTab} labels={(v) => TAB_LABELS[v]} />
      {tab === 'data-map' && <DataMapView orgId={orgId} />}
      {tab === 'retention' && <RetentionView orgId={orgId} canManage={can('compliance.manage')} />}
      {tab === 'deletion' && <DeletionView orgId={orgId} canManage={can('compliance.manage')} />}
      {tab === 'incidents' && <IncidentsView canManage={can('compliance.manage')} />}
    </div>
  );
}

function DataMapView({ orgId }: { orgId: string }) {
  const [map, setMap] = useState<DataMap | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!orgId) return;
    api<DataMap>(`/organizations/${orgId}/compliance/data-map`)
      .then(setMap)
      .catch((e) => setError(errorMessage(e)));
  }, [orgId]);
  if (error) return <Alert>{error}</Alert>;
  if (!map) return <SkeletonRows rows={6} />;
  return (
    <Card title="Data map" description={`Every table that holds personal data, whose it is, why we keep it, and for how long. Live counts as of ${new Date(map.generatedAt).toLocaleString()}. Published for families in docs/17.`}>
      <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Data map table">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-1 pr-3">Table</th>
              <th className="py-1 pr-3">Holds</th>
              <th className="py-1 pr-3">Whose</th>
              <th className="py-1 pr-3">Purpose</th>
              <th className="py-1 pr-3">Basis</th>
              <th className="py-1 pr-3">Kept</th>
              <th className="py-1 text-right">Rows</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {map.entries.map((e) => (
              <tr key={e.table} className="align-top">
                <td className="py-1.5 pr-3 font-medium text-slate-900">{e.table}</td>
                <td className="py-1.5 pr-3 text-slate-700">{e.holds}</td>
                <td className="py-1.5 pr-3 text-slate-700">{e.subject}</td>
                <td className="py-1.5 pr-3 text-slate-700">{e.purpose}</td>
                <td className="py-1.5 pr-3 text-slate-600">{e.basis}</td>
                <td className="py-1.5 pr-3 text-slate-700">{e.retentionDays === null ? 'With the record' : e.retentionDays === 0 ? 'Until requested' : `${e.retentionDays} days`}</td>
                <td className="py-1.5 text-right tabular-nums text-slate-900">{e.rows}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-slate-600">Nothing here is sold, used for advertising, or used to train models. The AI model runs inside the school&apos;s own boundary (docs/13).</p>
    </Card>
  );
}

function RetentionView({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const [form, setForm] = useState<Record<RetentionKey, string> | null>(null);
  const [bounds, setBounds] = useState<DataMap['bounds'] | null>(null);
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});
  const load = useCallback(async () => {
    try {
      const r = await api<{ retention: Record<RetentionKey, number>; bounds: DataMap['bounds'] }>(`/organizations/${orgId}/compliance/retention`);
      setForm(Object.fromEntries(RETENTION_KEYS.map((k) => [k, String(r.retention[k])])) as Record<RetentionKey, string>);
      setBounds(r.bounds);
    } catch (e) {
      setState({ error: errorMessage(e) });
    }
  }, [orgId]);
  useEffect(() => {
    if (orgId) void load();
  }, [orgId, load]);
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setState({ busy: true });
    try {
      await api(`/organizations/${orgId}/compliance/retention`, { method: 'PUT', body: Object.fromEntries(RETENTION_KEYS.map((k) => [k, Number(form[k])])) });
      setState({ ok: 'Retention saved. The nightly job applies it at 03:40.' });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function runNow() {
    setState({ busy: true });
    try {
      const r = await api<{ removed: Record<string, number> }>(`/organizations/${orgId}/compliance/retention/run`, { method: 'POST' });
      const parts = Object.entries(r.removed).map(([k, v]) => `${RETENTION_LABELS[k as RetentionKey] ?? k}: ${v}`);
      setState({ ok: parts.length ? `Removed now: ${parts.join('; ')}.` : 'Nothing was old enough to remove.' });
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  if (!form || !bounds) return state.error ? <Alert>{state.error}</Alert> : <SkeletonRows rows={4} />;
  return (
    <Card title="Retention" description="How long each kind of record is kept before the nightly job removes it. Education records (grades, attendance, report cards) stay with the student until a deletion request.">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      <form onSubmit={(e) => void save(e)} className="grid gap-3 md:grid-cols-2">
        {RETENTION_KEYS.map((k) => (
          <Input key={k} label={`${RETENTION_LABELS[k]} (${bounds[k].min} to ${bounds[k].max} days)`} type="number" min={bounds[k].min} max={bounds[k].max} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} disabled={!canManage} />
        ))}
        {canManage && (
          <div className="flex items-end gap-2">
            <Button type="submit" loading={state.busy}>
              Save
            </Button>
            <Button type="button" variant="secondary" loading={state.busy} onClick={() => void runNow()}>
              Apply now
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}

function DeletionView({ orgId, canManage }: { orgId: string; canManage: boolean }) {
  const [rows, setRows] = useState<DeletionRequest[] | null>(null);
  const [plan, setPlan] = useState<DeletionPlan | null>(null);
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});
  const load = useCallback(async () => {
    try {
      const r = await api<{ data: DeletionRequest[]; plan: DeletionPlan }>(`/organizations/${orgId}/compliance/deletion-requests`);
      setRows(r.data);
      setPlan(r.plan);
    } catch (e) {
      setState({ error: errorMessage(e) });
    }
  }, [orgId]);
  useEffect(() => {
    if (orgId) void load();
  }, [orgId, load]);
  async function act(path: string, body?: unknown, ok?: string) {
    setState({ busy: true });
    try {
      await api(path, { method: 'POST', body });
      setState({ ok });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  return (
    <div className="space-y-6">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      <Card title="Deletion requests" description={plan ? `A family or an administrator asks; an administrator decides; approved requests are carried out after ${plan.graceDays} days, or now. A legal hold on the student blocks erasure.` : undefined}>
        {rows === null ? (
          <SkeletonRows rows={3} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No requests.</p>
        ) : (
          <MotionList className="divide-y divide-slate-100">
            {rows.map((r) => (
              <MotionItem key={r.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">
                      {r.studentName} <span className="font-normal text-slate-500">· {r.studentNumber}</span>
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${statusClass(r.status)}`}>{r.status}</span>
                    </p>
                    <p className="text-xs text-slate-600">
                      Requested {new Date(r.createdAt).toLocaleDateString()}
                      {r.reason ? ` · ${r.reason}` : ''}
                      {r.scheduledFor && r.status === 'approved' ? ` · erases on ${new Date(r.scheduledFor).toLocaleDateString()}` : ''}
                      {r.completedAt ? ` · erased ${new Date(r.completedAt).toLocaleDateString()}` : ''}
                    </p>
                  </div>
                  {canManage && r.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button loading={state.busy} onClick={() => void act(`/deletion-requests/${r.id}/decide`, { decision: 'approve' }, 'Approved. The erasure is scheduled after the grace period.')}>
                        Approve
                      </Button>
                      <Button variant="secondary" loading={state.busy} onClick={() => void act(`/deletion-requests/${r.id}/decide`, { decision: 'reject', note: 'Declined by the school.' }, 'Declined.')}>
                        Decline
                      </Button>
                    </div>
                  )}
                  {canManage && r.status === 'approved' && (
                    <Button variant="danger" loading={state.busy} onClick={() => void act(`/deletion-requests/${r.id}/execute`, undefined, 'Erased. The summary is on the request.')}>
                      Erase now
                    </Button>
                  )}
                </div>
                {r.status === 'completed' && typeof r.summary === 'object' && r.summary !== null && <p className="mt-1 text-xs text-slate-600">Removed: {Object.entries(r.summary as Record<string, number>).map(([k, v]) => `${k} ${v}`).join(', ')}</p>}
              </MotionItem>
            ))}
          </MotionList>
        )}
      </Card>
      {plan && (
        <Card title="What erasure removes">
          <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
            {plan.removes.map((p) => (
              <li key={p.key}>{p.label}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function IncidentsView({ canManage }: { canManage: boolean }) {
  const [rows, setRows] = useState<Incident[] | null>(null);
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});
  const [form, setForm] = useState({ title: '', severity: 'medium', summary: '', affectedCount: '0', dataCategories: '' });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    try {
      setRows((await api<{ data: Incident[] }>('/compliance/incidents')).data);
    } catch (e) {
      setState({ error: errorMessage(e) });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function create(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api('/compliance/incidents', { method: 'POST', body: { title: form.title, severity: form.severity, summary: form.summary, affectedCount: Number(form.affectedCount) || 0, dataCategories: form.dataCategories || undefined } });
      setForm({ title: '', severity: 'medium', summary: '', affectedCount: '0', dataCategories: '' });
      setState({ ok: 'Incident opened. The clock is running; follow the runbook in docs/18.' });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function update(i: Incident, body: Record<string, unknown>, ok: string) {
    setState({ busy: true });
    try {
      await api(`/compliance/incidents/${i.id}`, { method: 'PATCH', body });
      setNotes((n) => ({ ...n, [i.id]: '' }));
      setState({ ok });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function notify(i: Incident) {
    setState({ busy: true });
    try {
      const r = await api<{ notified: number }>(`/compliance/incidents/${i.id}/notify`, { method: 'POST' });
      setState({ ok: `Notified ${r.notified} administrators by notification and email.` });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  return (
    <div className="space-y-6">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      {canManage && (
        <Card title="Open an incident" description="Anything that may have exposed personal data. The breach runbook (docs/18) sets the clock: the district within 24 hours for high and critical, families and the state within 72 hours of confirmation.">
          <form onSubmit={(e) => void create(e)} className="grid gap-3 md:grid-cols-2">
            <Input label="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} required maxLength={200} />
            <Select label="Severity" value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value })}>
              {['low', 'medium', 'high', 'critical'].map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
            <div className="md:col-span-2">
              <Input label="What happened" value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} required maxLength={10000} />
            </div>
            <Input label="People affected (estimate)" type="number" min={0} value={form.affectedCount} onChange={(e) => setForm({ ...form, affectedCount: e.target.value })} />
            <Input label="Data categories (for the notice)" value={form.dataCategories} onChange={(e) => setForm({ ...form, dataCategories: e.target.value })} maxLength={500} />
            <div>
              <Button type="submit" loading={state.busy}>
                Open incident
              </Button>
            </div>
          </form>
        </Card>
      )}
      <Card title="Incidents">
        {rows === null ? (
          <SkeletonRows rows={3} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">No incidents recorded.</p>
        ) : (
          <MotionList className="divide-y divide-slate-100">
            {rows.map((i) => (
              <MotionItem key={i.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium text-slate-900">
                    {i.title}
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${severityClass(i.severity)}`}>{i.severity}</span>
                    <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${statusClass(i.status)}`}>{i.status}</span>
                  </p>
                  <p className="text-xs text-slate-600">
                    Detected {new Date(i.detectedAt).toLocaleString()} · district by {new Date(i.deadlines.districtBy).toLocaleString()} · notify by {new Date(i.deadlines.notifyBy).toLocaleString()}
                  </p>
                </div>
                <p className="mt-1 text-slate-700">{i.summary}</p>
                <p className="text-xs text-slate-600">
                  {i.affectedCount} people · {i.dataCategories ?? 'categories not set'} · reported by {i.reportedBy}
                  {i.notifiedAt ? ` · notified ${new Date(i.notifiedAt).toLocaleString()}` : ''}
                </p>
                <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                  {i.timeline.map((t, idx) => (
                    <li key={idx}>
                      {new Date(t.at).toLocaleString()} · {t.by}: {t.note}
                    </li>
                  ))}
                </ul>
                {canManage && i.status !== 'closed' && (
                  <div className="mt-2 flex flex-wrap items-end gap-2">
                    <Input label="Add to the timeline" value={notes[i.id] ?? ''} onChange={(e) => setNotes({ ...notes, [i.id]: e.target.value })} maxLength={2000} />
                    <Button variant="secondary" loading={state.busy} disabled={!(notes[i.id] ?? '').trim()} onClick={() => void update(i, { note: notes[i.id] }, 'Noted.')}>
                      Add note
                    </Button>
                    {i.status === 'open' && (
                      <Button variant="secondary" loading={state.busy} onClick={() => void update(i, { status: 'contained' }, 'Marked contained.')}>
                        Contained
                      </Button>
                    )}
                    {i.status !== 'notified' && (
                      <Button loading={state.busy} onClick={() => void notify(i)}>
                        Notify administrators
                      </Button>
                    )}
                    <Button variant="secondary" loading={state.busy} onClick={() => void update(i, { status: 'closed' }, 'Closed.')}>
                      Close
                    </Button>
                  </div>
                )}
              </MotionItem>
            ))}
          </MotionList>
        )}
      </Card>
    </div>
  );
}
