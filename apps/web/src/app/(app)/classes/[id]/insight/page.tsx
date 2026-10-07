'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Bars, FlagPills } from '@/components/insight-cards';
import { MotionItem, MotionList, ProgressRing, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ClassInsight } from '@/lib/insight';
import { downloadCsv, todayIso } from '@/lib/school';

/** One class, one picture (docs/02 section 16): distribution, attendance, missing work, at-risk list, assignment averages. */
export default function ClassInsightPage() {
  const { id } = useParams<{ id: string }>();
  const { user, can } = useAuth();
  const [data, setData] = useState<ClassInsight | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allowed = can('reports.view');
  useEffect(() => {
    if (!allowed) return;
    api<ClassInsight>(`/classes/${id}/insight`)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [allowed, id]);
  if (!allowed) return <NotForYou what="class insight" back={`/classes/${id}`} />;
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <SkeletonRows rows={4} />;
  const orgId = user?.organizationId ?? '';
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-slate-500">
            <Link href={`/classes/${id}`} className="hover:underline">
              {data.class.name}
            </Link>
          </p>
          <h1 className="text-2xl font-semibold">Class insight</h1>
          <p className="mt-1 text-sm text-slate-500">{data.students} enrolled. Grades are the current gradebook; attendance and missing work cover the last 30 and 14 days.</p>
        </div>
        <Button variant="secondary" onClick={() => void downloadCsv(`/organizations/${orgId}/insight/reports/class_summary.csv?classId=${id}`, `class-summary-${todayIso()}.csv`).catch((e) => setError(errorMessage(e)))}>
          Download CSV
        </Button>
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        <Card title="Grade distribution" description={data.average === null ? 'No grades yet.' : `Class average ${data.average}%.`}>
          <Bars rows={data.distribution.map((d) => ({ label: d.label, value: d.count }))} />
        </Card>
        <Card title="Attendance (30 days)">
          {data.attendanceRate30Days === null ? <p className="text-sm text-slate-500">No attendance taken yet.</p> : <ProgressRing value={data.attendanceRate30Days} size={110} stroke={11} label="Present" tone={data.attendanceRate30Days >= 90 ? 'green' : data.attendanceRate30Days >= 80 ? 'brand' : 'amber'} />}
        </Card>
        <Card title="Missing work (14 days)">
          <p className="text-3xl font-semibold text-slate-900">{data.missingItems}</p>
          <p className="text-sm text-slate-600">items across {data.atRisk.filter((s) => s.flags.includes('missing_work')).length} flagged students</p>
        </Card>
      </div>
      <Card title="Who needs a conversation" description="Failing, three or more missing items, or attendance under 90%. Alphabetical, never ranked.">
        {data.atRisk.length === 0 ? (
          <p className="text-sm text-slate-500">Nobody is flagged right now.</p>
        ) : (
          <MotionList className="divide-y divide-slate-100">
            {data.atRisk.map((s) => (
              <MotionItem key={s.studentId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <Link href={`/students/${s.studentId}`} className="font-medium text-slate-900 hover:underline">
                  {s.name}
                </Link>
                <span className="text-xs text-slate-600">
                  {s.grade === null ? 'no grade' : `${s.grade}%`} · {s.attendanceRate === null ? 'no attendance' : `${s.attendanceRate}% present`} · {s.missing} missing
                </span>
                <FlagPills flags={s.flags} />
              </MotionItem>
            ))}
          </MotionList>
        )}
      </Card>
      <Card title="Recent assignments" description="Average of posted grades on the last twelve assignments past due.">
        {data.assignments.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing past due yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-1">Assignment</th>
                <th className="py-1 text-right">Submitted</th>
                <th className="py-1 text-right">Graded</th>
                <th className="py-1 text-right">Average</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {data.assignments.map((a) => (
                <tr key={a.id}>
                  <td className="py-1.5">
                    <Link href={`/assignments/${a.id}`} className="hover:underline">
                      {a.title}
                    </Link>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{a.submitted}</td>
                  <td className="py-1.5 text-right tabular-nums">{a.graded}</td>
                  <td className={`py-1.5 text-right tabular-nums ${a.average !== null && a.average < 60 ? 'text-red-700' : ''}`}>{a.average === null ? '—' : `${a.average}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
      <Card title="Roster">
        <MotionList className="divide-y divide-slate-100">
          {data.roster.map((s) => (
            <MotionItem key={s.studentId} className="flex flex-wrap items-center justify-between gap-2 py-1.5 text-sm">
              <Link href={`/students/${s.studentId}`} className="text-slate-800 hover:underline">
                {s.name}
              </Link>
              <span className="text-xs text-slate-600">
                {s.grade === null ? 'no grade' : `${s.grade}%`} · {s.attendanceRate === null ? '—' : `${s.attendanceRate}%`} · {s.missing} missing
              </span>
            </MotionItem>
          ))}
        </MotionList>
      </Card>
    </div>
  );
}
