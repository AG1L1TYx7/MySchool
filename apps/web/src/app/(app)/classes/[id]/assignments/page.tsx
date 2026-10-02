'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { ASSIGNMENT_TYPES, SUBMISSION_TYPES, fmtDate, fromLocalInput, type Assignment, type Rubric } from '@/lib/academics';
import type { H5pContentSummary } from '@/lib/h5p';
import { useAuth } from '@/lib/auth';
import type { ClassItem } from '@/lib/curriculum';
import { label, type Paged } from '@/lib/students';

export default function ClassAssignmentsPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const router = useRouter();
  const [klass, setKlass] = useState<ClassItem | null>(null);
  const [rows, setRows] = useState<Assignment[]>([]);
  const [rubrics, setRubrics] = useState<Rubric[]>([]);
  const [contents, setContents] = useState<H5pContentSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', type: 'homework', submissionType: 'online', category: 'Homework', maxPoints: '100', weight: '1', dueAt: '', allowLateUntil: '', latePenaltyPercent: '', maxAttempts: '', rubricId: '', h5pContentId: '', description: '' });
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const load = useCallback(async () => {
    try {
      const [k, a] = await Promise.all([api<ClassItem>(`/classes/${id}`), api<Paged<Assignment>>(`/assignments?classId=${id}&pageSize=200&sort=dueAt`)]);
      setKlass(k);
      setRows(a.data);
      if (k.canManage) {
        setRubrics((await api<{ data: Rubric[] }>('/rubrics')).data);
        setContents((await api<{ data: H5pContentSummary[] }>('/h5p/contents?status=published').catch(() => ({ data: [] }))).data);
      }
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const body: Record<string, unknown> = { classId: id, title: form.title, type: form.type, submissionType: form.submissionType, category: form.category || undefined, maxPoints: Number(form.maxPoints), weight: Number(form.weight), description: form.description || undefined };
      if (form.dueAt) body.dueAt = fromLocalInput(form.dueAt);
      if (form.allowLateUntil) body.allowLateUntil = fromLocalInput(form.allowLateUntil);
      if (form.latePenaltyPercent) body.latePenaltyPercent = Number(form.latePenaltyPercent);
      if (form.maxAttempts) body.maxAttempts = Number(form.maxAttempts);
      if (form.rubricId) body.rubricId = form.rubricId;
      if (form.h5pContentId) body.h5pContentId = form.h5pContentId;
      const created = await api<Assignment>('/assignments', { method: 'POST', body });
      router.push(`/assignments/${created.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setCreating(false);
    }
  }

  if (!klass) return error ? <Alert>{error}</Alert> : <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-sm text-slate-500">
          <Link href={`/classes/${id}`} className="hover:underline">
            {klass.name}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">Assignments</h1>
      </div>
      {error && <Alert>{error}</Alert>}
      <Card>
        <ul className="divide-y divide-slate-100">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <Link href={`/assignments/${a.id}`} className="font-medium text-slate-900 hover:underline">
                  {a.title}
                </Link>
                <p className="text-xs text-slate-500">
                  {label(a.type)} · {a.maxPoints} pts · weight {a.weight} · due {fmtDate(a.dueAt)}
                </p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs ${a.status === 'published' ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'}`}>
                {label(a.status)}
                {klass.canManage ? ` · ${a.gradedCount}/${a.submissionCount} graded` : ''}
              </span>
            </li>
          ))}
          {rows.length === 0 && <li className="py-6 text-center text-sm text-slate-500">No assignments yet.</li>}
        </ul>
      </Card>
      {klass.canManage && can('assignments.create') && (
        <Card title="New assignment" description="Created as a draft. Publish it from its page when it is ready.">
          <form onSubmit={create} className="space-y-4" noValidate>
            <Input label="Title" required value={form.title} onChange={set('title')} />
            <div className="grid gap-4 md:grid-cols-4">
              <Select label="Type" value={form.type} onChange={set('type')}>
                {ASSIGNMENT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {label(t)}
                  </option>
                ))}
              </Select>
              <Select label="Submitted" value={form.submissionType} onChange={set('submissionType')}>
                {SUBMISSION_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {label(t)}
                  </option>
                ))}
              </Select>
              <Input label="Category" value={form.category} onChange={set('category')} />
              <Input label="Max points" type="number" min="0" value={form.maxPoints} onChange={set('maxPoints')} />
            </div>
            <div className="grid gap-4 md:grid-cols-4">
              <Input label="Due" type="datetime-local" value={form.dueAt} onChange={set('dueAt')} />
              <Input label="Accept late until" type="datetime-local" value={form.allowLateUntil} onChange={set('allowLateUntil')} />
              <Input label="Late penalty %" type="number" min="0" max="100" value={form.latePenaltyPercent} onChange={set('latePenaltyPercent')} />
              <Input label="Max attempts" type="number" min="1" value={form.maxAttempts} onChange={set('maxAttempts')} />
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Input label="Weight" type="number" step="0.5" min="0" value={form.weight} onChange={set('weight')} />
              <Select label="Interactive activity (optional)" value={form.h5pContentId} onChange={set('h5pContentId')}>
                <option value="">None: students submit text or files</option>
                {contents.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.maxScore} items)
                  </option>
                ))}
              </Select>
              <Select label="Rubric" value={form.rubricId} onChange={set('rubricId')}>
                <option value="">None</option>
                {rubrics.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title} ({r.totalPoints} pts)
                  </option>
                ))}
              </Select>
            </div>
            <label className="block">
              <span className="mb-1 block text-sm font-medium text-slate-700">Description</span>
              <textarea className="block w-full rounded-md border-0 px-3 py-2 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500 sm:text-sm" rows={3} value={form.description} onChange={set('description')} />
            </label>
            <Button type="submit" loading={creating} disabled={!form.title.trim()}>
              Create draft
            </Button>
          </form>
        </Card>
      )}
    </div>
  );
}
