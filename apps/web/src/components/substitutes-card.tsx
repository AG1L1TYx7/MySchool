'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { toLocalInput, fromLocalInput } from '@/lib/academics';
import type { Substitute } from '@/lib/assistant';

interface Person {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

/** Substitute access with an expiry (docs/13 section 8): a teacher or assistant becomes a co-teacher until the end time. */
export function SubstitutesCard({ classId }: { classId: string }) {
  const [rows, setRows] = useState<Substitute[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [form, setForm] = useState({ userId: '', startsAt: toLocalInput(new Date().toISOString()), endsAt: toLocalInput(new Date(Date.now() + 86_400_000).toISOString()), note: '' });
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});
  const load = useCallback(async () => {
    try {
      setRows((await api<{ data: Substitute[] }>(`/classes/${classId}/substitutes`)).data);
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [classId]);
  useEffect(() => {
    void load();
    api<{ data: Person[] }>(`/classes/${classId}/substitutes/candidates`)
      .then((r) => setPeople(r.data))
      .catch(() => setPeople([]));
  }, [load, classId]);

  async function grant(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api(`/classes/${classId}/substitutes`, { method: 'POST', body: { userId: form.userId, startsAt: fromLocalInput(form.startsAt), endsAt: fromLocalInput(form.endsAt), note: form.note || undefined } });
      setState({ ok: 'Access granted. It ends automatically at the end time.' });
      setForm((f) => ({ ...f, userId: '', note: '' }));
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  return (
    <Card title="Substitutes" description="Give a teacher or assistant this class for a few days: attendance, assignments, announcements and messages. Access ends by itself at the end time.">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      <ul className="divide-y divide-slate-100 text-sm">
        {(rows ?? []).map((s) => (
          <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span>
              {s.user.firstName} {s.user.lastName} <span className="text-xs text-slate-500">{s.user.email}</span>
              <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${s.active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>{s.active ? 'active now' : 'scheduled'}</span>
              <span className="block text-xs text-slate-500">
                {new Date(s.startsAt).toLocaleString()} to {new Date(s.endsAt).toLocaleString()}
                {s.note ? ` · ${s.note}` : ''}
              </span>
            </span>
            <Button variant="ghost" onClick={() => void api(`/substitutes/${s.id}`, { method: 'DELETE' }).then(load).catch((err) => setState({ error: errorMessage(err) }))}>
              End access
            </Button>
          </li>
        ))}
        {rows && rows.length === 0 && <li className="py-2 text-slate-500">No substitute access right now.</li>}
      </ul>
      <form onSubmit={(e) => void grant(e)} className="mt-3 grid gap-3 md:grid-cols-4" noValidate>
        <div className="md:col-span-2">
          <Select label="Who" value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}>
            <option value="">Choose a teacher or assistant</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.lastName}, {p.firstName} ({p.role})
              </option>
            ))}
          </Select>
        </div>
        <Input label="From" type="datetime-local" value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} />
        <Input label="Until" type="datetime-local" value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} />
        <div className="md:col-span-3">
          <Input label="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        <div className="flex items-end">
          <Button type="submit" variant="secondary" loading={state.busy} disabled={!form.userId}>
            Grant access
          </Button>
        </div>
      </form>
    </Card>
  );
}
