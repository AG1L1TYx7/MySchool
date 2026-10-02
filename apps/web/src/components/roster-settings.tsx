'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { PROVIDER_LABELS, uploadRoster, type RosterRun, type RosterSource, type SsoSettings, type SyncCounts } from '@/lib/roster';

const SSO = ['google', 'microsoft', 'clever', 'classlink'] as const;
const SOURCE_FIELDS: Record<string, Array<{ key: string; label: string; secret?: boolean; hint?: string }>> = {
  oneroster_api: [
    { key: 'baseUrl', label: 'OneRoster base URL', hint: 'The part before /ims/oneroster/v1p1' },
    { key: 'tokenUrl', label: 'OAuth token URL' },
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client secret', secret: true },
    { key: 'schoolExternalId', label: 'School sourcedId (optional, for district tenants)' },
  ],
  classlink: [
    { key: 'baseUrl', label: 'ClassLink Roster Server URL' },
    { key: 'tokenUrl', label: 'OAuth token URL' },
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client secret', secret: true },
    { key: 'schoolExternalId', label: 'School sourcedId (optional)' },
  ],
  clever: [
    { key: 'districtToken', label: 'District token', secret: true },
    { key: 'schoolExternalId', label: 'School id (optional, for district tokens)' },
  ],
};

