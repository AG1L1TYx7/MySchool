'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MotionItem, MotionList, ProgressRing, SkeletonRows } from '@/components/motion';
import { Alert, Card } from '@/components/ui';
import { api } from '@/lib/api';
import { ROLE_LABELS, useAuth } from '@/lib/auth';
import type { ClassItem } from '@/lib/curriculum';
import { label } from '@/lib/students';

interface WeekAssignment {
  id: string;
  title: string;
  className: string;
  dueAt: string | null;
  mySubmission?: { status: string } | null;
  myGrade?: { score: number; maxPoints: number; percentage: number } | null;
}

/** Real progress, animated: assignments handled this week and attendance for students and parents. */
function ThisWeek() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<WeekAssignment[] | null>(null);
  const [attendance, setAttendance] = useState<{ attendanceRate: number | null; total: number } | null>(null);
  const learner = user?.role === 'student' || user?.role === 'parent';

  useEffect(() => {
    if (!learner) return;
    const now = new Date();
    const inWeek = new Date(now.getTime() + 7 * 86_400_000);
    api<{ data: WeekAssignment[] }>(`/assignments?pageSize=100&dueAfter=${new Date(now.getTime() - 14 * 86_400_000).toISOString()}&dueBefore=${inWeek.toISOString()}`)
      .then((r) => setAssignments(r.data))
      .catch(() => setAssignments([]));
    api<{ data: Array<{ id: string }> }>('/students/mine')
      .then((r) => (r.data[0] ? api<{ counts: { attendanceRate: number | null; total: number } }>(`/students/${r.data[0].id}/attendance/summary`) : null))
      .then((s) => setAttendance(s ? s.counts : null))
      .catch(() => setAttendance(null));
  }, [learner]);

  if (!learner) return null;
  if (assignments === null) {
    return (
      <Card title="This week">
        <SkeletonRows rows={2} />
      </Card>
    );
  }
  const handled = assignments.filter((a) => a.mySubmission || a.myGrade).length;
  const total = assignments.length;
  const next = assignments.filter((a) => !a.mySubmission && !a.myGrade && a.dueAt).sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))[0];

  return (
    <Card title="This week" description={total === 0 ? 'Nothing due in the next seven days. Nice.' : `${handled} of ${total} assignments handled.`}>
      <div className="flex flex-wrap items-center gap-8">
        <ProgressRing value={total === 0 ? 100 : handled} max={total === 0 ? 100 : total} label="Assignments" tone={total > 0 && handled === total ? 'green' : 'brand'} />
        {attendance && attendance.total > 0 && attendance.attendanceRate !== null && (
          <ProgressRing value={attendance.attendanceRate} label="Attendance" tone={attendance.attendanceRate >= 90 ? 'green' : attendance.attendanceRate >= 80 ? 'brand' : 'amber'} />
        )}
        <div className="min-w-[200px] flex-1 text-sm">
          {next ? (
            <>
              <p className="text-xs uppercase tracking-wide text-slate-500">Next up</p>
              <Link href={`/assignments/${next.id}`} className="font-medium text-slate-900 hover:underline">
                {next.title}
              </Link>
              <p className="text-slate-500">
                {next.className} · due {new Date(next.dueAt as string).toLocaleDateString()}
              </p>
            </>
          ) : (
            <p className="text-slate-600">Everything due soon is in. Keep the streak going tomorrow.</p>
          )}
        </div>
      </div>
    </Card>
  );
}

function MyClasses() {
  const [classes, setClasses] = useState<ClassItem[] | null>(null);
  useEffect(() => {
    api<{ data: ClassItem[] }>('/classes/mine')
      .then((r) => setClasses(r.data))
      .catch(() => setClasses([]));
  }, []);
  if (!classes || classes.length === 0) return null;
  return (
    <Card title="My classes" description="Classes you teach or attend this term.">
      <MotionList className="grid gap-3 md:grid-cols-2">
        {classes.map((c) => (
          <MotionItem key={c.id}>
            <Link href={`/classes/${c.id}`} className="block rounded-lg bg-slate-50 px-4 py-3 transition-colors duration-150 hover:bg-brand-50">
              <p className="font-medium text-slate-900">{c.name}</p>
              <p className="text-xs text-slate-500">
                {c.course.courseCode} · {c.course.title} · {c.term}
                {c.myEnrollmentStatus ? ` · ${label(c.myEnrollmentStatus)}` : ''}
                {c.teachers[0] ? ` · ${c.teachers[0].firstName} ${c.teachers[0].lastName}` : ''}
              </p>
            </Link>
          </MotionItem>
        ))}
      </MotionList>
    </Card>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  if (!user) return null;
  const categories = new Map<string, number>();
  for (const code of user.features) {
    const cat = code.split('.')[0];
    categories.set(cat, (categories.get(cat) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Good to see you, {user.firstName}</h1>
        <p className="mt-1 text-sm text-slate-500">
          Signed in as {ROLE_LABELS[user.role] ?? user.role}
          {user.lastLoginAt ? ` · last sign-in ${new Date(user.lastLoginAt).toLocaleString()}` : ''}
        </p>
      </div>

      {!user.twoFactorEnabled && (
        <Alert kind="info">
          Protect your account with two-factor authentication.{' '}
          <Link href="/settings/security" className="font-medium underline">
            Set it up now
          </Link>
          .
        </Alert>
      )}

      <ThisWeek />
      <MyClasses />

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Your access" description="What this account can do, from your role and any individual overrides.">
          <ul className="grid grid-cols-2 gap-2 text-sm">
            {Array.from(categories.entries()).sort().map(([cat, n]) => (
              <li key={cat} className="flex justify-between rounded-md bg-slate-50 px-3 py-2">
                <span className="capitalize text-slate-700">{cat.replace(/-/g, ' ')}</span>
                <span className="font-medium text-slate-900">{n}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Coming next" description="Release 1 builds out these areas slice by slice.">
          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>Courses, modules and lessons</li>
            <li>Classes, rosters and attendance</li>
            <li>Assignments, submissions and grading</li>
            <li>AI tutor and content generation</li>
            <li>Messaging, announcements and notifications</li>
          </ol>
        </Card>
      </div>
    </div>
  );
}
