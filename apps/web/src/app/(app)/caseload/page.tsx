'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { CaseloadEntry } from '@/lib/support';
import type { Paged, Student } from '@/lib/students';

/** A counselor's caseload: the students they follow, with open wellness alerts at a glance. */
export default function CaseloadPage() {
  const { user, can } = useAuth();
  const allowed = can('support.counselor') && user?.role === 'counselor';
  const [rows, setRows] = useState<CaseloadEntry[] | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [form, setForm] = useState({ studentId: '', reason: '' });
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});

  const load = useCallback(async () => {
    try {
      setRows((await api<{ data: CaseloadEntry[] }>('/counselor/caseload')).data);
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, []);
  useEffect(() => {
    if (!allowed) return;
    void load();
    api<Paged<Student>>('/students?pageSize=200')
      .then((r) => setStudents(r.data))
      .catch(() => setStudents([]));
  }, [allowed, load]);

  if (!allowed) return <NotForYou what="the counselor caseload" back="/dashboard" />;
  async function add(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api('/counselor/caseload', { method: 'POST', body: { studentId: form.studentId, reason: form.reason || undefined } });
      setForm({ studentId: '', reason: '' });
      setState({ ok: 'Added to your caseload.' });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  const onList = new Set((rows ?? []).map((r) => r.student.id));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My caseload</h1>
        <p className="text-sm text-slate-500">Students you follow. Open each one for the support plan, behaviour, consent and your private notes.</p>
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      <Card description={rows ? `${rows.length} student${rows.length === 1 ? '' : 's'}.` : undefined}>
        {!rows && <SkeletonRows rows={3} />}
        <MotionList className="divide-y divide-slate-100">
          {(rows ?? []).map((r) => (
            <MotionItem key={r.student.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <Link href={`/students/${r.student.id}`} className="font-medium text-slate-900 hover:underline">
                  {r.student.lastName}, {r.student.firstName}
                </Link>
                <p className="text-xs text-slate-500">
                  {r.student.studentNumber}
                  {r.student.gradeLevel ? ` · Grade ${r.student.gradeLevel}` : ''}
                  {r.reason ? ` · ${r.reason}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {r.openAlerts > 0 && (
                  <Link href="/wellness" className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-800">
                    {r.openAlerts} open alert{r.openAlerts === 1 ? '' : 's'}
                  </Link>
                )}
                <button type="button" className="text-xs text-slate-500 hover:text-red-700" onClick={() => void api(`/counselor/caseload/${r.student.id}`, { method: 'DELETE' }).then(load).catch((err) => setState({ error: errorMessage(err) }))}>
                  Remove
                </button>
              </div>
            </MotionItem>
          ))}
          {rows && rows.length === 0 && <li className="py-3 text-sm text-slate-500">Nobody on your caseload yet.</li>}
        </MotionList>
        <form onSubmit={add} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-3" noValidate>
          <Select label="Student" value={form.studentId} onChange={(e) => setForm({ ...form, studentId: e.target.value })}>
            <option value="">Choose a student</option>
            {students.filter((s) => !onList.has(s.id)).map((s) => (
              <option key={s.id} value={s.id}>
                {s.lastName}, {s.firstName} ({s.studentNumber})
              </option>
            ))}
          </Select>
          <Input label="Reason (optional)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <div className="flex items-end">
            <Button type="submit" loading={state.busy} disabled={!form.studentId}>
              Add to caseload
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
