'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CountUp, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card } from '@/components/ui';
import { api, download, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cellText, type Gradebook } from '@/lib/gradebook';

export default function GradebookPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [book, setBook] = useState<Gradebook | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'points' | 'standards'>('points');

  const allowed = can('grades.view.all');
  useEffect(() => {
    if (!allowed) return;
    api<Gradebook>(`/classes/${id}/gradebook`)
      .then((b) => {
        setBook(b);
        setView(b.gradingMode === 'standards' && b.standards ? 'standards' : 'points');
      })
      .catch((err) => setError(errorMessage(err)));
  }, [id, allowed]);

  if (!allowed) return <NotForYou what="the class gradebook" back={`/classes/${id}`} alt={{ href: '/grades', label: 'your grades' }} />;
  if (error) return <Alert>{error}</Alert>;
  if (!book) return <SkeletonRows rows={5} />;

  const groups = book.mode === 'categories' ? [...book.categories.map((c) => ({ id: c.id, name: `${c.name} · ${c.weight}%${c.dropLowest ? ` · drops ${c.dropLowest}` : ''}`, assignments: book.assignments.filter((a) => a.categoryId === c.id) })), { id: '', name: 'Other', assignments: book.assignments.filter((a) => !a.categoryId) }].filter((g) => g.assignments.length > 0) : [{ id: '', name: 'Assignments', assignments: book.assignments }];
  const missingTotal = book.rows.reduce((s, r) => s + r.missing, 0);

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
          <p className="text-sm text-slate-500">
            Class average: {book.classAverage === null ? '—' : <CountUp value={book.classAverage} decimals={2} suffix="%" className="font-medium text-slate-800" />}
            {' · '}
            {book.mode === 'categories' ? 'weighted categories' : 'total points'}
            {missingTotal > 0 ? ` · ${missingTotal} missing` : ''}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {book.standards && (
            <div role="group" aria-label="View" className="flex rounded-md ring-1 ring-slate-300">
              <button type="button" aria-pressed={view === 'points'} className={`px-3 py-1.5 text-sm ${view === 'points' ? 'bg-brand-600 text-white' : 'bg-white text-slate-700'} rounded-l-md`} onClick={() => setView('points')}>
                Points
              </button>
              <button type="button" aria-pressed={view === 'standards'} className={`px-3 py-1.5 text-sm ${view === 'standards' ? 'bg-brand-600 text-white' : 'bg-white text-slate-700'} rounded-r-md`} onClick={() => setView('standards')}>
                Standards
              </button>
            </div>
          )}
          {can('grades.export') && (
            <Button variant="secondary" onClick={() => void download(`/classes/${id}/gradebook/export`, `gradebook-${book.className}.csv`)}>
              Export CSV
            </Button>
          )}
        </div>
      </div>

      {view === 'standards' && book.standards ? (
        <Card title="Proficiency by standard" description={`Latest level per standard on the ${book.standards.levels.map((l) => `${l.level} ${l.label}`).join(', ')} scale.`}>
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="sticky left-0 bg-white py-2 pr-4">Student</th>
                  {book.standards.standards.map((s) => (
                    <th key={s.id} className="py-2 pr-4 font-mono font-normal normal-case" title={s.description}>
                      {s.code}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {book.rows.map((r) => {
                  const levels = book.standards?.rows.find((x) => x.studentId === r.student.id)?.levels ?? {};
                  return (
                    <tr key={r.student.id}>
                      <td className="sticky left-0 bg-white py-2 pr-4 font-medium text-slate-800">
                        {r.student.lastName}, {r.student.firstName}
                      </td>
                      {book.standards?.standards.map((s) => {
                        const lv = levels[s.id];
                        const max = Math.max(...(book.standards?.levels.map((l) => l.level) ?? [4]));
                        return (
                          <td key={s.id} className="py-2 pr-4">
                            {lv && lv.latest !== null ? (
                              <span className={`rounded-full px-2 py-0.5 text-xs ${lv.latest >= max ? 'bg-green-100 text-green-800' : lv.latest >= max - 1 ? 'bg-brand-100 text-brand-800' : 'bg-amber-100 text-amber-900'}`} title={`best ${lv.best}, ${lv.attempts} attempt${lv.attempts === 1 ? '' : 's'}`}>
                                {lv.latest} {lv.label}
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <Card description="M = missing (counts as 0), EX = excused (left out), I = incomplete. Struck-through scores are dropped as the lowest in their category; + marks extra credit.">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                {book.mode === 'categories' && (
                  <tr>
                    <td className="sticky left-0 bg-white" />
                    {groups.map((g) => (
                      <th key={g.id || 'other'} colSpan={g.assignments.length} className="border-b border-slate-200 py-1 pr-4 text-brand-800">
                        {g.name}
                      </th>
                    ))}
                    <td colSpan={book.categories.length + 2} />
                  </tr>
                )}
                <tr>
                  <th className="sticky left-0 bg-white py-2 pr-4">Student</th>
                  {groups.flatMap((g) =>
                    g.assignments.map((a) => (
                      <th key={a.id} className="py-2 pr-4 font-normal">
                        <Link href={`/assignments/${a.id}`} className="hover:underline">
                          {a.title}
                        </Link>
                        <div className="text-[11px] normal-case text-slate-600">
                          /{a.maxPoints}
                          {a.isExtraCredit ? ' +' : ''} · avg {book.perAssignmentAverage[a.id] ?? '—'}
                        </div>
                      </th>
                    )),
                  )}
                  {book.mode === 'categories' && book.categories.map((c) => <th key={c.id} className="py-2 pr-4">{c.name} %</th>)}
                  <th className="py-2 pr-4">Missing</th>
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
                    {groups.flatMap((g) =>
                      g.assignments.map((a) => {
                        const c = r.cells[a.id];
                        const text = cellText(c);
                        const low = c?.percentage !== null && c?.percentage !== undefined && c.percentage < 60;
                        return (
                          <td key={a.id} className={`py-2 pr-4 tabular-nums ${c?.mark === 'missing' ? 'font-medium text-red-700' : low ? 'text-red-700' : ''} ${c?.dropped ? 'line-through text-slate-400' : ''}`} title={c?.dropped ? 'Dropped as the lowest in its category' : c?.mark === 'excused' ? 'Excused' : undefined}>
                            {text || <span className="text-slate-300">—</span>}
                            {c?.extraCredit && text ? <span className="text-xs text-green-700">+</span> : null}
                          </td>
                        );
                      }),
                    )}
                    {book.mode === 'categories' &&
                      book.categories.map((c) => {
                        const t = r.categories.find((x) => x.categoryId === c.id);
                        return (
                          <td key={c.id} className="py-2 pr-4 tabular-nums text-slate-700">
                            {t?.percentage ?? '—'}
                          </td>
                        );
                      })}
                    <td className={`py-2 pr-4 tabular-nums ${r.missing ? 'text-red-700' : 'text-slate-500'}`}>{r.missing}</td>
                    <td className="py-2 font-medium tabular-nums">{r.percentage === null ? '—' : `${r.percentage}% ${r.letter}`}</td>
                  </tr>
                ))}
                {book.rows.length === 0 && (
                  <tr>
                    <td colSpan={book.assignments.length + book.categories.length + 3} className="py-6 text-center text-slate-500">
                      No students enrolled.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
