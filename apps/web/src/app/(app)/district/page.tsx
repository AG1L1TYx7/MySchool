'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { MotionItem, MotionList, PillGroup, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, download, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { RETENTION_KEYS, RETENTION_LABELS } from '@/lib/compliance';
import { DISTRICT_REPORTS, STATE_EXPORTS, pct, type DistrictOverview, type Tenant, type TenantPolicies } from '@/lib/district';

type Tab = 'overview' | 'reports' | 'policies' | 'state';
const TABS: readonly Tab[] = ['overview', 'reports', 'policies', 'state'];
const TAB_LABELS: Record<Tab, string> = { overview: 'Overview', reports: 'Reports', policies: 'Policies', state: 'State reporting' };

/** District (docs/13 section 9): every school at a glance, cross-school reports, policy switches and state exports. Superintendents, English. */
export default function DistrictPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <District />
    </Suspense>
  );
}

function District() {
  const { can } = useAuth();
  const params = useSearchParams();
  const raw = params.get('tab');
  // The tab lives in state and is only mirrored to the URL: re-rendering from the URL would remount the forms and lose typed input.
  const [tab, setTabState] = useState<Tab>((TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'overview');
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, '', t === 'overview' ? '/district' : `/district?tab=${t}`);
  };
  const platform = can('tenants.manage');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tenantId, setTenantId] = useState('');
  useEffect(() => {
    if (!platform) return;
    api<{ data: Tenant[] }>('/tenants?pageSize=100')
      .then((r) => setTenants(r.data))
      .catch(() => setTenants([]));
  }, [platform]);
  if (!can('district.view')) return <NotForYou what="the district" back="/dashboard" />;
  const q = tenantId ? `?tenantId=${tenantId}` : '';
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">District</h1>
          <p className="mt-1 text-sm text-slate-600">Every school in the district on one page, reports across schools, the switches the district sets for all of them, and the exports the state asks for.</p>
        </div>
        {platform && tenants.length > 0 && (
          <Select label="District" id="district-tenant" value={tenantId} onChange={(e) => setTenantId(e.target.value)}>
            <option value="">Default district</option>
            {tenants.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      <PillGroup name="district-tab" options={TABS} value={tab} onChange={setTab} labels={(v) => TAB_LABELS[v]} />
      {tab === 'overview' && <OverviewView q={q} />}
      {tab === 'reports' && <ReportsView q={q} />}
      {tab === 'policies' && <PoliciesView q={q} canManage={can('district.manage')} />}
      {tab === 'state' && <StateView q={q} canManage={can('district.manage')} />}
    </div>
  );
}

function useOverview(q: string) {
  const [data, setData] = useState<DistrictOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setData(null);
    api<DistrictOverview>(`/district/overview${q}`)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [q]);
  return { data, error };
}