/** Administrator section on the organisation page: where people and classes come from, and how they sign in. */
export function RosterSettings({ organizationId }: { organizationId: string }) {
  const [sources, setSources] = useState<RosterSource[] | null>(null);
  const [runs, setRuns] = useState<RosterRun[]>([]);
  const [sso, setSso] = useState<SsoSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<{ provider: string; name: string; config: Record<string, string> }>({ provider: 'oneroster_api', name: '', config: {} });
  const [busy, setBusy] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [openRun, setOpenRun] = useState<RosterRun | null>(null);
  const poll = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, r, sso] = await Promise.all([api<{ data: RosterSource[] }>(`/organizations/${organizationId}/roster/sources`), api<{ data: RosterRun[] }>(`/organizations/${organizationId}/roster/runs`), api<SsoSettings>(`/organizations/${organizationId}/roster/sso`)]);
      setSources(s.data);
      setRuns(r.data);
      setSso(sso);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [organizationId]);
  useEffect(() => {
    void load();
  }, [load]);

  // Keep polling while a run is in flight.
  useEffect(() => {
    if (!runs.some((r) => r.status === 'queued' || r.status === 'running')) return;
    poll.current = setTimeout(() => void load(), 1500);
    return () => {
      if (poll.current) clearTimeout(poll.current);
    };
  }, [runs, load]);

  async function act(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await fn();
      setOk(label);
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function addSource(e: FormEvent) {
    e.preventDefault();
    await act('Source saved.', () => api(`/organizations/${organizationId}/roster/sources`, { method: 'POST', body: form }));
    setAdding(false);
    setForm({ provider: 'oneroster_api', name: '', config: {} });
  }

  async function importFiles() {
    if (files.length === 0) return;
    await act(dryRun ? 'Preview started. Nothing has been written.' : 'Import started.', () => uploadRoster(organizationId, files, dryRun));
    if (!dryRun) setFiles([]);
  }

  async function saveSso(e: FormEvent) {
    e.preventDefault();
    if (!sso) return;
    await act('Sign-in settings saved.', () => api(`/organizations/${organizationId}/roster/sso`, { method: 'PUT', body: { providers: sso.providers, allowedDomains: sso.allowedDomains, passwordOptional: sso.passwordOptional } }));
  }

  async function showRun(id: string) {
    try {
      setOpenRun(await api<RosterRun>(`/organizations/${organizationId}/roster/runs/${id}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      {ok && <Alert kind="success">{ok}</Alert>}

      <Card title="Roster sources" description="Where students, staff and classes come from. Synced records are read-only here and update nightly." actions={<Button variant="secondary" onClick={() => setAdding((a) => !a)}>{adding ? 'Cancel' : 'Connect a source'}</Button>}>
        {adding && (
          <form onSubmit={(e) => void addSource(e)} className="mb-4 space-y-3 rounded-lg bg-slate-50 p-4" noValidate>
            <div className="grid gap-3 sm:grid-cols-2">
              <Select label="Provider" id="provider" value={form.provider} onChange={(e) => setForm({ provider: e.target.value, name: form.name, config: {} })}>
                {Object.keys(SOURCE_FIELDS).map((p) => (
                  <option key={p} value={p}>
                    {PROVIDER_LABELS[p]}
                  </option>
                ))}
              </Select>
              <Input label="Name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="District SIS" required />
              {SOURCE_FIELDS[form.provider].map((f) => (
                <Input key={f.key} label={f.label} hint={f.hint} type={f.secret ? 'password' : 'text'} autoComplete="off" value={form.config[f.key] ?? ''} onChange={(e) => setForm((s) => ({ ...s, config: { ...s.config, [f.key]: e.target.value } }))} />
              ))}
            </div>
            <Button type="submit" loading={busy} disabled={!form.name.trim()}>
              Save source
            </Button>
          </form>
        )}
        {sources === null ? (
          <SkeletonRows rows={2} />
        ) : sources.length === 0 ? (
          <p className="text-sm text-slate-500">No automatic source yet. Connect your SIS, Clever or ClassLink, or import a OneRoster file below.</p>
        ) : (
          <MotionList className="divide-y divide-slate-100">
            {sources.map((s) => (
              <MotionItem key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                <div>
                  <p className="font-medium text-slate-900">
                    {s.name} <span className="font-normal text-slate-500">· {PROVIDER_LABELS[s.provider]}</span>
                    {!s.isEnabled && <span className="ml-2 rounded bg-slate-100 px-1.5 text-xs text-slate-600">paused</span>}
                  </p>
                  <p className="text-xs text-slate-500">
                    {s.lastRun ? `Last run ${new Date(s.lastRun.startedAt).toLocaleString()} · ${s.lastRun.status}${s.lastRun.errorCount ? ` · ${s.lastRun.errorCount} errors` : ''}` : 'Never run'}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" loading={busy} onClick={() => void act('Preview started.', () => api(`/organizations/${organizationId}/roster/sources/${s.id}/run`, { method: 'POST', body: { dryRun: true } }))}>
                    Preview
                  </Button>
                  <Button loading={busy} onClick={() => void act('Sync started.', () => api(`/organizations/${organizationId}/roster/sources/${s.id}/run`, { method: 'POST', body: { dryRun: false } }))}>
                    Sync now
                  </Button>
                  <Button variant="secondary" loading={busy} onClick={() => void act(s.isEnabled ? 'Paused.' : 'Resumed.', () => api(`/organizations/${organizationId}/roster/sources/${s.id}`, { method: 'PATCH', body: { isEnabled: !s.isEnabled } }))}>
                    {s.isEnabled ? 'Pause' : 'Resume'}
                  </Button>
                  <Button variant="secondary" loading={busy} onClick={() => confirm(`Remove ${s.name}? Synced records stay.`) && void act('Removed.', () => api(`/organizations/${organizationId}/roster/sources/${s.id}`, { method: 'DELETE' }))}>
                    Remove
                  </Button>
                </div>
              </MotionItem>
            ))}
          </MotionList>
        )}
      </Card>

      <Card title="Import a OneRoster file" description="A zip exported by your SIS, or the CSV files (users, classes, enrollments; orgs, academicSessions, courses and demographics when you have them). Preview first.">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Files</span>
            <input type="file" multiple accept=".zip,.csv" aria-label="OneRoster files" className="block text-sm" onChange={(e) => setFiles([...(e.target.files ?? [])])} />
          </label>
          <label className="inline-flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={dryRun} onChange={(e) => setDryRun(e.target.checked)} /> Preview only
          </label>
          <Button loading={busy} disabled={files.length === 0} onClick={() => void importFiles()}>
            {dryRun ? 'Preview' : 'Import'}
          </Button>
        </div>
      </Card>

      <Card title="Runs" description="Every preview and sync, newest first.">
        {runs.length === 0 ? (
          <p className="text-sm text-slate-500">No runs yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${r.status === 'done' ? 'bg-green-50 text-green-800' : r.status === 'failed' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>{r.status}</span>
                  {PROVIDER_LABELS[r.provider] ?? r.provider}
                  {r.dryRun ? ' · preview' : ''} · {new Date(r.startedAt).toLocaleString()}
                  {r.errorMessage ? <span className="text-red-700"> · {r.errorMessage}</span> : null}
                </span>
                <span className="flex items-center gap-3 text-xs text-slate-600">
                  {r.summary && <Counts c={r.summary} />}
                  {r.errorCount > 0 && (
                    <button type="button" className="text-brand-700 hover:underline" onClick={() => void showRun(r.id)}>
                      {r.errorCount} error{r.errorCount === 1 ? '' : 's'}
                    </button>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {openRun && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-slate-800">Errors in this run</span>
              <button type="button" onClick={() => setOpenRun(null)} aria-label="Close">
                ✕
              </button>
            </div>
            <ul className="mt-2 space-y-1 text-slate-700">
              {(openRun.errors ?? []).map((e, i) => (
                <li key={i}>
                  <span className="font-mono text-slate-500">{e.entityType}{e.externalId ? ` ${e.externalId}` : ''}</span>: {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {sso && (
        <Card title="Sign-in" description="Which sign-in buttons work for this school, and for which email domains. Only rostered or invited accounts can ever sign in.">
          <form onSubmit={(e) => void saveSso(e)} className="space-y-3" noValidate>
            <div className="flex flex-wrap gap-4 text-sm">
              {SSO.map((p) => (
                <label key={p} className="inline-flex items-center gap-2">
                  <input type="checkbox" checked={sso.providers.includes(p)} onChange={(e) => setSso({ ...sso, providers: e.target.checked ? [...sso.providers, p] : sso.providers.filter((x) => x !== p) })} /> {PROVIDER_LABELS[p]}
                </label>
              ))}
            </div>
            <Input label="Allowed email domains (comma separated; empty allows any rostered address)" value={sso.allowedDomains.join(', ')} onChange={(e) => setSso({ ...sso, allowedDomains: e.target.value.split(',').map((d) => d.trim()).filter(Boolean) })} placeholder="lincoln.example.org, students.example.org" />
            <label className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" checked={sso.passwordOptional} onChange={(e) => setSso({ ...sso, passwordOptional: e.target.checked })} /> Rostered accounts do not need a SmartSchool password
            </label>
            <div>
              <Button type="submit" loading={busy}>
                Save sign-in settings
              </Button>
            </div>
            <p className="text-xs text-slate-500">Providers appear on the login page only when the server has credentials for them. Redirect URL to register with a provider: this site&apos;s address followed by /api/v1/auth/sso/&lt;provider&gt;/callback.</p>
          </form>
        </Card>
      )}
    </div>
  );
}

function Counts({ c }: { c: SyncCounts }) {
  const parts = [
    `${c.users.created + c.users.linked} users`,
    `${c.students.created} students`,
    `${c.classes.created} classes`,
    `${c.enrollments.created} enrolments${c.enrollments.dropped ? ` (${c.enrollments.dropped} dropped)` : ''}`,
  ];
  return <span>{parts.join(' · ')}</span>;
}
