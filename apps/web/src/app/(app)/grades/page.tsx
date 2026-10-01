'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ProgressRing, SkeletonRows } from '@/components/motion';
import { Alert, Card } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { fmtDate, type AttendanceCounts, type Grade } from '@/lib/academics';
import { useAuth } from '@/lib/auth';
import type { Paged, Student } from '@/lib/students';

export default function GradesPage() {
  const { user } = useAuth();
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
    const key = g.student ? `${g.student.lastName}, ${g.student.firstName}` : 'Me';
    groups.set(key, [...(groups.get(key) ?? []), g]);
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">Grades</h1>
      {error && <Alert>{error}</Alert>}
      {learner &&
        students.map((s) => {
          const c = attendance[s.id];
          return (
            <Card key={s.id} title={`${s.firstName} ${s.lastName}`} description={c && c.total > 0 ? `${c.total} recorded day${c.total === 1 ? '' : 's'}: ${c.absent} absent, ${c.late + c.tardy} late` : 'No attendance recorded yet.'}>
              <div className="flex flex-wrap items-start gap-6">
                {c && c.total > 0 && c.attendanceRate !== null && <ProgressRing value={c.attendanceRate} size={88} stroke={9} label="Attendance" tone={c.attendanceRate >= 90 ? 'green' : c.attendanceRate >= 80 ? 'brand' : 'amber'} />}
                {(() => {
                  const mine = grades.filter((g) => g.studentId === s.id);
                  const avg = mine.length ? mine.reduce((sum, g) => sum + g.percentage, 0) / mine.length : null;
                  return avg === null ? null : <ProgressRing value={avg} size={88} stroke={9} label="Average" tone={avg >= 90 ? 'green' : avg >= 60 ? 'brand' : 'amber'} />;
                })()}
                <div className="min-w-[280px] flex-1">
                  <GradeTable rows={grades.filter((g) => g.studentId === s.id)} />
                </div>
              </div>
            </Card>
          );
        })}
      {!learner &&
        [...groups.entries()].map(([name, rows]) => (
          <Card key={name} title={name}>
            <GradeTable rows={rows} />
          </Card>
        ))}
      {grades.length === 0 && !error && (loaded ? <p className="text-sm text-slate-500">No grades posted yet.</p> : <SkeletonRows rows={3} />)}
    </div>
  );
}

function GradeTable({ rows }: { rows: Grade[] }) {
  if (rows.length === 0) return <p className="text-sm text-slate-500">No grades yet.</p>;
  return (
    <table className="min-w-full text-sm">
      <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
        <tr>
          <th className="py-2 pr-4">Assignment</th>
          <th className="py-2 pr-4">Class</th>
          <th className="py-2 pr-4">Score</th>
          <th className="py-2 pr-4">Graded</th>
          <th className="py-2">Feedback</th>
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
