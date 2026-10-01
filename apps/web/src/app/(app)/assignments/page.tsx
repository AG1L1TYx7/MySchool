'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { Alert, Card, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { fmtDate, type Assignment } from '@/lib/academics';
import { useAuth } from '@/lib/auth';
import type { ClassItem } from '@/lib/curriculum';
import { label, type Paged } from '@/lib/students';

export default function AssignmentsPage() {
  const { user } = useAuth();
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [classId, setClassId] = useState('');
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<Paged<Assignment> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ data: ClassItem[] }>('/classes/mine')
      .then((r) => setClasses(r.data))
      .catch(() => setClasses([]));
  }, []);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ pageSize: '100', sort: 'dueAt' });
      if (classId) q.set('classId', classId);
      if (status) q.set('status', status);
      setResult(await api<Paged<Assignment>>(`/assignments?${q.toString()}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [classId, status]);
  useEffect(() => {
    void load();
  }, [load]);

  const learner = user?.role === 'student' || user?.role === 'parent';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">Assignments</h1>
      <Card>
        <div className="mb-4 grid gap-3 md:grid-cols-3">
          <Select label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">All my classes</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
          {!learner && (
            <Select label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">All</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
              <option value="closed">Closed</option>
            </Select>
          )}
        </div>
        {error && <Alert>{error}</Alert>}
        {!result && !error && <SkeletonRows rows={4} />}
        <MotionList className="divide-y divide-slate-100">
          {result?.data.map((a) => (
            <MotionItem key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <Link href={`/assignments/${a.id}`} className="font-medium text-slate-900 hover:underline">
                  {a.title}
                </Link>
                <p className="text-xs text-slate-500">
                  {a.className} · {label(a.type)} · {a.maxPoints} pts · due {fmtDate(a.dueAt)}
                </p>
              </div>
              <div className="text-right text-xs">
                {learner ? (
                  a.myGrade ? (
                    <span className="rounded-full bg-green-50 px-2 py-0.5 text-green-700">
                      {a.myGrade.score}/{a.myGrade.maxPoints} ({a.myGrade.percentage}%)
                    </span>
                  ) : a.mySubmission ? (
                    <span className="rounded-full bg-brand-50 px-2 py-0.5 text-brand-800">{label(a.mySubmission.status)}</span>
                  ) : (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-amber-800">Not submitted</span>
                  )
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                    {label(a.status)} · {a.gradedCount}/{a.submissionCount} graded
                  </span>
                )}
              </div>
            </MotionItem>
          ))}
          {result && result.data.length === 0 && <li className="py-6 text-center text-sm text-slate-500">No assignments yet.</li>}
        </MotionList>
      </Card>
    </div>
  );
}
