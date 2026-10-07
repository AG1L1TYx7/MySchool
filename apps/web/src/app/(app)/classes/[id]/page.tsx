'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ClassPolicies, GradingSettings } from '@/components/grading-settings';
import { SubstitutesCard } from '@/components/substitutes-card';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CLASS_STATUSES, ENROLLMENT_STATUSES, type ClassItem, type Enrollment } from '@/lib/curriculum';
import { gradeLabel, periodLabel, type SchoolStructure } from '@/lib/school';
import { label, type Paged, type Student } from '@/lib/students';

interface Teacher {
  id: string;
  firstName: string;
  lastName: string;
}

export default function ClassPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can, user } = useAuth();
  const [klass, setKlass] = useState<ClassItem | null>(null);
  const [state, setState] = useState<{ error?: string; ok?: string }>({});

  const load = useCallback(async () => {
    try {
      setKlass(await api<ClassItem>(`/classes/${id}`));
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!klass) return state.error ? <Alert>{state.error}</Alert> : <p className="text-sm text-slate-500">Loading…</p>;

  async function remove() {
    if (!confirm('Cancel this class? It will be hidden everywhere but kept for the audit trail.')) return;
    await api(`/classes/${id}`, { method: 'DELETE' });
    router.replace('/classes');
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{klass.name}</h1>
          <p className="mt-1 text-sm text-slate-500">
            <Link href={`/courses/${klass.course.id}`} className="hover:underline">
              {klass.course.courseCode} · {klass.course.title}
            </Link>
            {' · '}
            {klass.term}
            {klass.room ? ` · Room ${klass.room}` : ''}
            {klass.meetingSchedule ? ` · ${klass.meetingSchedule}` : ''}
            {' · '}
            {label(klass.status)}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Teachers: {klass.teachers.map((t) => `${t.firstName} ${t.lastName}${t.isPrimary ? ' (primary)' : ''}`).join(', ') || 'none assigned'} · {klass.enrolledCount}
            {klass.maxStudents ? ` of ${klass.maxStudents}` : ''} enrolled{klass.waitlistedCount ? `, ${klass.waitlistedCount} waiting` : ''}
          </p>
          {klass.myEnrollmentStatus && <p className="mt-1 text-sm text-brand-800">Your status: {label(klass.myEnrollmentStatus)}</p>}
        </div>
        {can('classes.delete') && (
          <Button variant="danger" onClick={() => void remove()}>
            Cancel class
          </Button>
        )}
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}

      <nav aria-label="Class sections" className="flex flex-wrap gap-2 text-sm">
        <Link href={`/classes/${id}/assignments`} className="rounded-md bg-white px-3 py-1.5 ring-1 ring-slate-300 hover:bg-slate-50">
          Assignments
        </Link>
        {can('grades.view.all') && (klass.canManage || user?.role === 'principal' || user?.role === 'counselor') && (
          <Link href={`/classes/${id}/gradebook`} className="rounded-md bg-white px-3 py-1.5 ring-1 ring-slate-300 hover:bg-slate-50">
            Gradebook
          </Link>
        )}
        {can('attendance.view') && (
          <Link href={`/classes/${id}/attendance`} className="rounded-md bg-white px-3 py-1.5 ring-1 ring-slate-300 hover:bg-slate-50">
            Attendance
          </Link>
        )}
        {klass.canManage && can('motivation.award') && (
          <Link href={`/classes/${id}/motivation`} className="rounded-md bg-white px-3 py-1.5 ring-1 ring-slate-300 hover:bg-slate-50">
            Motivation
          </Link>
        )}
        {can('learning.records') && (
          <Link href={`/classes/${id}/learning`} className="rounded-md bg-white px-3 py-1.5 ring-1 ring-slate-300 hover:bg-slate-50">
            Learning
          </Link>
        )}
        {can('reports.view') && (
          <Link href={`/classes/${id}/insight`} className="rounded-md bg-white px-3 py-1.5 ring-1 ring-slate-300 hover:bg-slate-50">
            Insight
          </Link>
        )}
      </nav>

      <ClassPolicies classId={id} />
      {klass.canManage && can('classes.edit') && <DetailsForm klass={klass} onSaved={load} />}
      {klass.canManage && can('grades.edit') && <GradingSettings classId={id} organizationId={klass.organizationId} />}
      {can('classes.teachers.manage') && <Teachers klass={klass} onChange={load} />}
      {klass.canManage && can('classes.substitutes') && <SubstitutesCard classId={id} />}
      {klass.canManage && can('classes.roster.manage') && <Roster klass={klass} onChange={load} />}
    </div>
  );
}

