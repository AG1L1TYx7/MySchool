'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CountUp, MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { downloadCsv, todayIso, type TakenStatus } from '@/lib/school';

/** The office view of attendance (docs/13 section 5): which classes still owe today's attendance, and the state exports. */
export default function AttendanceTodayPage() {
  const { user, can } = useAuth();
  const allowed = can('attendance.view') && !!user?.organizationId;
  const [date, setDate] = useState(todayIso());
  const [status, setStatus] = useState<TakenStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState({ from: `${todayIso().slice(0, 4)}-08-01`, to: todayIso() });
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user?.organizationId) return;
    try {
      setStatus(await api<TakenStatus>(`/organizations/${user.organizationId}/attendance/status?date=${date}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [user?.organizationId, date]);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  async function exportCsv(type: 'ada' | 'chronic') {
    if (!user?.organizationId) return;
    setBusy(type);
    try {
      await downloadCsv(`/organizations/${user.organizationId}/attendance/export?from=${range.from}&to=${range.to}&type=${type}`, `${type === 'ada' ? 'average-daily-attendance' : 'chronic-absenteeism'}-${range.from}-to-${range.to}.csv`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  if (!allowed) return <NotForYou what="the attendance office view" back="/dashboard" alt={{ href: '/grades', label: 'your attendance and grades' }} />;
  const total = status ? status.taken.length + status.missing.length : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Attendance today</h1>
        <p className="text-sm text-slate-500">
          Which classes have taken attendance{status?.deadline ? `, due by ${status.deadline} each school day` : ''}.
        </p>
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="max-w-xs">
        <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </div>

      {!status && !error && <SkeletonRows rows={4} />}
      {status && (
        <div className="grid gap-6 md:grid-cols-2">
          <Card title="Not yet taken" description={total === 0 ? 'No classes meet on this date.' : status.missing.length === 0 ? 'Every class is in. Thank you.' : `${status.missing.length} of ${total} classes still owe attendance.`}>
            <p className="mb-3 text-3xl font-semibold text-slate-900">
              <CountUp value={status.missing.length} />
            </p>
            <MotionList className="divide-y divide-slate-100">
              {status.missing.map((c) => (
                <MotionItem key={c.classId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <Link href={`/classes/${c.classId}/attendance`} className="font-medium text-slate-900 hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {c.period ? `Period ${c.period} · ` : ''}
                      {c.teachers.join(', ') || 'No teacher assigned'} · {c.enrolled} students
                    </p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">Open</span>
                </MotionItem>
              ))}
            </MotionList>
          </Card>
          <Card title="Taken" description={`${status.taken.length} of ${total} classes.`}>
            <p className="mb-3 text-3xl font-semibold text-green-700">
              <CountUp value={status.taken.length} />
            </p>
            <MotionList className="divide-y divide-slate-100">
              {status.taken.map((c) => (
                <MotionItem key={c.classId} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <div>
                    <Link href={`/classes/${c.classId}/attendance`} className="font-medium text-slate-900 hover:underline">
                      {c.name}
                    </Link>
                    <p className="text-xs text-slate-500">
                      {c.period ? `Period ${c.period} · ` : ''}
                      {c.marked} of {c.enrolled} marked
                    </p>
                  </div>
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">Done</span>
                </MotionItem>
              ))}
            </MotionList>
          </Card>
        </div>
      )}

      {can('attendance.report') && (
        <Card title="State reports" description="Average daily attendance per student, and the chronic absenteeism list (students missing 10% or more of enrolled days).">
          <div className="flex flex-wrap items-end gap-3">
            <Input label="From" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
            <Input label="To" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
            <Button variant="secondary" loading={busy === 'ada'} onClick={() => void exportCsv('ada')}>
              Download ADA (CSV)
            </Button>
            <Button variant="secondary" loading={busy === 'chronic'} onClick={() => void exportCsv('chronic')}>
              Download chronic absenteeism (CSV)
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
