'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { CountUp, MotionItem, MotionList, ProgressBar, ProgressRing, SkeletonRows } from '@/components/motion';
import { Button, Card } from '@/components/ui';
import { api, download, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { FLAG_LABELS, flagClass, type Overview, type StudentInsight } from '@/lib/insight';
import { todayIso } from '@/lib/school';

/** Bars drawn to scale: the widest bar is the largest value. */
export function Bars({ rows, tone = 'brand', suffix = '' }: { rows: Array<{ label: string; value: number; hint?: string }>; tone?: 'brand' | 'amber' | 'green' | 'red'; suffix?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const color = tone === 'amber' ? 'bg-amber-400' : tone === 'green' ? 'bg-green-500' : tone === 'red' ? 'bg-red-400' : 'bg-brand-500';
  if (rows.length === 0) return <p className="text-sm text-slate-500">Nothing to show.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-slate-800" title={r.hint ?? r.label}>
              {r.label}
            </span>
            <span className="font-medium tabular-nums text-slate-900">
              {r.value}
              {suffix}
            </span>
          </div>
          <div className="h-2 rounded-full bg-slate-100" role="img" aria-label={`${r.label}: ${r.value}${suffix}`}>
            <div className={`h-2 rounded-full ${color}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function FlagPills({ flags }: { flags: Array<'failing' | 'missing_work' | 'attendance'> }) {
  if (flags.length === 0) return <span className="text-xs text-slate-500">On track</span>;
  return (
    <span className="flex flex-wrap gap-1">
      {flags.map((f) => (
        <span key={f} className={`rounded-full px-2 py-0.5 text-xs ${flagClass(f)}`}>
          {FLAG_LABELS[f]}
        </span>
      ))}
    </span>
  );
}

/** The principal's dashboard card: today's attendance, missing work, failing students and gradebook completeness at a glance. */
export function SchoolTodayCard() {
  const { user, can } = useAuth();
  const [data, setData] = useState<Overview | null | undefined>(undefined);
  const admin = !!user && can('reports.view') && ['principal', 'superintendent', 'super_admin', 'counselor'].includes(user.role);
  useEffect(() => {
    if (!admin || !user?.organizationId) {
      setData(null);
      return;
    }
    api<Overview>(`/organizations/${user.organizationId}/insight/overview?date=${todayIso()}`)
      .then(setData)
      .catch(() => setData(null));
  }, [admin, user?.organizationId]);
  if (!admin || data === null) return null;
  if (data === undefined)
    return (
      <Card title="School today">
        <SkeletonRows rows={2} />
      </Card>
    );
  const tiles = [
    { label: 'Attendance taken', value: `${data.attendance.classesTaken} of ${data.attendance.classesMeeting}`, sub: data.attendance.rateToday === null ? 'no marks yet' : `${data.attendance.rateToday}% present` },
    { label: 'Missing work', value: String(data.missingWork.items), sub: `${data.missingWork.students} students, ${data.missingWork.windowDays} days` },
    { label: 'Failing a class', value: String(data.failing.students), sub: `below ${data.failing.threshold}%` },
    { label: 'Gradebooks complete', value: data.gradebook.average === null ? '—' : `${data.gradebook.average}%`, sub: `${data.gradebook.classes.length} classes` },
    { label: 'AI conversations', value: String(data.ai.conversations), sub: `${data.ai.refusals} refusals this week` },
  ];
  return (
    <Card title="School today" description="Attendance, missing work, failing students, gradebook completeness and AI use, from the records as they stand now." actions={<Link href="/insight" className="text-sm text-brand-700 hover:underline">Open insight</Link>}>
      <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
        {tiles.map((t) => (
          <li key={t.label} className="rounded-lg bg-slate-50 p-3 ring-1 ring-slate-200">
            <p className="text-xs uppercase tracking-wide text-slate-600">{t.label}</p>
            <p className="text-xl font-semibold text-slate-900">{t.value}</p>
            <p className="text-xs text-slate-600">{t.sub}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** One student's analytics for staff on the student page, with the transcript download. */
export function StudentInsightCard({ studentId }: { studentId: string }) {
  const { can } = useAuth();
  const [data, setData] = useState<StudentInsight | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const allowed = can('reports.view');
  useEffect(() => {
    if (!allowed) {
      setData(null);
      return;
    }
    api<StudentInsight>(`/students/${studentId}/insight`)
      .then(setData)
      .catch(() => setData(null));
  }, [allowed, studentId]);
  if (!allowed || data === null) return null;
  if (data === undefined)
    return (
      <Card title="Insight">
        <SkeletonRows rows={2} />
      </Card>
    );
  return (
    <Card
      title="Insight"
      description="Current grades, attendance over 90 days, missing work and weekly activity. Flags point at where a conversation might help."
      actions={
        <Button variant="secondary" onClick={() => download(`/students/${studentId}/transcript.pdf`, `transcript-${data.student.lastName}-${data.student.firstName}.pdf`).catch((e) => setError(errorMessage(e)))}>
          Download transcript (PDF)
        </Button>
      }
    >
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      <div className="mb-3">
        <FlagPills flags={data.flags} />
      </div>
      <div className="grid gap-6 md:grid-cols-3">
        <div className="flex flex-wrap gap-4">
          {data.attendance.rate !== null && <ProgressRing value={data.attendance.rate} size={84} stroke={9} label="Attendance" tone={data.attendance.rate >= 90 ? 'green' : data.attendance.rate >= 80 ? 'brand' : 'amber'} />}
          <div className="text-sm text-slate-700">
            <p>
              <span className="text-xl font-semibold text-slate-900">
                <CountUp value={data.missing.length} />
              </span>{' '}
              missing items
            </p>
            <p>{data.attendance.absences} absences · {data.attendance.tardies} tardies</p>
            <p>{data.lateSubmissions} late submissions (8 weeks)</p>
            <p>{data.ai.conversations30Days} AI conversations (30 days)</p>
            <p>
              {data.practice.reviews30Days} practice reviews{data.practice.masteryAverage !== null ? ` · mastery ${Math.round(data.practice.masteryAverage * 100)}%` : ''}
            </p>
          </div>
        </div>
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Current grades</p>
          <MotionList className="divide-y divide-slate-100">
            {data.classes.map((c) => (
              <MotionItem key={c.classId} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <Link href={`/classes/${c.classId}`} className="truncate text-slate-800 hover:underline">
                  {c.name}
                </Link>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${c.grade === null ? 'bg-slate-100 text-slate-600' : c.failing ? 'bg-red-50 text-red-800' : c.grade >= 90 ? 'bg-green-50 text-green-800' : 'bg-brand-50 text-brand-800'}`}>{c.grade === null ? 'no grade' : `${c.grade}%`}</span>
              </MotionItem>
            ))}
          </MotionList>
        </div>
        <div>
          <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Submissions per week</p>
          <Bars rows={data.weekly.submissions.map((w) => ({ label: w.weekStart.slice(5), value: w.count, hint: `Week of ${w.weekStart}` }))} />
        </div>
      </div>
      {data.missing.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">Missing work</p>
          <ul className="text-sm text-slate-700">
            {data.missing.slice(0, 6).map((m) => (
              <li key={m.assignmentId}>
                <Link href={`/assignments/${m.assignmentId}`} className="hover:underline">
                  {m.title}
                </Link>{' '}
                <span className="text-slate-500">· {m.className}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ProgressBar value={data.classes.filter((c) => c.grade !== null && !c.failing).length} max={Math.max(1, data.classes.length)} label="Classes passing" tone="green" />
    </Card>
  );
}

/** Family-facing: the transcript download in the family's language. */
export function TranscriptButton({ studentId, lastName }: { studentId: string; lastName: string }) {
  const { t } = useI18n();
  const [error, setError] = useState<string | null>(null);
  return (
    <span>
      <Button variant="secondary" onClick={() => download(`/students/${studentId}/transcript.pdf`, `transcript-${lastName}.pdf`).catch((e) => setError(errorMessage(e)))}>
        {t('fam.transcript')}
      </Button>
      {error && <span className="ml-2 text-xs text-red-700">{error}</span>}
    </span>
  );
}
