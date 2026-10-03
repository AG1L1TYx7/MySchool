'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { ProgressRing, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card } from '@/components/ui';
import { api, download, errorMessage } from '@/lib/api';
import { kindLabel, type ReportCard } from '@/lib/gradebook';

export default function ReportCardPage() {
  const { id } = useParams<{ id: string }>();
  const [card, setCard] = useState<ReportCard | null>(null);
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      const c = await api<ReportCard>(`/report-cards/${id}`);
      setCard(c);
      setDrafts(Object.fromEntries(c.lines.map((l) => [l.id, l.comment ?? ''])));
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  if (!card) return state.error ? <Alert>{state.error}</Alert> : <SkeletonRows rows={5} />;

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

  return (
    <div className="mx-auto max-w-4xl space-y-6 print:max-w-none">
      <div className="flex flex-wrap items-start justify-between gap-3 print:hidden">
        <div>
          <p className="text-sm text-slate-500">
            <Link href="/report-cards" className="hover:underline">
              Report cards
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">
            {card.student.firstName} {card.student.lastName} · {kindLabel(card.kind)}
          </h1>
          <p className="text-sm text-slate-500">
            {card.gradingPeriod.yearName} · {card.gradingPeriod.termName} · {card.gradingPeriod.name} ({card.gradingPeriod.startDate} to {card.gradingPeriod.endDate}) ·{' '}
            <span className={card.status === 'published' ? 'text-green-700' : 'text-amber-700'}>{card.status === 'published' ? `Published ${card.publishedAt ? new Date(card.publishedAt).toLocaleDateString() : ''}` : 'Draft'}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void download(`/report-cards/${id}/pdf`, `report-card-${card.student.lastName}-${card.gradingPeriod.name}.pdf`)}>
            Download PDF
          </Button>
          <Button variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
          {card.canPublish && card.status === 'draft' && (
            <Button loading={state.busy} onClick={() => void run(() => api(`/report-cards/${id}/publish`, { method: 'POST' }), 'Published. The student and parents have been told.')}>
              Publish
            </Button>
          )}
        </div>
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}

      <div className="hidden print:block">
        <h1 className="text-xl font-semibold">
          {kindLabel(card.kind)} · {card.student.lastName}, {card.student.firstName} ({card.student.studentNumber})
        </h1>
        <p className="text-sm">
          {card.gradingPeriod.yearName} · {card.gradingPeriod.termName} · {card.gradingPeriod.name}
        </p>
      </div>

      <Card>
        <div className="flex flex-wrap items-center gap-8">
          {card.gpa !== null && <ProgressRing value={card.gpa} max={4} label="GPA" suffix="" />}
          {card.attendance && card.attendance.rate !== null && <ProgressRing value={card.attendance.rate} label="Attendance" tone={card.attendance.rate >= 90 ? 'green' : card.attendance.rate >= 80 ? 'brand' : 'amber'} />}
          <div className="text-sm text-slate-700">
            {card.gpa !== null && <p>GPA this period: {card.gpa.toFixed(2)}</p>}
            {card.attendance ? (
              <p>
                {card.attendance.daysPresent} days present · {card.attendance.daysAbsent} absent · {card.attendance.tardies} tardy
              </p>
            ) : (
              <p>No attendance recorded in this period.</p>
            )}
            {card.student.gradeLevel && <p>Grade {card.student.gradeLevel}</p>}
          </div>
        </div>
      </Card>

      {card.lines.map((l) => (
        <Card key={l.id} title={l.className} description={`${l.courseTitle}${l.teacherName ? ` · ${l.teacherName}` : ''}`}>
          <div className="flex flex-wrap items-start gap-6">
            <div className="min-w-[120px]">
              <p className="text-3xl font-semibold tabular-nums text-slate-900">{l.letter ?? '—'}</p>
              <p className="text-sm text-slate-500">
                {l.percentage === null ? 'No grades yet' : `${l.percentage}%`}
                {l.gpaPoints !== null ? ` · ${l.gpaPoints} GPA points` : ''}
              </p>
            </div>
            <div className="min-w-0 flex-1 space-y-2 text-sm">
              {l.categories.length > 0 && (
                <ul className="flex flex-wrap gap-2">
                  {l.categories.map((c) => (
                    <li key={c.name} className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                      {c.name} {c.percentage === null ? '—' : `${c.percentage}%`} ({c.weight}%)
                    </li>
                  ))}
                </ul>
              )}
              {l.standards.length > 0 && (
                <ul className="divide-y divide-slate-100">
                  {l.standards.map((s) => (
                    <li key={s.code} className="flex flex-wrap items-center justify-between gap-2 py-1">
                      <span className="min-w-0 flex-1">
                        <span className="font-mono text-xs text-slate-600">{s.code}</span> <span className="text-slate-700">{s.description}</span>
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs ${s.level === null ? 'bg-slate-100 text-slate-500' : 'bg-brand-100 text-brand-800'}`}>{s.label ?? 'Not yet assessed'}</span>
                    </li>
                  ))}
                </ul>
              )}
              {l.canComment && card.status === 'draft' ? (
                <label className="block print:hidden">
                  <span className="mb-1 block text-xs font-medium text-slate-700">Teacher comment</span>
                  <textarea className="block w-full rounded-md border-0 px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300" rows={3} value={drafts[l.id] ?? ''} onChange={(e) => setDrafts({ ...drafts, [l.id]: e.target.value })} />
                  <Button className="mt-2" variant="secondary" loading={state.busy} disabled={(drafts[l.id] ?? '') === (l.comment ?? '')} onClick={() => void run(() => api(`/report-cards/${id}/lines/${l.id}`, { method: 'PATCH', body: { comment: drafts[l.id] ?? '' } }), 'Comment saved.')}>
                    Save comment
                  </Button>
                </label>
              ) : null}
              {l.comment && (card.status === 'published' || !l.canComment) && <p className="whitespace-pre-wrap text-slate-800">{l.comment}</p>}
              {l.comment && l.canComment && card.status === 'draft' && <p className="hidden whitespace-pre-wrap text-slate-800 print:block">{l.comment}</p>}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}
