'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { MotionItem, MotionList } from '@/components/motion';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CONSENT_REASONS, KIND_LABELS, KIND_TONES, PLAN_LABELS, type Accommodation, type AiConsent, type BehaviorRecord, type CounselorNote } from '@/lib/support';
import { fmtDate, toLocalInput, fromLocalInput } from '@/lib/academics';

type Busy = { error?: string; ok?: string; busy?: boolean };
const quiet = (err: unknown) => (err instanceof ApiError && (err.problem.status === 403 || err.problem.status === 404) ? null : errorMessage(err));

/** IEP and 504 accommodations: the student's own teachers, counselors and administrators; parents read. */
export function AccommodationCard({ studentId }: { studentId: string }) {
  const { can } = useAuth();
  const manage = can('support.accommodations.manage');
  const [plan, setPlan] = useState<Accommodation | null | undefined>(undefined);
  const [hidden, setHidden] = useState(false);
  const [state, setState] = useState<Busy>({});
  const [form, setForm] = useState({ plan: 'iep', extendedTimePercent: '0', readAloud: false, largeText: false, reducedMotion: false, reducedDistraction: false, notes: '', startDate: '', endDate: '' });
  const load = useCallback(async () => {
    try {
      const p = await api<Accommodation | null>(`/students/${studentId}/accommodations`);
      setPlan(p);
      if (p) setForm({ plan: p.plan, extendedTimePercent: String(p.extendedTimePercent), readAloud: p.readAloud, largeText: p.largeText, reducedMotion: p.reducedMotion, reducedDistraction: p.reducedDistraction, notes: p.notes ?? '', startDate: p.startDate ?? '', endDate: p.endDate ?? '' });
    } catch (err) {
      const msg = quiet(err);
      if (msg) setState({ error: msg });
      else setHidden(true);
    }
  }, [studentId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (hidden || plan === undefined) return null;

  async function save(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api(`/students/${studentId}/accommodations`, { method: 'PUT', body: { plan: form.plan, extendedTimePercent: Number(form.extendedTimePercent), readAloud: form.readAloud, largeText: form.largeText, reducedMotion: form.reducedMotion, reducedDistraction: form.reducedDistraction, notes: form.notes || undefined, startDate: form.startDate || undefined, endDate: form.endDate || undefined } });
      setState({ ok: 'Accommodations saved. They apply the next time the student signs in or reloads.' });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  const flags = [['readAloud', 'Read aloud'], ['largeText', 'Larger text'], ['reducedMotion', 'Reduced motion'], ['reducedDistraction', 'Reduced distraction']] as const;
  return (
    <Card title="Support plan (IEP / 504)" description="Applied in the product: extended time on due dates, read-aloud, larger text, reduced motion and a quieter layout. Seen only by this student's teachers, counselors, administrators and family.">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      {!manage &&
        (plan ? (
          <dl className="grid gap-2 text-sm md:grid-cols-2">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Plan</dt>
              <dd className="text-slate-800">{PLAN_LABELS[plan.plan]}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">Extended time</dt>
              <dd className="text-slate-800">{plan.extendedTimePercent ? `${plan.extendedTimePercent}% more time` : 'None'}</dd>
            </div>
            <div className="md:col-span-2">
              <dt className="text-xs uppercase tracking-wide text-slate-500">In the product</dt>
              <dd className="text-slate-800">{flags.filter(([k]) => plan[k]).map(([, l]) => l).join(', ') || 'No display changes'}</dd>
            </div>
            {plan.notes && (
              <div className="md:col-span-2">
                <dt className="text-xs uppercase tracking-wide text-slate-500">Notes</dt>
                <dd className="whitespace-pre-wrap text-slate-800">{plan.notes}</dd>
              </div>
            )}
          </dl>
        ) : (
          <p className="text-sm text-slate-500">No accommodations recorded.</p>
        ))}
      {manage && (
        <form onSubmit={save} className="grid gap-3 md:grid-cols-3" noValidate>
          <Select label="Plan" value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>
            {Object.entries(PLAN_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <Input label="Extended time (%)" type="number" min="0" max="300" value={form.extendedTimePercent} onChange={(e) => setForm({ ...form, extendedTimePercent: e.target.value })} hint="50 means half again as long between opening and due." />
          <div className="grid grid-cols-2 gap-1 self-end pb-1 text-sm text-slate-700">
            {flags.map(([k, l]) => (
              <label key={k} className="flex items-center gap-2">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.checked })} /> {l}
              </label>
            ))}
          </div>
          <Input label="Starts" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          <Input label="Ends" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          <div className="md:col-span-3">
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Notes for teachers</span>
              <textarea className="block w-full rounded-md border-0 px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300" rows={3} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </label>
          </div>
          <div className="flex gap-2 md:col-span-3">
            <Button type="submit" loading={state.busy}>
              {plan ? 'Save plan' : 'Record plan'}
            </Button>
            {plan && (
              <Button type="button" variant="secondary" disabled={state.busy} onClick={() => void api(`/students/${studentId}/accommodations`, { method: 'DELETE' }).then(() => load()).then(() => setState({ ok: 'Plan removed.' })).catch((err) => setState({ error: errorMessage(err) }))}>
                Remove plan
              </Button>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}

/** Behaviour records with the school's family-visibility rule. */
export function BehaviorCard({ studentId }: { studentId: string }) {
  const { can } = useAuth();
  const manage = can('support.behavior.manage');
  const [rows, setRows] = useState<BehaviorRecord[] | null>(null);
  const [hidden, setHidden] = useState(false);
  const [state, setState] = useState<Busy>({});
  const [form, setForm] = useState({ kind: 'positive', title: '', description: '', occurredAt: toLocalInput(new Date().toISOString()), location: '', actionTaken: '', parentVisible: '' });
  const load = useCallback(async () => {
    try {
      setRows((await api<{ data: BehaviorRecord[] }>(`/students/${studentId}/behavior`)).data);
    } catch (err) {
      const msg = quiet(err);
      if (msg) setState({ error: msg });
      else setHidden(true);
    }
  }, [studentId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (hidden) return null;
  async function add(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api(`/students/${studentId}/behavior`, { method: 'POST', body: { kind: form.kind, title: form.title, description: form.description || undefined, occurredAt: fromLocalInput(form.occurredAt), location: form.location || undefined, actionTaken: form.actionTaken || undefined, parentVisible: form.parentVisible === '' ? undefined : form.parentVisible === 'yes' } });
      setForm({ ...form, title: '', description: '', actionTaken: '' });
      setState({ ok: 'Recorded.' });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  return (
    <Card title="Behaviour" description={manage ? 'Positive notes and concerns. Families see what the school rule allows unless a record says otherwise.' : 'Notes the school has shared with you.'}>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      {rows && rows.length === 0 && <p className="text-sm text-slate-500">Nothing recorded.</p>}
      <MotionList className="divide-y divide-slate-100">
        {(rows ?? []).map((r) => (
          <MotionItem key={r.id} className="py-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className={`rounded-full px-2 py-0.5 text-xs ${KIND_TONES[r.kind]}`}>{KIND_LABELS[r.kind]}</span>
              <span className="font-medium text-slate-900">{r.title}</span>
              <span className="text-xs text-slate-500">
                {fmtDate(r.occurredAt)}
                {r.location ? ` · ${r.location}` : ''} · {r.reportedBy.firstName} {r.reportedBy.lastName}
                {manage ? (r.visibleToFamily ? ' · family can see' : ' · school only') : ''}
              </span>
              {r.canEdit && (
                <button type="button" className="ml-auto text-xs text-slate-500 hover:text-red-700" onClick={() => void api(`/behavior/${r.id}`, { method: 'DELETE' }).then(load).catch((err) => setState({ error: errorMessage(err) }))}>
                  Remove
                </button>
              )}
            </div>
            {r.description && <p className="mt-1 whitespace-pre-wrap text-slate-700">{r.description}</p>}
            {r.actionTaken && (
              <p className="mt-1 text-slate-600">
                <span className="font-medium">Action:</span> {r.actionTaken}
              </p>
            )}
          </MotionItem>
        ))}
      </MotionList>
      {manage && (
        <form onSubmit={add} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-3" noValidate>
          <Select label="Kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {Object.entries(KIND_LABELS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
          <div className="md:col-span-2">
            <Input label="What happened" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          </div>
          <Input label="When" type="datetime-local" value={form.occurredAt} onChange={(e) => setForm({ ...form, occurredAt: e.target.value })} />
          <Input label="Where" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <Select label="Family can see" value={form.parentVisible} onChange={(e) => setForm({ ...form, parentVisible: e.target.value })}>
            <option value="">School rule</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </Select>
          <div className="md:col-span-3">
            <Input label="Details" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <Input label="Action taken" value={form.actionTaken} onChange={(e) => setForm({ ...form, actionTaken: e.target.value })} />
          </div>
          <div className="flex items-end">
            <Button type="submit" loading={state.busy} disabled={!form.title}>
              Record
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

/** COPPA consent for AI features: parents decide; administrators can record the school's decision. */
export function ConsentCard({ studentId }: { studentId: string }) {
  const { can } = useAuth();
  const manage = can('support.consent.manage');
  const [consent, setConsent] = useState<AiConsent | null>(null);
  const [hidden, setHidden] = useState(false);
  const [state, setState] = useState<Busy>({});
  const load = useCallback(async () => {
    try {
      setConsent(await api<AiConsent>(`/students/${studentId}/ai-consent`));
    } catch (err) {
      const msg = quiet(err);
      if (msg) setState({ error: msg });
      else setHidden(true);
    }
  }, [studentId]);
  useEffect(() => {
    void load();
  }, [load]);
  if (hidden || !consent) return null;
  const decide = (status: 'granted' | 'declined') => void api(`/students/${studentId}/ai-consent`, { method: 'PUT', body: { status } }).then(load).then(() => setState({ ok: status === 'granted' ? 'AI features are on for this student.' : 'AI features are off for this student.' })).catch((err) => setState({ error: errorMessage(err) }));
  return (
    <Card title="AI tutor and content: consent" description={consent.under13 ? 'This student is under 13, so AI features follow COPPA consent rules.' : 'This student is 13 or older.'}>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      <p className="text-sm text-slate-800">
        <span className={`mr-2 rounded-full px-2 py-0.5 text-xs ${consent.allowed ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>{consent.allowed ? 'AI features on' : 'AI features off'}</span>
        {CONSENT_REASONS[consent.reason]}
        {consent.decidedAt ? ` Decided ${new Date(consent.decidedAt).toLocaleDateString()} by the ${consent.decidedBy}.` : ''}
      </p>
      {manage && consent.under13 && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => decide('granted')} disabled={consent.status === 'granted'}>
            Allow AI features
          </Button>
          <Button variant="secondary" onClick={() => decide('declined')} disabled={consent.status === 'declined'}>
            Turn AI features off
          </Button>
        </div>
      )}
    </Card>
  );
}

/** Private counselor notes: only counselors ever see this card. */
export function CounselorNotesCard({ studentId }: { studentId: string }) {
  const { can } = useAuth();
  const [notes, setNotes] = useState<CounselorNote[] | null>(null);
  const [hidden, setHidden] = useState(!can('support.notes'));
  const [body, setBody] = useState('');
  const [state, setState] = useState<Busy>({});
  const load = useCallback(async () => {
    try {
      setNotes((await api<{ data: CounselorNote[] }>(`/students/${studentId}/counselor-notes`)).data);
    } catch (err) {
      const msg = quiet(err);
      if (msg) setState({ error: msg });
      else setHidden(true);
    }
  }, [studentId]);
  useEffect(() => {
    if (!hidden) void load();
  }, [hidden, load]);
  if (hidden) return null;
  async function add(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api(`/students/${studentId}/counselor-notes`, { method: 'POST', body: { body } });
      setBody('');
      setState({ ok: 'Note saved. Only counselors can read it.' });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  return (
    <Card title="Counselor notes (private)" description="Never shown to teachers, parents or the student.">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      <ul className="divide-y divide-slate-100 text-sm">
        {(notes ?? []).map((n) => (
          <li key={n.id} className="py-2">
            <p className="whitespace-pre-wrap text-slate-800">{n.body}</p>
            <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              {n.author.firstName} {n.author.lastName} · {fmtDate(n.createdAt)}
              {n.canEdit && (
                <button type="button" className="text-slate-500 hover:text-red-700" onClick={() => void api(`/counselor-notes/${n.id}`, { method: 'DELETE' }).then(load).catch((err) => setState({ error: errorMessage(err) }))}>
                  Remove
                </button>
              )}
            </p>
          </li>
        ))}
        {notes && notes.length === 0 && <li className="py-2 text-slate-500">No notes yet.</li>}
      </ul>
      <form onSubmit={add} className="mt-3 space-y-2" noValidate>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">New note</span>
          <textarea className="block w-full rounded-md border-0 px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
        </label>
        <Button type="submit" variant="secondary" loading={state.busy} disabled={!body.trim()}>
          Save note
        </Button>
      </form>
    </Card>
  );
}
