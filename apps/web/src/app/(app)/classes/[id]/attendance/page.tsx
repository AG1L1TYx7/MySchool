'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { PillGroup, ProgressBar, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { ATTENDANCE_STATUSES, type AttendanceCounts, type AttendanceRecord } from '@/lib/academics';
import type { ClassItem, Enrollment } from '@/lib/curriculum';
import { periodLabel, type AttendanceCode, type SchoolStructure } from '@/lib/school';
import { label } from '@/lib/students';

interface Summary {
  className: string;
  daysRecorded: number;
  classAttendanceRate: number | null;
  rows: Array<{ student: { id: string; studentNumber: string; firstName: string; lastName: string }; counts: AttendanceCounts }>;
}

export default function AttendancePage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const allowed = can('attendance.view');
  const [klass, setKlass] = useState<ClassItem | null>(null);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [roster, setRoster] = useState<Enrollment[]>([]);
  const [marks, setMarks] = useState<Record<string, { status: string; notes: string }>>({});
  const [codes, setCodes] = useState<AttendanceCode[]>([]);
  const [periods, setPeriods] = useState<SchoolStructure['bellSchedules']>([]);
  const [periodId, setPeriodId] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});

  const load = useCallback(async () => {
    try {
      const [k, r, existing, s] = await Promise.all([
        api<ClassItem>(`/classes/${id}`),
        api<{ data: Enrollment[] }>(`/classes/${id}/enrollments`),
        api<{ data: AttendanceRecord[] }>(`/attendance?classId=${id}&date=${date}&pageSize=200`),
        api<Summary>(`/classes/${id}/attendance/summary`),
      ]);
      setKlass(k);
      const structure = await api<SchoolStructure>(`/organizations/${k.organizationId}/structure`).catch(() => null);
      const active = (structure?.attendanceCodes ?? []).filter((c) => c.isActive);
      setCodes(active);
      setPeriods(structure?.bellSchedules ?? []);
      setPeriodId((p) => p || existing.data[0]?.period?.id || k.periodId || '');
      const enrolled = r.data.filter((e) => e.status === 'enrolled');
      setRoster(enrolled);
      const next: Record<string, { status: string; notes: string }> = {};
      for (const e of enrolled) {
        const rec = existing.data.find((x) => x.studentId === e.studentId);
        next[e.studentId] = { status: rec?.code?.id ?? rec?.status ?? (active[0]?.id ?? 'present'), notes: rec?.notes ?? '' };
      }
      setMarks(next);
      setSummary(s);
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [id, date]);
  useEffect(() => {
    if (allowed) void load();
  }, [load, allowed]);

  // A mark is either a district code (by id) or, when the school has no codes, a plain status.
  const pick = (v: string) => (codes.some((c) => c.id === v) ? { codeId: v } : { status: v || 'present' });
  const options = codes.length ? codes.map((c) => c.id) : [...ATTENDANCE_STATUSES];
  const optionLabel = (v: string) => codes.find((c) => c.id === v)?.code ?? label(v);
  const optionTitle = (v: string) => codes.find((c) => c.id === v)?.label ?? label(v);

  async function save() {
    setState({ busy: true });
    try {
      const r = await api<{ saved: number }>('/attendance/bulk', { method: 'POST', body: { classId: id, date, periodId: periodId || undefined, records: roster.map((e) => ({ studentId: e.studentId, ...pick(marks[e.studentId]?.status ?? ''), notes: marks[e.studentId]?.notes || undefined })) } });
      setState({ ok: `Saved ${r.saved} records for ${date}.` });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }

  if (!allowed) return <NotForYou what="the attendance sheet" back={`/classes/${id}`} alt={{ href: '/grades', label: 'your attendance and grades' }} />;
  if (!klass) return state.error ? <Alert>{state.error}</Alert> : <SkeletonRows rows={5} />;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <p className="text-sm text-slate-500">
          <Link href={`/classes/${id}`} className="hover:underline">
            {klass.name}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">Attendance</h1>
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}

      {klass.canManage && (
        <Card title="Take attendance">
          <div className="mb-4 grid gap-3 md:grid-cols-3">
            <Input label="Date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            {periods.some((b) => b.periods.length > 0) && (
              <Select label="Period" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
                <option value="">Whole day</option>
                {periods.map((b) => (
                  <optgroup key={b.id} label={b.name}>
                    {b.periods.map((p) => (
                      <option key={p.id} value={p.id}>
                        {periodLabel(p)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            )}
            {codes.length > 0 && (
              <p className="self-end pb-2 text-xs text-slate-500" aria-label="Attendance code key">
                {codes.map((c) => `${c.code} = ${c.label}`).join(' · ')}
              </p>
            )}
          </div>
          <ul className="divide-y divide-slate-100">
            {roster.map((e) => (
              <li key={e.studentId} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                <span className="w-56 font-medium text-slate-800">
                  {e.student.lastName}, {e.student.firstName}
                </span>
                <PillGroup
                  name={`attendance-${e.studentId}`}
                  options={options}
                  value={marks[e.studentId]?.status ?? options[0]}
                  labels={optionLabel}
                  titles={optionTitle}
                  onChange={(s) => setMarks((m) => ({ ...m, [e.studentId]: { status: s, notes: m[e.studentId]?.notes ?? '' } }))}
                />
                <input className="min-w-[160px] flex-1 rounded-md border-0 px-2 py-1 text-xs ring-1 ring-inset ring-slate-300" placeholder="Note" value={marks[e.studentId]?.notes ?? ''} onChange={(ev) => setMarks((m) => ({ ...m, [e.studentId]: { status: m[e.studentId]?.status ?? 'present', notes: ev.target.value } }))} />
              </li>
            ))}
          </ul>
          <Button className="mt-4" loading={state.busy} disabled={roster.length === 0} onClick={() => void save()}>
            Save {date}
          </Button>
        </Card>
      )}

      {summary && (
        <Card title="Summary" description={`${summary.daysRecorded} day${summary.daysRecorded === 1 ? '' : 's'} recorded · class attendance ${summary.classAttendanceRate === null ? '—' : `${summary.classAttendanceRate}%`}`}>
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4">Student</th>
                <th className="py-2 pr-4">Present</th>
                <th className="py-2 pr-4">Late</th>
                <th className="py-2 pr-4">Absent</th>
                <th className="py-2 pr-4">Excused</th>
                <th className="py-2">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {summary.rows.map((r) => (
                <tr key={r.student.id}>
                  <td className="py-2 pr-4 font-medium text-slate-800">
                    {r.student.lastName}, {r.student.firstName}
                  </td>
                  <td className="py-2 pr-4">{r.counts.present}</td>
                  <td className="py-2 pr-4">{r.counts.late + r.counts.tardy + r.counts.leftEarly}</td>
                  <td className="py-2 pr-4">{r.counts.absent}</td>
                  <td className="py-2 pr-4">{r.counts.excused}</td>
                  <td className={`py-2 font-medium ${r.counts.attendanceRate !== null && r.counts.attendanceRate < 80 ? 'text-red-700' : ''}`}>
                    {r.counts.attendanceRate === null ? (
                      '—'
                    ) : (
                      <span className="flex items-center gap-2">
                        <span className="w-24">
                          <ProgressBar value={r.counts.attendanceRate} label={`${r.student.firstName} attendance`} tone={r.counts.attendanceRate >= 90 ? 'green' : r.counts.attendanceRate >= 80 ? 'brand' : 'amber'} />
                        </span>
                        {r.counts.attendanceRate}%
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
