'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Alert, Button, Card } from '@/components/ui';
import { api, download, errorMessage } from '@/lib/api';
import type { Gradebook } from '@/lib/academics';
import { useAuth } from '@/lib/auth';

export default function GradebookPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [book, setBook] = useState<Gradebook | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Gradebook>(`/classes/${id}/gradebook`)
      .then(setBook)
      .catch((err) => setError(errorMessage(err)));
  }, [id]);

  if (error) return <Alert>{error}</Alert>;
  if (!book) return <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">
            <Link href={`/classes/${id}`} className="hover:underline">
              {book.className}
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">Gradebook</h1>
          <p className="text-sm text-slate-500">Class average: {book.classAverage === null ? '—' : `${book.classAverage}%`}</p>
        </div>
        {can('grades.export') && (
          <Button variant="secondary" onClick={() => void download(`/classes/${id}/gradebook/export`, `gradebook-${book.className}.csv`)}>
            Export CSV
          </Button>
        )}
      </div>
      <Card>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="sticky left-0 bg-white py-2 pr-4">Student</th>
                {book.assignments.map((a) => (
                  <th key={a.id} className="py-2 pr-4 font-normal">
                    <Link href={`/assignments/${a.id}`} className="hover:underline">
                      {a.title}
                    </Link>
                    <div className="text-[10px] normal-case text-slate-400">
                      /{a.maxPoints} · w{a.weight} · avg {book.perAssignmentAverage[a.id] ?? '—'}
                    </div>
                  </th>
                ))}
                <th className="py-2 pr-4">Total</th>
                <th className="py-2">Grade</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {book.rows.map((r) => (
                <tr key={r.student.id}>
                  <td className="sticky left-0 bg-white py-2 pr-4 font-medium text-slate-800">
                    <Link href={`/students/${r.student.id}`} className="hover:underline">
                      {r.student.lastName}, {r.student.firstName}
                    </Link>
                  </td>
                  {book.assignments.map((a) => {
                    const c = r.cells[a.id];
                    return (
                      <td key={a.id} className={`py-2 pr-4 ${c && c.percentage < 60 ? 'text-red-700' : ''}`}>
                        {c ? c.score : <span className="text-slate-300">—</span>}
                      </td>
                    );
                  })}
                  <td className="py-2 pr-4">
                    {r.weightedScore}/{r.weightedMax}
                  </td>
                  <td className="py-2 font-medium">{r.percentage === null ? '—' : `${r.percentage}% ${r.letter}`}</td>
                </tr>
              ))}
              {book.rows.length === 0 && (
                <tr>
                  <td colSpan={book.assignments.length + 3} className="py-6 text-center text-slate-500">
                    No students enrolled.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
