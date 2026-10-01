'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { COURSE_STATUSES, type Course } from '@/lib/curriculum';
import { GRADE_LEVELS, label, type Paged } from '@/lib/students';

export default function CoursesPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<Course> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ page: String(page), pageSize: '25' });
      if (search) q.set('search', search);
      if (grade) q.set('gradeLevel', grade);
      if (status) q.set('status', status);
      setResult(await api<Paged<Course>>(`/courses?${q.toString()}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [page, search, grade, status]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Courses</h1>
        {can('courses.create') && (
          <Link href="/courses/new">
            <Button>New course</Button>
          </Link>
        )}
      </div>
      <Card>
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <Input label="Search" placeholder="Title, code or subject" value={search} onChange={(e) => (setPage(1), setSearch(e.target.value))} />
          <Select label="Grade" value={grade} onChange={(e) => (setPage(1), setGrade(e.target.value))}>
            <option value="">All grades</option>
            {GRADE_LEVELS.map((g) => (
              <option key={g} value={g}>
                {g === 'K' ? 'Kindergarten' : `Grade ${g}`}
              </option>
            ))}
          </Select>
          {can('courses.create') && (
            <Select label="Status" value={status} onChange={(e) => (setPage(1), setStatus(e.target.value))}>
              <option value="">All statuses</option>
              {COURSE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </Select>
          )}
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {result?.data.map((c) => (
            <Link key={c.id} href={`/courses/${c.id}`} className="block rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 hover:ring-brand-300">
              <p className="font-mono text-xs text-slate-500">{c.courseCode}</p>
              <p className="mt-1 font-semibold text-slate-900">{c.title}</p>
              <p className="mt-1 text-sm text-slate-500">
                {[c.subject, c.gradeLevel ? `Grade ${c.gradeLevel}` : null].filter(Boolean).join(' · ') || 'No subject set'}
              </p>
              <p className="mt-3 flex flex-wrap gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 ${c.isPublished ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-600'}`}>{c.isPublished ? 'Published' : label(c.status)}</span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">
                  {c.moduleCount} module{c.moduleCount === 1 ? '' : 's'} · {c.lessonCount} lesson{c.lessonCount === 1 ? '' : 's'}
                </span>
                {c.instructor && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{c.instructor.firstName} {c.instructor.lastName}</span>}
              </p>
            </Link>
          ))}
          {result && result.data.length === 0 && <p className="text-sm text-slate-500">No courses match.</p>}
        </div>
        {result && result.meta.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>{result.meta.totalItems} courses</span>
            <span className="flex gap-2">
              <button className="disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span>
                Page {result.meta.page} of {result.meta.totalPages}
              </span>
              <button className="disabled:opacity-40" disabled={page >= result.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}
