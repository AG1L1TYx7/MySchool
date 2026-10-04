'use client';

import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { StudentForm, payloadFrom, valuesFrom } from '@/components/student-form';
import { AccommodationCard, BehaviorCard, ConsentCard, CounselorNotesCard } from '@/components/support-cards';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { RELATIONSHIPS, label, type Guardian, type Student } from '@/lib/students';

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { can } = useAuth();
  const [student, setStudent] = useState<Student | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    try {
      setStudent(await api<Student>(`/students/${id}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function remove() {
    if (!confirm('Withdraw this student? The record is kept for the audit trail but hidden everywhere.')) return;
    await api(`/students/${id}`, { method: 'DELETE' });
    router.replace('/students');
  }

  if (error) return <Alert>{error}</Alert>;
  if (!student) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            {student.firstName} {student.lastName}
          </h1>
          <p className="text-sm text-slate-500">
            {student.studentNumber} · {student.gradeLevel ? `Grade ${student.gradeLevel}` : 'no grade'} · {label(student.enrollmentStatus)}
            {student.userId ? ' · has a sign-in account' : ''}
          </p>
        </div>
        {can('students.delete') && (
          <Button variant="danger" onClick={() => void remove()}>
            Withdraw
          </Button>
        )}
      </div>

      <Card title="Profile">
        {saved && <div className="mb-4"><Alert kind="success">Saved.</Alert></div>}
        {can('students.edit') ? (
          <StudentForm
            key={student.updatedAt}
            mode="edit"
            initial={valuesFrom(student)}
            submitLabel="Save changes"
            onSubmit={async (values) => {
              await api(`/students/${id}`, { method: 'PATCH', body: payloadFrom(values, 'edit') });
              setSaved(true);
              await load();
            }}
          />
        ) : (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-3">
            {(
              [
                ['Email', student.email],
                ['Phone', student.phone],
                ['Date of birth', student.dateOfBirth],
                ['Enrolled', student.enrollmentDate],
                ['Learning style', student.preferredLearningStyle ? label(student.preferredLearningStyle) : null],
                ['Accessibility needs', student.accessibilityNeeds],
                ['Goals', student.goals],
              ] as Array<[string, string | null]>
            ).map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs uppercase tracking-wide text-slate-500">{k}</dt>
                <dd className="text-slate-800">{v ?? '—'}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>

      <Guardians studentId={id} canManage={can('students.guardians.manage')} />
      {student.canSupport && <AccommodationCard studentId={id} />}
      {student.canSupport && <ConsentCard studentId={id} />}
      <BehaviorCard studentId={id} />
      <CounselorNotesCard studentId={id} />
    </div>
  );
}

function Guardians({ studentId, canManage }: { studentId: string; canManage: boolean }) {
  const [rows, setRows] = useState<Guardian[]>([]);
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '', relationship: 'guardian', isPrimary: false });
  const [state, setState] = useState<{ error?: string; info?: string; busy?: boolean }>({});

  const load = useCallback(async () => {
    try {
      setRows((await api<{ data: Guardian[] }>(`/students/${studentId}/guardians`)).data);
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [studentId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      const res = await api<{ invitationSent: boolean }>(`/students/${studentId}/guardians`, { method: 'POST', body: { ...form, firstName: form.firstName || undefined, lastName: form.lastName || undefined } });
      setForm({ email: '', firstName: '', lastName: '', relationship: 'guardian', isPrimary: false });
      setState({ info: res.invitationSent ? 'Guardian linked and invitation emailed.' : 'Guardian linked.' });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function setPrimary(g: Guardian) {
    await api(`/students/${studentId}/guardians/${g.id}`, { method: 'PATCH', body: { isPrimary: true } });
    await load();
  }
  async function remove(g: Guardian) {
    await api(`/students/${studentId}/guardians/${g.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <Card title="Guardians" description="Parents and guardians who can see this student's progress and receive notifications.">
      {state.error && <Alert>{state.error}</Alert>}
      {state.info && <Alert kind="success">{state.info}</Alert>}
      <ul className="mt-2 divide-y divide-slate-100 text-sm">
        {rows.map((g) => (
          <li key={g.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
            <div>
              <p className="font-medium text-slate-800">
                {g.guardian.firstName} {g.guardian.lastName}
                <span className="ml-2 text-xs text-slate-500">{label(g.relationship)}</span>
                {g.isPrimary && <span className="ml-2 rounded-full bg-brand-50 px-2 py-0.5 text-xs text-brand-800">primary contact</span>}
              </p>
              <p className="text-xs text-slate-500">
                {g.guardian.email}
                {g.guardian.status !== 'active' ? ` · account ${g.guardian.status}` : ''}
              </p>
            </div>
            {canManage && (
              <span className="flex gap-2">
                {!g.isPrimary && (
                  <Button variant="secondary" onClick={() => void setPrimary(g)}>
                    Make primary
                  </Button>
                )}
                <Button variant="ghost" onClick={() => void remove(g)}>
                  Remove
                </Button>
              </span>
            )}
          </li>
        ))}
        {rows.length === 0 && <li className="py-3 text-slate-500">No guardians linked yet.</li>}
      </ul>
      {canManage && (
        <form onSubmit={add} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-5" noValidate>
          <Input label="Guardian email" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="First name" hint="For a new account" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
          <Input label="Last name" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} />
          <Select label="Relationship" value={form.relationship} onChange={(e) => setForm({ ...form, relationship: e.target.value })}>
            {RELATIONSHIPS.map((r) => (
              <option key={r} value={r}>
                {label(r)}
              </option>
            ))}
          </Select>
          <div className="flex items-end">
            <Button type="submit" loading={state.busy} className="w-full">
              Link guardian
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}
