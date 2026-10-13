'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { COMPONENT_LABELS, COMPONENT_TONES, IMPACT_LABELS, INCIDENT_STATUS_LABELS, NEXT_STATUSES, STATUS_TONES, type Incident, type StatusCheck, type StatusPage } from '@/lib/billing';

const COMPONENTS = [
  { key: 'api', name: 'API' },
  { key: 'database', name: 'Database' },
  { key: 'ai', name: 'AI service' },
  { key: 'web', name: 'Web app' },
];

/** Operations (docs/02 section 35): the platform administrator's view of health checks and the incidents the status page shows. */
export default function OperationsPage() {
  const { can } = useAuth();
  const [status, setStatus] = useState<StatusPage | null>(null);
  const [checks, setChecks] = useState<StatusCheck[] | null>(null);
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const allowed = can('operations.manage');
  const load = useCallback(() => {
    if (!allowed) return;
    api<StatusPage>('/status', { auth: false }).then(setStatus).catch((e) => setError(errorMessage(e)));
    api<StatusCheck[]>('/operations/checks?limit=20').then(setChecks).catch(() => setChecks([]));
    api<Incident[]>('/operations/incidents').then(setIncidents).catch((e) => setError(errorMessage(e)));
  }, [allowed]);
  useEffect(load, [load]);
  if (!allowed) return <NotForYou what="operations" back="/dashboard" />;
  const runCheck = async () => {
    setBusy('check');
    setError(null);
    try {
      await api('/operations/checks/run', { method: 'POST' });
      setNote('Checked.');
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Operations</h1>
          <p className="mt-1 text-sm text-slate-600">
            What the public status page shows, and the incident records behind it. The page itself is at{' '}
            <Link href="/status" className="text-brand-700 underline">
              /status
            </Link>
            . Every change here is written to the audit log.
          </p>
        </div>
        <Button variant="secondary" loading={busy === 'check'} onClick={() => void runCheck()}>
          Run a health check now
        </Button>
      </div>
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      {status && (
        <div className={`rounded-md p-4 ring-1 ${STATUS_TONES[status.status]}`} role="status">
          <p className="font-medium">{status.label}</p>
          <ul className="mt-2 flex flex-wrap gap-4 text-sm">
            {status.components.map((c) => (
              <li key={c.key}>
                {c.name}: <span className={`font-medium ${COMPONENT_TONES[c.status]}`}>{COMPONENT_LABELS[c.status]}</span>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs">Uptime over {status.uptime.days} days: {status.uptime.percent === null ? 'no checks yet' : `${status.uptime.percent}%`}</p>
        </div>
      )}
      <NewIncidentForm onCreated={() => { setNote('Opened. It is on the status page now.'); load(); }} />
      <Card title={`Incidents and maintenance (${incidents?.length ?? 0})`}>
        {!incidents ? (
          <SkeletonRows rows={3} />
        ) : incidents.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing recorded yet.</p>
        ) : (
          <ul className="space-y-3">
            {incidents.map((i) => (
              <IncidentRow key={i.id} incident={i} onChange={() => { setNote('Updated.'); load(); }} />
            ))}
          </ul>
        )}
      </Card>
      <Card title="Recent checks" description="One check every five minutes; the status page's uptime is the share of checks that did not find the service down.">
        {!checks ? (
          <SkeletonRows rows={3} />
        ) : checks.length === 0 ? (
          <p className="text-sm text-slate-600">No checks yet. Run one above.</p>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Recent checks table">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500">
                  <th className="py-1 pr-3">When</th>
                  <th className="py-1 pr-3">Result</th>
                  {COMPONENTS.map((c) => (
                    <th key={c.key} className="py-1 pr-3">
                      {c.name}
                    </th>
                  ))}
                  <th className="py-1 pr-3">Took</th>
                </tr>
              </thead>
              <tbody>
                {checks.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="py-1 pr-3">{new Date(c.checkedAt).toLocaleString()}</td>
                    <td className="py-1 pr-3">{c.status}</td>
                    {COMPONENTS.map((k) => (
                      <td key={k.key} className={`py-1 pr-3 ${COMPONENT_TONES[c.components[k.key] ?? 'disabled']}`}>
                        {COMPONENT_LABELS[c.components[k.key] ?? 'disabled']}
                      </td>
                    ))}
                    <td className="py-1 pr-3">{c.latencyMs} ms</td>
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

function NewIncidentForm({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ kind: 'incident' as 'incident' | 'maintenance', title: '', message: '', impact: 'minor' as Incident['impact'], components: ['api'] as string[], isPublic: true, scheduledFor: '', scheduledUntil: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = (k: string) => setForm({ ...form, components: form.components.includes(k) ? form.components.filter((c) => c !== k) : [...form.components, k] });
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/operations/incidents', { method: 'POST', body: { ...form, scheduledFor: form.scheduledFor ? new Date(form.scheduledFor).toISOString() : undefined, scheduledUntil: form.scheduledUntil ? new Date(form.scheduledUntil).toISOString() : undefined } });
      setForm({ ...form, title: '', message: '', scheduledFor: '', scheduledUntil: '' });
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Open an incident or plan maintenance</Button>
      </div>
    );
  }
  return (
    <Card title="New incident or maintenance" description="Write for the people who use the product: what is affected and what they can expect. Public entries appear on the status page at once.">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        <Select label="Kind" id="inc-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'incident' | 'maintenance' })}>
          <option value="incident">Incident</option>
          <option value="maintenance">Planned maintenance</option>
        </Select>
        <Select label="Impact" id="inc-impact" value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value as Incident['impact'] })}>
          {(Object.keys(IMPACT_LABELS) as Incident['impact'][]).map((k) => (
            <option key={k} value={k}>
              {IMPACT_LABELS[k]}
            </option>
          ))}
        </Select>
        <div className="sm:col-span-2">
          <Input label="Title" id="inc-title" required minLength={3} maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label htmlFor="inc-message" className="block text-sm font-medium text-slate-700">
            First update
          </label>
          <textarea id="inc-message" required rows={3} maxLength={2000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm" />
        </div>
        <fieldset className="sm:col-span-2">
          <legend className="text-sm font-medium text-slate-700">Affected components</legend>
          <div className="mt-1 flex flex-wrap gap-3">
            {COMPONENTS.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.components.includes(c.key)} onChange={() => toggle(c.key)} />
                {c.name}
              </label>
            ))}
          </div>
        </fieldset>
        {form.kind === 'maintenance' && (
          <>
            <Input label="Starts" id="inc-from" type="datetime-local" required value={form.scheduledFor} onChange={(e) => setForm({ ...form, scheduledFor: e.target.value })} />
            <Input label="Ends" id="inc-until" type="datetime-local" value={form.scheduledUntil} onChange={(e) => setForm({ ...form, scheduledUntil: e.target.value })} />
          </>
        )}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} />
          Show on the public status page
        </label>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {form.kind === 'maintenance' ? 'Schedule' : 'Open incident'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

function IncidentRow({ incident, onChange }: { incident: Incident; onChange: () => void }) {
  const [status, setStatus] = useState(incident.status);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const next = NEXT_STATUSES[incident.status] ?? [];
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api(`/operations/incidents/${incident.id}`, { method: 'PATCH', body: { status: status !== incident.status ? status : undefined, message } });
      setMessage('');
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rounded-md bg-slate-50 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{incident.title}</span>
        <span className={`rounded px-1.5 py-0.5 text-xs ${incident.open ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700'}`}>{INCIDENT_STATUS_LABELS[incident.status] ?? incident.status}</span>
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700">{incident.kind === 'maintenance' ? 'Maintenance' : IMPACT_LABELS[incident.impact]}</span>
        {!incident.isPublic && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700">Private</span>}
        <span className="text-xs text-slate-500">{incident.components.join(', ')}</span>
      </div>
      <ol className="mt-2 space-y-1 text-sm">
        {[...incident.updates].reverse().map((u, n) => (
          <li key={n}>
            <span className="text-xs text-slate-500">{new Date(u.at).toLocaleString()} · </span>
            <span className="font-medium">{INCIDENT_STATUS_LABELS[u.status] ?? u.status}: </span>
            {u.message}
          </li>
        ))}
      </ol>
      {(incident.open || next.length > 0) && (
        <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-[auto_1fr_auto]">
          {error && (
            <div className="sm:col-span-3">
              <Alert>{error}</Alert>
            </div>
          )}
          <Select label="Status" id={`inc-status-${incident.id}`} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value={incident.status}>{INCIDENT_STATUS_LABELS[incident.status] ?? incident.status} (keep)</option>
            {next.map((s) => (
              <option key={s} value={s}>
                {INCIDENT_STATUS_LABELS[s] ?? s}
              </option>
            ))}
          </Select>
          <Input label="Update" id={`inc-update-${incident.id}`} required maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="What changed, in plain words" />
          <div className="flex items-end">
            <Button type="submit" variant="secondary" loading={busy}>
              Post update
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}
