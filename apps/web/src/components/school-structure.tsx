'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CODE_CATEGORIES, DAY_LETTERS, GRADE_LEVELS, TERM_TYPES, gradeLabel, type AcademicYear, type BellSchedule, type SchoolStructure, type Term } from '@/lib/school';
import { label } from '@/lib/students';

type Busy = { error?: string; ok?: string; busy?: boolean };

/**
 * The school's shape (docs/13 section 3): years, terms, grading periods, bell schedules, attendance codes,
 * grade levels and the attendance deadline. Staff can read it; administrators change it.
 */
export function SchoolStructureSettings({ organizationId }: { organizationId: string }) {
  const { can } = useAuth();
  const manage = can('organizations.structure');
  const [data, setData] = useState<SchoolStructure | null>(null);
  const [state, setState] = useState<Busy>({});
  const base = `/organizations/${organizationId}/structure`;

  const load = useCallback(async () => {
    try {
      setData(await api<SchoolStructure>(base));
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [base]);
  useEffect(() => {
    void load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setState({ busy: true });
    try {
      await fn();
      setState({ ok });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  };

  if (!data) {
    return (
      <Card title="School structure">
        {state.error ? <Alert>{state.error}</Alert> : <SkeletonRows rows={3} />}
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      <Settings data={data} manage={manage} busy={state.busy} onSave={(body) => run(() => api(`${base}/settings`, { method: 'PUT', body }), 'School settings saved.')} />
      <Years years={data.years} manage={manage} busy={state.busy} base={base} run={run} />
      <BellSchedules schedules={data.bellSchedules} manage={manage} busy={state.busy} base={base} run={run} />
      <Codes data={data} manage={manage} busy={state.busy} base={base} run={run} />
    </div>
  );
}

function Settings({ data, manage, busy, onSave }: { data: SchoolStructure; manage: boolean; busy?: boolean; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [grades, setGrades] = useState<string[]>(data.gradeLevels);
  const [deadline, setDeadline] = useState(data.attendanceDeadlineTime ?? '');
  useEffect(() => {
    setGrades(data.gradeLevels);
    setDeadline(data.attendanceDeadlineTime ?? '');
  }, [data]);
  const toggle = (g: string) => setGrades((cur) => (cur.includes(g) ? cur.filter((x) => x !== g) : GRADE_LEVELS.filter((x) => x === g || cur.includes(x))));
  return (
    <Card title="Grade levels and attendance deadline" description={`Times are in the school's timezone (${data.timezone}).`}>
      <form
        className="space-y-4"
        noValidate
        onSubmit={(e: FormEvent) => {
          e.preventDefault();
          void onSave({ gradeLevels: grades, attendanceDeadlineTime: deadline });
        }}
      >
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-slate-700">Grades this school serves</legend>
          <div className="flex flex-wrap gap-1">
            {GRADE_LEVELS.map((g) => {
              const on = grades.includes(g);
              return (
                <button key={g} type="button" aria-pressed={on} disabled={!manage} onClick={() => toggle(g)} className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset transition-colors duration-150 ${on ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300 hover:bg-slate-50'} disabled:cursor-default`}>
                  {gradeLabel(g)}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="grid gap-3 md:grid-cols-3">
          <Input label="Attendance due by (daily)" type="time" disabled={!manage} value={deadline} onChange={(e) => setDeadline(e.target.value)} hint="After this time the office and teachers are told which classes have not taken attendance. Leave empty to turn alerts off." />
        </div>
        {manage && (
          <Button type="submit" loading={busy}>
            Save settings
          </Button>
        )}
      </form>
    </Card>
  );
}

type Runner = (fn: () => Promise<unknown>, ok: string) => Promise<void>;

function Years({ years, manage, busy, base, run }: { years: AcademicYear[]; manage: boolean; busy?: boolean; base: string; run: Runner }) {
  const [form, setForm] = useState({ name: '', startDate: '', endDate: '' });
  const [term, setTerm] = useState<{ yearId: string; name: string; type: string; startDate: string; endDate: string } | null>(null);
  const [gp, setGp] = useState<{ termId: string; name: string; startDate: string; endDate: string } | null>(null);
  return (
    <Card title="School years and terms" description="Classes attach to a term; grading periods drive report cards.">
      {years.length === 0 && <p className="text-sm text-slate-500">No school year yet.</p>}
      <MotionList as="div" className="space-y-4">
        {years.map((y) => (
          <MotionItem as="div" key={y.id} className="rounded-lg bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium text-slate-900">
                  {y.name}
                  {y.isCurrent && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">Current</span>}
                </p>
                <p className="text-xs text-slate-500">
                  {y.startDate} to {y.endDate}
                </p>
              </div>
              {manage && (
                <div className="flex gap-2">
                  {!y.isCurrent && (
                    <Button variant="secondary" disabled={busy} onClick={() => void run(() => api(`${base}/years/${y.id}`, { method: 'PATCH', body: { isCurrent: true } }), `${y.name} is now the current year.`)}>
                      Make current
                    </Button>
                  )}
                  <Button variant="secondary" disabled={busy} onClick={() => setTerm({ yearId: y.id, name: '', type: 'semester', startDate: y.startDate, endDate: y.endDate })}>
                    Add term
                  </Button>
                  <Button variant="danger" disabled={busy} onClick={() => void run(() => api(`${base}/years/${y.id}`, { method: 'DELETE' }), 'Year removed.')}>
                    Remove
                  </Button>
                </div>
              )}
            </div>
            {y.terms.length > 0 && (
              <ul className="mt-3 divide-y divide-slate-200 text-sm">
                {y.terms.map((t) => (
                  <TermRow key={t.id} t={t} manage={manage} busy={busy} base={base} run={run} onAddPeriod={() => setGp({ termId: t.id, name: '', startDate: t.startDate, endDate: t.endDate })} />
                ))}
              </ul>
            )}
            {term?.yearId === y.id && (
              <form
                className="mt-3 grid gap-3 md:grid-cols-5"
                noValidate
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  void run(() => api(`${base}/years/${y.id}/terms`, { method: 'POST', body: term }), 'Term added.').then(() => setTerm(null));
                }}
              >
                <Input label="Term name" required value={term.name} onChange={(e) => setTerm({ ...term, name: e.target.value })} />
                <Select label="Type" value={term.type} onChange={(e) => setTerm({ ...term, type: e.target.value })}>
                  {TERM_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {label(t)}
                    </option>
                  ))}
                </Select>
                <Input label="Starts" type="date" value={term.startDate} onChange={(e) => setTerm({ ...term, startDate: e.target.value })} />
                <Input label="Ends" type="date" value={term.endDate} onChange={(e) => setTerm({ ...term, endDate: e.target.value })} />
                <div className="flex items-end gap-2">
                  <Button type="submit" loading={busy} disabled={!term.name}>
                    Add
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setTerm(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
            {gp && y.terms.some((t) => t.id === gp.termId) && (
              <form
                className="mt-3 grid gap-3 md:grid-cols-4"
                noValidate
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  void run(() => api(`${base}/terms/${gp.termId}/grading-periods`, { method: 'POST', body: gp }), 'Grading period added.').then(() => setGp(null));
                }}
              >
                <Input label="Grading period" required placeholder="Q1" value={gp.name} onChange={(e) => setGp({ ...gp, name: e.target.value })} />
                <Input label="Starts" type="date" value={gp.startDate} onChange={(e) => setGp({ ...gp, startDate: e.target.value })} />
                <Input label="Ends" type="date" value={gp.endDate} onChange={(e) => setGp({ ...gp, endDate: e.target.value })} />
                <div className="flex items-end gap-2">
                  <Button type="submit" loading={busy} disabled={!gp.name}>
                    Add
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setGp(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </MotionItem>
        ))}
      </MotionList>
      {manage && (
        <form
          className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-4"
          noValidate
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(() => api(`${base}/years`, { method: 'POST', body: form }), 'School year added.').then(() => setForm({ name: '', startDate: '', endDate: '' }));
          }}
        >
          <Input label="New school year" required placeholder="2027-2028" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Starts" type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
          <Input label="Ends" type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
          <div className="flex items-end">
            <Button type="submit" loading={busy} disabled={!form.name || !form.startDate || !form.endDate}>
              Add year
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function TermRow({ t, manage, busy, base, run, onAddPeriod }: { t: Term; manage: boolean; busy?: boolean; base: string; run: Runner; onAddPeriod: () => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2">
      <div>
        <span className="font-medium text-slate-800">{t.name}</span>
        <span className="ml-2 text-xs text-slate-500">
          {label(t.type)} · {t.startDate} to {t.endDate}
        </span>
        {t.gradingPeriods.length > 0 && (
          <ul className="mt-1 flex flex-wrap gap-1">
            {t.gradingPeriods.map((g) => (
              <li key={g.id} className="flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs text-slate-700 ring-1 ring-inset ring-slate-200">
                {g.name} · {g.startDate.slice(5)} to {g.endDate.slice(5)}
                {manage && (
                  <button type="button" className="text-slate-400 hover:text-red-700" aria-label={`Remove grading period ${g.name}`} disabled={busy} onClick={() => void run(() => api(`${base}/grading-periods/${g.id}`, { method: 'DELETE' }), 'Grading period removed.')}>
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
      {manage && (
        <div className="flex gap-2">
          <Button variant="secondary" disabled={busy} onClick={onAddPeriod}>
            Add grading period
          </Button>
          <Button variant="danger" disabled={busy} onClick={() => void run(() => api(`${base}/terms/${t.id}`, { method: 'DELETE' }), 'Term removed.')}>
            Remove
          </Button>
        </div>
      )}
    </li>
  );
}

function BellSchedules({ schedules, manage, busy, base, run }: { schedules: BellSchedule[]; manage: boolean; busy?: boolean; base: string; run: Runner }) {
  const [name, setName] = useState('');
  const [period, setPeriod] = useState<{ scheduleId: string; name: string; startTime: string; endTime: string; days: string } | null>(null);
  const toggleDay = (d: string) => period && setPeriod({ ...period, days: period.days.includes(d) ? period.days.replace(d, '') : DAY_LETTERS.map(([l]) => l).filter((l) => l === d || period.days.includes(l)).join('') });
  return (
    <Card title="Bell schedules and periods" description="Classes meet in a period; attendance is taken per period.">
      {schedules.length === 0 && <p className="text-sm text-slate-500">No bell schedule yet.</p>}
      <MotionList as="div" className="space-y-4">
        {schedules.map((s) => (
          <MotionItem as="div" key={s.id} className="rounded-lg bg-slate-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-medium text-slate-900">
                {s.name}
                {s.isDefault && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">Default</span>}
              </p>
              {manage && (
                <div className="flex gap-2">
                  <Button variant="secondary" disabled={busy} onClick={() => setPeriod({ scheduleId: s.id, name: String(s.periods.length + 1), startTime: '', endTime: '', days: 'MTWRF' })}>
                    Add period
                  </Button>
                  <Button variant="danger" disabled={busy} onClick={() => void run(() => api(`${base}/bell-schedules/${s.id}`, { method: 'DELETE' }), 'Bell schedule removed.')}>
                    Remove
                  </Button>
                </div>
              )}
            </div>
            {s.periods.length > 0 && (
              <table className="mt-3 min-w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="py-1 pr-4">Period</th>
                    <th className="py-1 pr-4">Time</th>
                    <th className="py-1 pr-4">Days</th>
                    {manage && (
                      <th className="py-1">
                        <span className="sr-only">Actions</span>
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {s.periods.map((p) => (
                    <tr key={p.id}>
                      <td className="py-1 pr-4 font-medium text-slate-800">{p.name}</td>
                      <td className="py-1 pr-4 tabular-nums">
                        {p.startTime}–{p.endTime}
                      </td>
                      <td className="py-1 pr-4">{DAY_LETTERS.filter(([l]) => p.days.includes(l)).map(([, d]) => d).join(' ')}</td>
                      {manage && (
                        <td className="py-1 text-right">
                          <button type="button" className="text-xs text-slate-500 hover:text-red-700" disabled={busy} onClick={() => void run(() => api(`${base}/periods/${p.id}`, { method: 'DELETE' }), 'Period removed.')}>
                            Remove
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {period?.scheduleId === s.id && (
              <form
                className="mt-3 grid gap-3 md:grid-cols-5"
                noValidate
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  void run(() => api(`${base}/bell-schedules/${s.id}/periods`, { method: 'POST', body: { name: period.name, startTime: period.startTime, endTime: period.endTime, days: period.days } }), 'Period added.').then(() => setPeriod(null));
                }}
              >
                <Input label="Period" required value={period.name} onChange={(e) => setPeriod({ ...period, name: e.target.value })} />
                <Input label="Starts" type="time" required value={period.startTime} onChange={(e) => setPeriod({ ...period, startTime: e.target.value })} />
                <Input label="Ends" type="time" required value={period.endTime} onChange={(e) => setPeriod({ ...period, endTime: e.target.value })} />
                <fieldset>
                  <legend className="mb-1 block text-sm font-medium text-slate-700">Days</legend>
                  <div className="flex flex-wrap gap-1">
                    {DAY_LETTERS.map(([l, d]) => (
                      <button key={l} type="button" aria-pressed={period.days.includes(l)} onClick={() => toggleDay(l)} className={`rounded-full px-2 py-0.5 text-xs ring-1 ring-inset ${period.days.includes(l) ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-700 ring-slate-300'}`}>
                        {d}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="flex items-end gap-2">
                  <Button type="submit" loading={busy} disabled={!period.name || !period.startTime || !period.endTime}>
                    Add
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setPeriod(null)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </MotionItem>
        ))}
      </MotionList>
      {manage && (
        <form
          className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 pt-4"
          noValidate
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(() => api(`${base}/bell-schedules`, { method: 'POST', body: { name, isDefault: schedules.length === 0 } }), 'Bell schedule added.').then(() => setName(''));
          }}
        >
          <div className="min-w-[240px]">
            <Input label="New bell schedule" placeholder="Early release" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <Button type="submit" loading={busy} disabled={!name}>
            Add schedule
          </Button>
        </form>
      )}
    </Card>
  );
}

function Codes({ data, manage, busy, base, run }: { data: SchoolStructure; manage: boolean; busy?: boolean; base: string; run: Runner }) {
  const [form, setForm] = useState({ code: '', label: '', category: 'excused', countsAsPresent: false });
  return (
    <Card title="Attendance codes" description="The codes teachers pick from. Each maps to a category the state reports use.">
      <table className="min-w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2 pr-4">Code</th>
            <th className="py-2 pr-4">Meaning</th>
            <th className="py-2 pr-4">Category</th>
            <th className="py-2 pr-4">Counts as present</th>
            <th className="py-2">Active</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {data.attendanceCodes.map((c) => (
            <tr key={c.id} className={c.isActive ? '' : 'text-slate-400'}>
              <td className="py-2 pr-4 font-mono font-medium">{c.code}</td>
              <td className="py-2 pr-4">{c.label}</td>
              <td className="py-2 pr-4">{label(c.category)}</td>
              <td className="py-2 pr-4">{c.countsAsPresent ? 'Yes' : 'No'}</td>
              <td className="py-2">
                {manage ? (
                  <button type="button" className="text-xs text-brand-700 hover:underline" disabled={busy} onClick={() => void run(() => api(`${base}/attendance-codes/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } }), c.isActive ? `${c.code} retired.` : `${c.code} is active again.`)}>
                    {c.isActive ? 'Retire' : 'Reactivate'}
                  </button>
                ) : c.isActive ? (
                  'Yes'
                ) : (
                  'No'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {manage && (
        <form
          className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-5"
          noValidate
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void run(() => api(`${base}/attendance-codes`, { method: 'POST', body: form }), 'Code added.').then(() => setForm({ code: '', label: '', category: 'excused', countsAsPresent: false }));
          }}
        >
          <Input label="Code" required placeholder="MED" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          <Input label="Meaning" required placeholder="Medical" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
          <Select label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CODE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {label(c)}
              </option>
            ))}
          </Select>
          <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
            <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={form.countsAsPresent} onChange={(e) => setForm({ ...form, countsAsPresent: e.target.checked })} />
            Counts as present
          </label>
          <div className="flex items-end">
            <Button type="submit" loading={busy} disabled={!form.code || !form.label}>
              Add code
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
