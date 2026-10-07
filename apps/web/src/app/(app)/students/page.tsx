'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { SkeletonRows } from '@/components/motion';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, download, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ENROLLMENT_STATUSES, GRADE_LEVELS, label, type Paged, type Student } from '@/lib/students';

export default function StudentsPage() {
  const { can } = useAuth();
  const [search, setSearch] = useState('');
  const [grade, setGrade] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<Student> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ page: String(page), pageSize: '25', sort: 'lastName,firstName' });
      if (search) q.set('search', search);
      if (grade) q.set('gradeLevel', grade);
      if (status) q.set('status', status);
      setResult(await api<Paged<Student>>(`/students?${q.toString()}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [page, search, grade, status]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  async function exportCsv() {
    const q = new URLSearchParams();
    if (search) q.set('search', search);
    if (grade) q.set('gradeLevel', grade);
    if (status) q.set('status', status);
    try {
      await download(`/students/export?${q.toString()}`, `students-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Students</h1>
        <div className="flex gap-2">
          {can('students.export') && (
            <Button variant="secondary" onClick={() => void exportCsv()}>
              Export CSV
            </Button>
          )}
          {can('students.import') && (
            <Link href="/students/import">
              <Button variant="secondary">Import CSV</Button>
            </Link>
          )}
          {can('students.create') && (
            <Link href="/students/new">
              <Button>New student</Button>
            </Link>
          )}
        </div>
      </div>
      <Card>
        <div className="mb-4 grid gap-3 md:grid-cols-4">
          <Input label="Search" placeholder="Name, number or email" value={search} onChange={(e) => (setPage(1), setSearch(e.target.value))} />
          <Select label="Grade" value={grade} onChange={(e) => (setPage(1), setGrade(e.target.value))}>
            <option value="">All grades</option>
            {GRADE_LEVELS.map((g) => (
              <option key={g} value={g}>
                {g === 'K' ? 'Kindergarten' : `Grade ${g}`}
              </option>
            ))}
          </Select>
          <Select label="Status" value={status} onChange={(e) => (setPage(1), setStatus(e.target.value))}>
            <option value="">All statuses</option>
            {ENROLLMENT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {label(s)}
              </option>
            ))}
          </Select>
        </div>
        {error && <Alert>{error}</Alert>}
        {!result && !error && <SkeletonRows rows={5} />}
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Students table">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4">Number</th>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Grade</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2">Enrolled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result?.data.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50">
                  <td className="py-2 pr-4 font-mono text-xs">{s.studentNumber}</td>
                  <td className="py-2 pr-4 font-medium text-slate-800">
                    <Link href={`/students/${s.id}`} className="hover:underline">
                      {s.lastName}, {s.firstName}
                    </Link>
                  </td>
                  <td className="py-2 pr-4">{s.gradeLevel ?? ''}</td>
                  <td className="py-2 pr-4">{label(s.enrollmentStatus)}</td>
                  <td className="py-2 pr-4 text-slate-600">{s.email ?? ''}</td>
                  <td className="py-2 text-slate-600">{s.enrollmentDate ?? ''}</td>
                </tr>
              ))}
              {result && result.data.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    No students match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {result && (
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>
              {result.meta.totalItems} student{result.meta.totalItems === 1 ? '' : 's'}
            </span>
            <span className="flex gap-2">
              <button className="disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span>
                Page {result.meta.page} of {Math.max(result.meta.totalPages, 1)}
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
