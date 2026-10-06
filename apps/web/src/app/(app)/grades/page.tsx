'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ProgressRing, SkeletonRows } from '@/components/motion';
import { AccommodationCard, BehaviorCard, ConsentCard } from '@/components/support-cards';
import { Alert, Card } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { fmtDate, type AttendanceCounts, type Grade } from '@/lib/academics';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { Paged, Student } from '@/lib/students';

export default function GradesPage() {
  const { user } = useAuth();
  const { t, n } = useI18n();
  const [grades, setGrades] = useState<Grade[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [attendance, setAttendance] = useState<Record<string, AttendanceCounts>>({});
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const learner = user?.role === 'student' || user?.role === 'parent';

  useEffect(() => {
    void (async () => {
      try {
        const g = await api<Paged<Grade>>('/grades?pageSize=200');
        setGrades(g.data);
        setLoaded(true);
        if (learner) {
          const mine = await api<{ data: Student[] }>('/students/mine');
          setStudents(mine.data);
          const summaries = await Promise.all(mine.data.map((s) => api<{ counts: AttendanceCounts }>(`/students/${s.id}/attendance/summary`).then((r) => [s.id, r.counts] as const).catch(() => null)));
          setAttendance(Object.fromEntries(summaries.filter((x): x is readonly [string, AttendanceCounts] => x !== null)));
        }
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, [learner]);

  const groups = new Map<string, Grade[]>();
  for (const g of grades) {
    const key = g.student ? `${g.student.lastName}, ${g.student.firstName}` : t('grades.me');
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">{t('grades.title')}</h1>
        <Link href="/report-cards" className="text-sm text-brand-700 underline">
          {t('grades.reportCards')}
        </Link>
      </div>
      {error && <Alert>{error}</Alert>}
      {learner &&
        students.map((s) => {
          const c = attendance[s.id];
          return (
            <Card key={s.id} title={`${s.firstName} ${s.lastName}`} description={c && c.total > 0 ? n('grades.summary', c.total, { absent: c.absent, late: c.late + c.tardy }) : t('grades.noAttendance')}>
              <div className="flex flex-wrap items-start gap-6">
                {c && c.total > 0 && c.attendanceRate !== null && <ProgressRing value={c.attendanceRate} size={88} stroke={9} label={t('grades.attendance')} tone={c.attendanceRate >= 90 ? 'green' : c.attendanceRate >= 80 ? 'brand' : 'amber'} />}
                {(() => {
                  const mine = grades.filter((g) => g.studentId === s.id);
                  const avg = mine.length ? mine.reduce((sum, g) => sum + g.percentage, 0) / mine.length : null;
                  return avg === null ? null : <ProgressRing value={avg} size={88} stroke={9} label={t('grades.average')} tone={avg >= 90 ? 'green' : avg >= 60 ? 'brand' : 'amber'} />;
                })()}
                <div className="min-w-[280px] flex-1">
                  <GradeTable rows={grades.filter((g) => g.studentId === s.id)} />
                </div>
              </div>
            </Card>
          );
        })}
      {learner &&
        students.map((s) => (
          <div key={`support-${s.id}`} className="space-y-6">
            {user?.role === 'parent' && <AccommodationCard studentId={s.id} />}
            <ConsentCard studentId={s.id} />
            <BehaviorCard studentId={s.id} />
          </div>
        ))}
      {!learner &&
        [...groups.entries()].map(([name, rows]) => (
          <Card key={name} title={name}>
            <GradeTable rows={rows} />
          </Card>
        ))}
      {grades.length === 0 && !error && (loaded ? <p className="text-sm text-slate-500">{t('grades.none')}</p> : <SkeletonRows rows={3} />)}
    </div>
  );
}

function GradeTable({ rows }: { rows: Grade[] }) {
  const t = useI18n().t;
  if (rows.length === 0) return <p className="text-sm text-slate-500">{t('grades.noneYet')}</p>;
  return (
    <table className="min-w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="py-2 pr-4">{t('grades.col.assignment')}</th>
          <th className="py-2 pr-4">{t('grades.col.class')}</th>
          <th className="py-2 pr-4">{t('grades.col.score')}</th>
          <th className="py-2 pr-4">{t('grades.col.graded')}</th>
          <th className="py-2">{t('grades.col.feedback')}</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {rows.map((g) => (
          <tr key={g.id}>
            <td className="py-2 pr-4 font-medium text-slate-800">
              <Link href={`/assignments/${g.assignmentId}`} className="hover:underline">
                {g.assignment?.title ?? g.assignmentId}
              </Link>
            </td>
            <td className="py-2 pr-4 text-slate-600">{g.assignment?.className ?? ''}</td>
            <td className="py-2 pr-4">
              {g.score}/{g.maxPoints} · {g.percentage}% {g.letterGrade}
            </td>
            <td className="py-2 pr-4 text-slate-600">{fmtDate(g.gradedAt)}</td>
            <td className="py-2 text-slate-600">{g.feedback ?? ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