function OverviewView({ q }: { q: string }) {
  const { data, error } = useOverview(q);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <SkeletonRows rows={6} />;
  const t = data.totals;
  const tiles: Array<[string, string | number]> = [
    ['Schools', t.schools],
    ['Students', t.students],
    ['Staff', t.staff],
    ['Attendance, 30 days', pct(t.attendanceRate30)],
    ['Present today', pct(t.presentToday)],
    ['Missing items, 14 days', t.missingItems],
    ['Failing a class', t.failing],
    ['Gradebook complete', pct(t.gradebookCompleteness)],
    ['AI conversations, 7 days', t.aiConversations7],
    ['Open incidents', t.openIncidents],
  ];
  return (
    <div className="space-y-6">
      <MotionList className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {tiles.map(([label, value]) => (
          <MotionItem key={label} className="rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200">
            <p className="text-xs uppercase tracking-wide text-slate-600">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
          </MotionItem>
        ))}
      </MotionList>
      <Card title={data.tenant.name} description={`Each school on one line. Rates are weighted by students. Figures as of ${new Date(data.generatedAt).toLocaleString()}.`}>
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Schools table">
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="py-1 pr-3">School</th>
                <th className="py-1 pr-3 text-right">Students</th>
                <th className="py-1 pr-3 text-right">Staff</th>
                <th className="py-1 pr-3 text-right">Attendance</th>
                <th className="py-1 pr-3 text-right">Today</th>
                <th className="py-1 pr-3 text-right">Missing</th>
                <th className="py-1 pr-3 text-right">Failing</th>
                <th className="py-1 pr-3 text-right">Gradebook</th>
                <th className="py-1 pr-3 text-right">AI, 7 days</th>
                <th className="py-1 pr-3 text-right">Incidents</th>
              </tr>
            </thead>
            <tbody>
              {data.schools.map((s) => (
                <tr key={s.organizationId} className="border-t border-slate-100 tabular-nums">
                  <td className="py-1 pr-3 font-medium">{s.name}</td>
                  <td className="py-1 pr-3 text-right">{s.students}</td>
                  <td className="py-1 pr-3 text-right">{s.staff}</td>
                  <td className="py-1 pr-3 text-right">{pct(s.attendanceRate30)}</td>
                  <td className="py-1 pr-3 text-right">{pct(s.presentToday)}</td>
                  <td className="py-1 pr-3 text-right">{s.missingItems}</td>
                  <td className="py-1 pr-3 text-right">{s.failing}</td>
                  <td className="py-1 pr-3 text-right">{pct(s.gradebookCompleteness)}</td>
                  <td className="py-1 pr-3 text-right">{s.aiConversations7}</td>
                  <td className="py-1 pr-3 text-right">{s.openIncidents}</td>
                </tr>
              ))}
              {data.schools.length === 0 && (
                <tr>
                  <td colSpan={10} className="py-3 text-slate-600">
                    No schools in this district yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function ReportsView({ q }: { q: string }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const get = async (kind: string) => {
    setBusy(kind);
    setError(null);
    try {
      await download(`/district/reports/${kind}.csv${q}`, `district-${kind}.csv`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <Card title="Cross-school reports" description="CSV files that open in any spreadsheet. Each one covers every school in the district.">
      {error && <Alert>{error}</Alert>}
      <ul className="divide-y divide-slate-100">
        {DISTRICT_REPORTS.map((r) => (
          <li key={r.kind} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-medium">{r.label}</p>
              <p className="text-sm text-slate-600">{r.about}</p>
            </div>
            <Button variant="secondary" loading={busy === r.kind} onClick={() => get(r.kind)}>
              Download CSV
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PoliciesView({ q, canManage }: { q: string; canManage: boolean }) {
  const { data: overview, error: overviewError } = useOverview(q);
  const [form, setForm] = useState<TenantPolicies | null>(null);
  const [features, setFeatures] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const tenantId = overview?.tenant.id;
  const load = useCallback(() => {
    if (!tenantId) return;
    api<{ policies: TenantPolicies }>(`/tenants/${tenantId}/policies`)
      .then((r) => {
        setForm(r.policies);
        setFeatures(r.policies.disabledFeatures.join(', '));
      })
      .catch((e) => setError(errorMessage(e)));
  }, [tenantId]);
  useEffect(load, [load]);
  if (overviewError) return <Alert>{overviewError}</Alert>;
  if (!overview || !form) return <SkeletonRows rows={6} />;
  const toggleSchool = (id: string) =>
    setForm({ ...form, aiDisabledSchools: form.aiDisabledSchools.includes(id) ? form.aiDisabledSchools.filter((x) => x !== id) : [...form.aiDisabledSchools, id] });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!tenantId) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const r = await api<{ policies: TenantPolicies }>(`/tenants/${tenantId}/policies`, {
        method: 'PUT',
        body: { ...form, disabledFeatures: features.split(/[,\s]+/).map((f) => f.trim()).filter(Boolean) },
      });
      setForm(r.policies);
      setFeatures(r.policies.disabledFeatures.join(', '));
      setSaved(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="space-y-6">
      {error && <Alert>{error}</Alert>}
      {saved && <Alert kind="success">Policies saved. They apply to every school in the district straight away.</Alert>}
      <Card title="AI" description="Switch the AI tutor, assistant and lesson summaries off for the whole district or for named schools. Families' consent choices still apply where AI is on.">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.aiEnabled} disabled={!canManage} onChange={(e) => setForm({ ...form, aiEnabled: e.target.checked })} />
          AI features are on in this district
        </label>
        <fieldset className="mt-3">
          <legend className="text-sm font-medium">Schools where AI stays off</legend>
          <ul className="mt-1 grid gap-1 sm:grid-cols-2">
            {overview.schools.map((s) => (
              <li key={s.organizationId}>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={form.aiDisabledSchools.includes(s.organizationId)} disabled={!canManage || !form.aiEnabled} onChange={() => toggleSchool(s.organizationId)} />
                  {s.name}
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      </Card>
      <Card title="Messaging and features" description="A school may allow student-to-student messaging only if the district allows it. Feature codes listed here are switched off for everyone in the district (the platform administrator excepted).">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.studentMessagingAllowed} disabled={!canManage} onChange={(e) => setForm({ ...form, studentMessagingAllowed: e.target.checked })} />
          Schools may turn on student-to-student messaging
        </label>
        <div className="mt-3">
          <Input label="Features switched off district-wide" id="district-features" value={features} disabled={!canManage} onChange={(e) => setFeatures(e.target.value)} hint="Feature codes separated by commas, for example motivation.view, h5p.view. Codes are listed under Users, Features." />
        </div>
      </Card>
      <Card title="Retention defaults" description="Days to keep each kind of record. A school's own retention setting (Compliance, Retention) wins where it has one; these apply everywhere else.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {RETENTION_KEYS.map((k) => (
            <Input
              key={k}
              id={`district-retention-${k}`}
              label={RETENTION_LABELS[k]}
              type="number"
              min={0}
              disabled={!canManage}
              value={form.retention[k] ?? ''}
              onChange={(e) => setForm({ ...form, retention: { ...form.retention, [k]: Number(e.target.value) } })}
            />
          ))}
        </div>
      </Card>
      {canManage && (
        <div className="flex justify-end">
          <Button type="submit" loading={busy}>
            Save policies
          </Button>
        </div>
      )}
    </form>
  );
}

function StateView({ q, canManage }: { q: string; canManage: boolean }) {
  const [busy, setBusy] = useState('');
  const [year, setYear] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (!canManage) return <Alert kind="info">State exports are for district administrators. Ask your superintendent&apos;s office for a copy.</Alert>;
  const get = async (kind: string) => {
    setBusy(kind);
    setError(null);
    try {
      const sep = q ? '&' : '?';
      await download(`/district/state-exports/${kind}.csv${q}${kind === 'grades' && year ? `${sep}year=${encodeURIComponent(year)}` : ''}`, `state-${kind}.csv`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
    }
  };
  return (
    <Card title="State reporting exports" description="Student-level files in a state-neutral layout, with each school's code. Map the columns to your state's template; every download is written to the audit log.">
      {error && <Alert>{error}</Alert>}
      <div className="mb-3 max-w-xs">
        <Input label="School year for grades (optional)" id="state-year" placeholder="2026-2027" value={year} onChange={(e) => setYear(e.target.value)} />
      </div>
      <ul className="divide-y divide-slate-100">
        {STATE_EXPORTS.map((r) => (
          <li key={r.kind} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-medium">{r.label}</p>
              <p className="text-sm text-slate-600">{r.about}</p>
            </div>
            <Button variant="secondary" loading={busy === r.kind} onClick={() => get(r.kind)}>
              Download CSV
            </Button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