function DetailsForm({ klass, onSaved }: { klass: ClassItem; onSaved: () => Promise<void> }) {
  const [structure, setStructure] = useState<SchoolStructure | null>(null);
  useEffect(() => {
    api<SchoolStructure>(`/organizations/${klass.organizationId}/structure`)
      .then(setStructure)
      .catch(() => setStructure(null));
  }, [klass.organizationId]);
  const [form, setForm] = useState({ name: klass.name, section: klass.section ?? '', term: klass.term, termId: klass.termId ?? '', periodId: klass.periodId ?? '', gradeLevel: klass.gradeLevel ?? '', startDate: klass.startDate ?? '', endDate: klass.endDate ?? '', room: klass.room ?? '', meetingSchedule: klass.meetingSchedule ?? '', maxStudents: klass.maxStudents ? String(klass.maxStudents) : '', status: klass.status });
  const [state, setState] = useState<{ error?: string; ok?: boolean; busy?: boolean }>({});
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function save(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      const body: Record<string, unknown> = { name: form.name, term: form.term, status: form.status };
      for (const k of ['section', 'termId', 'periodId', 'gradeLevel', 'startDate', 'endDate', 'room', 'meetingSchedule'] as const) if (form[k]) body[k] = form[k];
      if (form.maxStudents) body.maxStudents = Number(form.maxStudents);
      await api(`/classes/${klass.id}`, { method: 'PATCH', body });
      setState({ ok: true });
      await onSaved();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  return (
    <Card title="Details">
      <form onSubmit={save} className="grid gap-3 md:grid-cols-4" noValidate>
        {state.error && (
          <div className="md:col-span-4">
            <Alert>{state.error}</Alert>
          </div>
        )}
        {state.ok && (
          <div className="md:col-span-4">
            <Alert kind="success">Saved.</Alert>
          </div>
        )}
        <div className="md:col-span-2">
          <Input label="Name" value={form.name} onChange={set('name')} />
        </div>
        <Input label="Section" value={form.section} onChange={set('section')} />
        {structure && structure.years.length > 0 ? (
          <Select label="Term" value={form.termId} onChange={(e) => setForm((f) => ({ ...f, termId: e.target.value, term: structure.years.flatMap((y) => y.terms).find((t) => t.id === e.target.value)?.name ?? f.term }))}>
            <option value="">{form.term || 'Choose a term'}</option>
            {structure.years.map((y) => (
              <optgroup key={y.id} label={y.name}>
                {y.terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </Select>
        ) : (
          <Input label="Term" value={form.term} onChange={set('term')} />
        )}
        <Select label="Period" value={form.periodId} onChange={set('periodId')}>
          <option value="">No period</option>
          {(structure?.bellSchedules ?? []).map((b) => (
            <optgroup key={b.id} label={b.name}>
              {b.periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {periodLabel(p)}
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
        <Select label="Grade level" value={form.gradeLevel} onChange={set('gradeLevel')}>
          <option value="">Mixed or not set</option>
          {(structure?.gradeLevels ?? []).map((g) => (
            <option key={g} value={g}>
              {gradeLabel(g)}
            </option>
          ))}
        </Select>
        <Input label="Start date" type="date" value={form.startDate} onChange={set('startDate')} />
        <Input label="End date" type="date" value={form.endDate} onChange={set('endDate')} />
        <Input label="Room" value={form.room} onChange={set('room')} />
        <Input label="Capacity" type="number" min="1" value={form.maxStudents} onChange={set('maxStudents')} />
        <div className="md:col-span-2">
          <Input label="Meeting schedule" value={form.meetingSchedule} onChange={set('meetingSchedule')} />
        </div>
        <Select label="Status" value={form.status} onChange={set('status')}>
          {CLASS_STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </Select>
        <div className="flex items-end">
          <Button type="submit" loading={state.busy} className="w-full">
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Teachers({ klass, onChange }: { klass: ClassItem; onChange: () => Promise<void> }) {
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [teacherId, setTeacherId] = useState('');
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Paged<Teacher>>('/users?role=teacher&pageSize=200')
      .then((r) => setTeachers(r.data))
      .catch(() => setTeachers([]));
  }, []);
  async function add(isPrimary: boolean) {
    try {
      await api(`/classes/${klass.id}/teachers`, { method: 'POST', body: { teacherId, isPrimary } });
      setTeacherId('');
      setError(null);
      await onChange();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function remove(id: string) {
    await api(`/classes/${klass.id}/teachers/${id}`, { method: 'DELETE' });
    await onChange();
  }
  return (
    <Card title="Teachers">
      {error && <Alert>{error}</Alert>}
      <ul className="divide-y divide-slate-100 text-sm">
        {klass.teachers.map((t) => (
          <li key={t.id} className="flex items-center justify-between py-2">
            <span>
              {t.firstName} {t.lastName} <span className="text-xs text-slate-500">{t.email}</span>
              {t.isPrimary && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800">primary</span>}
            </span>
            <span className="flex gap-2">
              {!t.isPrimary && (
                <Button variant="secondary" onClick={() => void api(`/classes/${klass.id}/teachers`, { method: 'POST', body: { teacherId: t.id, isPrimary: true } }).then(onChange)}>
                  Make primary
                </Button>
              )}
              <Button variant="ghost" onClick={() => void remove(t.id)}>
                Remove
              </Button>
            </span>
          </li>
        ))}
        {klass.teachers.length === 0 && <li className="py-2 text-slate-500">No teachers assigned.</li>}
      </ul>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="min-w-[240px] flex-1">
          <Select label="Add teacher" value={teacherId} onChange={(e) => setTeacherId(e.target.value)}>
            <option value="">Choose</option>
            {teachers
              .filter((t) => !klass.teachers.some((k) => k.id === t.id))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.lastName}, {t.firstName}
                </option>
              ))}
          </Select>
        </div>
        <Button variant="secondary" disabled={!teacherId} onClick={() => void add(false)}>
          Add as co-teacher
        </Button>
        <Button disabled={!teacherId} onClick={() => void add(true)}>
          Add as primary
        </Button>
      </div>
    </Card>
  );
}

function Roster({ klass, onChange }: { klass: ClassItem; onChange: () => Promise<void> }) {
  const [rows, setRows] = useState<Enrollment[]>([]);
  const [search, setSearch] = useState('');
  const [candidates, setCandidates] = useState<Student[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});

  const load = useCallback(async () => {
    try {
      setRows((await api<{ data: Enrollment[] }>(`/classes/${klass.id}/enrollments`)).data);
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [klass.id]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!search.trim()) return setCandidates([]);
    const t = setTimeout(() => {
      api<Paged<Student>>(`/students?search=${encodeURIComponent(search)}&pageSize=10&status=active`)
        .then((r) => setCandidates(r.data.filter((s) => !rows.some((e) => e.studentId === s.id && (e.status === 'enrolled' || e.status === 'waitlisted')))))
        .catch(() => setCandidates([]));
    }, 200);
    return () => clearTimeout(t);
  }, [search, rows]);

  async function enroll() {
    setState({ busy: true });
    try {
      const r = await api<{ enrolled: string[]; waitlisted: string[]; skipped: string[] }>(`/classes/${klass.id}/enrollments`, { method: 'POST', body: { studentIds: [...picked] } });
      setState({ ok: `${r.enrolled.length} enrolled, ${r.waitlisted.length} waitlisted, ${r.skipped.length} already on the roster.` });
      setPicked(new Set());
      setSearch('');
      await load();
      await onChange();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function setStatus(e: Enrollment, status: string) {
    try {
      await api(`/classes/${klass.id}/enrollments/${e.studentId}`, { method: 'PATCH', body: { status } });
      setState({});
      await load();
      await onChange();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }

  return (
    <Card title="Roster" description={`${klass.enrolledCount}${klass.maxStudents ? ` of ${klass.maxStudents}` : ''} enrolled${klass.waitlistedCount ? `, ${klass.waitlistedCount} on the waitlist` : ''}.`}>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      <table className="mt-2 min-w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th className="py-2 pr-4">Student</th>
            <th className="py-2 pr-4">Number</th>
            <th className="py-2 pr-4">Grade</th>
            <th className="py-2 pr-4">Status</th>
            <th className="py-2">Change</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((e) => (
            <tr key={e.id}>
              <td className="py-2 pr-4 font-medium text-slate-800">
                <Link href={`/students/${e.studentId}`} className="hover:underline">
                  {e.student.lastName}, {e.student.firstName}
                </Link>
              </td>
              <td className="py-2 pr-4 font-mono text-xs">{e.student.studentNumber}</td>
              <td className="py-2 pr-4">{e.student.gradeLevel ?? ''}</td>
              <td className="py-2 pr-4">{label(e.status)}</td>
              <td className="py-2">
                <select aria-label="Enrolment status" className="rounded-md border-0 py-1 text-sm ring-1 ring-inset ring-slate-300" value={e.status} onChange={(ev) => void setStatus(e, ev.target.value)}>
                  {ENROLLMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {label(s)}
                    </option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-slate-500">
                Nobody enrolled yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="mt-4 border-t border-slate-100 pt-4">
        <Input label="Enrol students" placeholder="Search by name or number" value={search} onChange={(e) => setSearch(e.target.value)} />
        {candidates.length > 0 && (
          <ul className="mt-2 divide-y divide-slate-100 rounded-md ring-1 ring-slate-200">
            {candidates.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 text-brand-600"
                  checked={picked.has(s.id)}
                  onChange={(e) =>
                    setPicked((p) => {
                      const n = new Set(p);
                      if (e.target.checked) n.add(s.id);
                      else n.delete(s.id);
                      return n;
                    })
                  }
                />
                <span>
                  {s.lastName}, {s.firstName} <span className="font-mono text-xs text-slate-500">{s.studentNumber}</span>
                  {s.gradeLevel ? <span className="text-xs text-slate-500"> · Grade {s.gradeLevel}</span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
        {picked.size > 0 && (
          <Button className="mt-3" loading={state.busy} onClick={() => void enroll()}>
            Enrol {picked.size} student{picked.size === 1 ? '' : 's'}
          </Button>
        )}
      </div>
    </Card>
  );
}
