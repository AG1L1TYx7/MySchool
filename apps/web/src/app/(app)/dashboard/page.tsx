'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { MotionItem, MotionList, ProgressRing, SkeletonRows } from '@/components/motion';
import { AnnouncementCard } from '@/components/announcement-card';
import { Alert, Card } from '@/components/ui';
import { api } from '@/lib/api';
import { ROLE_LABELS, useAuth } from '@/lib/auth';
import type { Announcement } from '@/lib/communication';
import type { ClassItem } from '@/lib/curriculum';
import { todayIso, type TakenStatus } from '@/lib/school';
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

/** For the office and teachers: classes meeting today that have not taken attendance yet (docs/13 section 5). */
function AttendanceOwed() {
  const { user, can } = useAuth();
  const [status, setStatus] = useState<TakenStatus | null>(null);
  const orgId = user?.organizationId;
  const allowed = can('attendance.view') && !!orgId;
  useEffect(() => {
    if (!allowed) return;
    api<TakenStatus>(`/organizations/${orgId}/attendance/status?date=${todayIso()}`)
      .then(setStatus)
      .catch(() => setStatus(null));
  }, [allowed, orgId]);
  if (!allowed || !status || status.taken.length + status.missing.length === 0) return null;
  const done = status.missing.length === 0;
  return (
    <Card title="Attendance today" description={done ? 'Every class that meets today has taken attendance.' : `${status.missing.length} class${status.missing.length === 1 ? '' : 'es'} still owe attendance${status.deadline ? ` (due by ${status.deadline})` : ''}.`} actions={<Link href="/attendance/today" className="text-sm text-brand-700 hover:underline">Office view</Link>}>
      <div className="flex flex-wrap items-center gap-6">
        <ProgressRing value={status.taken.length} max={status.taken.length + status.missing.length} label="Classes done" suffix="" tone={done ? 'green' : 'amber'} />
        <ul className="min-w-0 flex-1 space-y-1 text-sm">
          {status.missing.slice(0, 4).map((c) => (
            <li key={c.classId}>
              <Link href={`/classes/${c.classId}/attendance`} className="font-medium text-slate-900 hover:underline">
                {c.name}
              </Link>
              <span className="text-slate-500">{c.period ? ` · period ${c.period}` : ''}</span>
            </li>
          ))}
          {status.missing.length > 4 && <li className="text-slate-500">and {status.missing.length - 4} more</li>}
        </ul>
      </div>
    </Card>
  );
}

function LatestAnnouncements() {
  const [rows, setRows] = useState<Announcement[] | null>(null);
  useEffect(() => {
    api<{ data: Announcement[] }>('/announcements?pageSize=3')
      .then((r) => setRows(r.data))
      .catch(() => setRows([]));
  }, []);
  if (!rows || rows.length === 0) return null;
  return (
    <Card title="Announcements" description="Latest from your school and classes." actions={<Link href="/announcements" className="text-sm text-brand-700 hover:underline">All</Link>}>
      <MotionList as="div" className="space-y-3">
        {rows.map((a) => (
          <MotionItem as="div" key={a.id}>
            <AnnouncementCard a={a} compact />
          </MotionItem>
        ))}
      </MotionList>
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
      <AttendanceOwed />
      <LatestAnnouncements />
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
        <Card title="Around the school" description="Quick links for the week.">
          <ul className="space-y-1 text-sm">
            <li>
              <Link href="/calendar" className="text-brand-700 underline">
                School calendar
              </Link>
              <span className="text-slate-500"> · days off, events, due dates and term boundaries</span>
            </li>
            <li>
              <Link href="/announcements" className="text-brand-700 underline">
                Announcements
              </Link>
              <span className="text-slate-500"> · from the school and your classes</span>
            </li>
            <li>
              <Link href="/messages" className="text-brand-700 underline">
                Messages
              </Link>
              <span className="text-slate-500"> · reach teachers and the office</span>
            </li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
