'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { Bars } from '@/components/insight-cards';
import { MotionItem, MotionList, PillGroup, ProgressBar, ProgressRing, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ClassItem } from '@/lib/curriculum';
import { KIND_LABELS, REPORT_KINDS, WEEKDAYS, type Overview, type ReportRun, type ReportSchedule } from '@/lib/insight';
import { downloadCsv, todayIso } from '@/lib/school';
import { label } from '@/lib/students';

/** Insight (docs/13 section 9): the principal dashboard, downloadable reports and schedules. Staff only, English. */
export default function InsightPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <Insight />
    </Suspense>
  );
}

type Tab = 'overview' | 'reports' | 'classes';

/** The tab lives in the URL (?tab=reports) so a reload, a download or a shared link lands on the same view. */
function Insight() {
  const { user, can } = useAuth();
  const params = useSearchParams();
  const admin = !!user && ['principal', 'superintendent', 'super_admin', 'counselor'].includes(user.role);
  const allowed = can('reports.view');
  const raw = params.get('tab');
  // The tab lives in state and is only mirrored to the URL: re-rendering from the URL would remount the forms and lose typed input.
  const [tab, setTabState] = useState<Tab>(raw === 'reports' || raw === 'classes' ? raw : 'overview');
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, '', t === 'overview' ? '/insight' : `/insight?tab=${t}`);
  };
  if (!allowed) return <NotForYou what="insight" back="/dashboard" />;
  if (!admin) return <TeacherInsight />;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Insight</h1>
        <p className="mt-1 text-sm text-slate-500">How the school is doing today, from attendance, work, grades and AI use. Numbers describe the school, never rank its students.</p>
      </div>
      <PillGroup name="insight-tab" options={['overview', 'reports', 'classes'] as const} value={tab} onChange={setTab} labels={(v) => (v === 'overview' ? 'Overview' : v === 'reports' ? 'Reports and schedules' : 'By class')} />
      {tab === 'overview' && <OverviewView organizationId={user!.organizationId ?? ''} />}
      {tab === 'reports' && <ReportsView organizationId={user!.organizationId ?? ''} canSchedule={can('reports.schedule')} />}
      {tab === 'classes' && <ClassList />}
    </div>
  );
}

function OverviewView({ organizationId }: { organizationId: string }) {
  const [date, setDate] = useState(todayIso());
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!organizationId) return;
    setData(null);
    api<Overview>(`/organizations/${organizationId}/insight/overview?date=${date}`)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [organizationId, date]);
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <SkeletonRows rows={5} />;
  const tone = (v: number | null) => (v === null ? 'brand' : v >= 90 ? 'green' : v >= 75 ? 'brand' : 'amber');
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <Input label="Attendance for" type="date" value={date} onChange={(e) => setDate(e.target.value || todayIso())} />
        <p className="text-xs text-slate-500">Missing work covers the last {data.missingWork.windowDays} days, gradebooks the last 30, AI and activity the last 7.</p>
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Attendance today" description={data.attendance.deadline ? `Due by ${data.attendance.deadline}.` : undefined}>
          <div className="flex flex-wrap items-start gap-6">
            <ProgressRing value={data.attendance.classesTaken} max={Math.max(1, data.attendance.classesMeeting)} size={96} stroke={10} suffix="" label="Classes taken" tone={data.attendance.classesMissing.length === 0 ? 'green' : 'amber'} />
            <div className="text-sm text-slate-700">
              <p className="text-2xl font-semibold text-slate-900">
                {data.attendance.classesTaken} of {data.attendance.classesMeeting}
              </p>
              <p>{data.attendance.rateToday === null ? 'No marks yet today.' : `${data.attendance.rateToday}% present across ${data.attendance.marked} marks.`}</p>
            </div>
          </div>
          {data.attendance.classesMissing.length > 0 && (
            <div className="mt-3">
              <p className="text-xs uppercase tracking-wide text-slate-500">Not yet taken</p>
              <ul className="text-sm text-slate-700">
                {data.attendance.classesMissing.map((c) => (
                  <li key={c.classId}>
                    <Link href={`/classes/${c.classId}/attendance`} className="hover:underline">
                      {c.name}
                    </Link>
                    {c.period ? ` · period ${c.period}` : ''} · {c.teachers.join(', ') || 'no teacher'}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
        <Card title="Missing work by grade level" description={`${data.missingWork.items} items across ${data.missingWork.students} students.`}>
          <Bars rows={data.missingWork.byGradeLevel.map((g) => ({ label: g.gradeLevel === 'Unknown' ? 'No grade level' : `Grade ${g.gradeLevel}`, value: g.items, hint: `${g.students} students` }))} tone="amber" />
        </Card>
        <Card title="Students failing by class" description={`Below ${data.failing.threshold}% in the current grade. ${data.failing.students} students in all.`}>
          {data.failing.byClass.length === 0 ? (
            <p className="text-sm text-slate-500">Nobody is below the line right now.</p>
          ) : (
            <MotionList className="divide-y divide-slate-100">
              {data.failing.byClass.map((c) => (
                <MotionItem key={c.classId} className="py-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/classes/${c.classId}/insight`} className="font-medium text-slate-900 hover:underline">
                      {c.className}
                    </Link>
                    <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-800">{c.count}</span>
                  </div>
                  <p className="text-xs text-slate-600">
                    {c.students.map((s) => (
                      <Link key={s.id} href={`/students/${s.id}`} className="mr-2 hover:underline">
                        {s.name} ({s.grade}%)
                      </Link>
                    ))}
                  </p>
                </MotionItem>
              ))}
            </MotionList>
          )}
        </Card>
        <Card title="Gradebook completeness" description={`Graded cells over students times assignments due in the last 30 days. Average ${data.gradebook.average === null ? '—' : `${data.gradebook.average}%`}.`}>
          <MotionList className="space-y-2">
            {data.gradebook.classes.map((c) => (
              <MotionItem key={c.classId} className="text-sm">
                <ProgressBar value={c.completeness ?? 0} max={100} label={`${c.className} · ${c.teachers.join(', ') || 'no teacher'} · ${c.assignmentsDue} due, ${c.ungradedSubmissions} ungraded submissions`} tone={tone(c.completeness)} />
              </MotionItem>
            ))}
          </MotionList>
        </Card>
        <Card title="AI usage" description={`Last ${data.ai.windowDays} days. The week before: ${data.ai.conversationsLastWeek} conversations.`}>
          <div className="mb-3 grid grid-cols-3 gap-3 text-sm">
            {[
              ['Conversations', data.ai.conversations],
              ['Messages', data.ai.messages],
              ['Refusals', `${data.ai.refusals}${data.ai.refusalRate !== null ? ` (${data.ai.refusalRate}%)` : ''}`],
            ].map(([k, v]) => (
              <div key={String(k)} className="rounded-lg bg-slate-50 p-2 ring-1 ring-slate-200">
                <p className="text-xs uppercase tracking-wide text-slate-600">{k}</p>
                <p className="text-lg font-semibold text-slate-900">{v}</p>
              </div>
            ))}
          </div>
          <Bars rows={data.ai.byRole.map((r) => ({ label: label(r.role), value: r.conversations, hint: `${r.messages} messages` }))} />
          {data.ai.byCapability.length > 0 && <p className="mt-2 text-xs text-slate-600">By capability: {data.ai.byCapability.map((c) => `${c.capability} ${c.conversations}`).join(' · ')}</p>}
        </Card>
        <Card title="Activity this week" description="Who signed in, what got handed in, finished and practised.">
          <Bars rows={data.engagement.loginsByRole.map((r) => ({ label: label(r.role), value: r.active, hint: `${r.active} of ${r.total} signed in` }))} tone="green" />
          <p className="mt-3 text-sm text-slate-700">
            {data.engagement.submissions} submissions · {data.engagement.lessonCompletions} lessons finished · {data.engagement.practiceReviews} practice reviews
          </p>
        </Card>
      </div>
    </div>
  );
}

function ReportsView({ organizationId, canSchedule }: { organizationId: string; canSchedule: boolean }) {
  const [schedules, setSchedules] = useState<ReportSchedule[] | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [runs, setRuns] = useState<Record<string, ReportRun[]>>({});
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});
  const [form, setForm] = useState({ name: '', kind: 'school_overview', frequency: 'weekly', dayOfWeek: '1', dayOfMonth: '1', hour: '7', classId: '', recipients: '' });
  const [csvKind, setCsvKind] = useState<string>('school_overview');
  const [csvClass, setCsvClass] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api<{ data: ReportSchedule[] }>(`/organizations/${organizationId}/report-schedules`), api<{ data: ClassItem[] }>('/classes?pageSize=100')]);
      setSchedules(s.data);
      setClasses(c.data);
    } catch (e) {
      setState({ error: errorMessage(e) });
    }
  }, [organizationId]);
  useEffect(() => {
    if (organizationId) void load();
  }, [organizationId, load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api(`/organizations/${organizationId}/report-schedules`, {
        method: 'POST',
        body: {
          name: form.name,
          kind: form.kind,
          frequency: form.frequency,
          dayOfWeek: form.frequency === 'weekly' ? Number(form.dayOfWeek) : undefined,
          dayOfMonth: form.frequency === 'monthly' ? Number(form.dayOfMonth) : undefined,
          hour: Number(form.hour),
          classId: form.kind === 'class_summary' ? form.classId || undefined : undefined,
          recipients: form.recipients.split(/[,;\s]+/).filter(Boolean),
        },
      });
      setForm({ ...form, name: '', recipients: '' });
      setState({ ok: 'Schedule saved.' });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function runNow(s: ReportSchedule) {
    setState({ busy: true });
    try {
      const run = await api<ReportRun>(`/report-schedules/${s.id}/run`, { method: 'POST' });
      setState({ ok: run.delivered ? `Sent to ${run.recipients.join(', ')} (${run.rowCount} rows).` : `Built ${run.rowCount} rows, but no mail transport is configured, so nothing was delivered. Download the CSV instead.` });
      await showRuns(s);
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function showRuns(s: ReportSchedule) {
    try {
      const r = await api<{ data: ReportRun[] }>(`/report-schedules/${s.id}/runs`);
      setRuns((prev) => ({ ...prev, [s.id]: r.data }));
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function toggle(s: ReportSchedule) {
    try {
      await api(`/report-schedules/${s.id}`, { method: 'PATCH', body: { active: !s.active } });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function remove(s: ReportSchedule) {
    try {
      await api(`/report-schedules/${s.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  const when = (s: ReportSchedule) => (s.frequency === 'daily' ? `every day at ${s.hour}:00 UTC` : s.frequency === 'weekly' ? `every ${WEEKDAYS[s.dayOfWeek ?? 1]} at ${s.hour}:00 UTC` : `on day ${s.dayOfMonth ?? 1} each month at ${s.hour}:00 UTC`);

  return (
    <div className="space-y-6">
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      <Card title="Download a report now" description="The same reports the schedules send, as CSV, for today.">
        <div className="flex flex-wrap items-end gap-3">
          <Select label="Report" value={csvKind} onChange={(e) => setCsvKind(e.target.value)}>
            {REPORT_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          {csvKind === 'class_summary' && (
            <Select label="Class" value={csvClass} onChange={(e) => setCsvClass(e.target.value)}>
              <option value="">Choose</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
          <Button variant="secondary" disabled={csvKind === 'class_summary' && !csvClass} onClick={() => void downloadCsv(`/organizations/${organizationId}/insight/reports/${csvKind}.csv${csvKind === 'class_summary' ? `?classId=${csvClass}` : ''}`, `${csvKind}-${todayIso()}.csv`).catch((e) => setState({ error: errorMessage(e) }))}>
            Download CSV
          </Button>
        </div>
      </Card>
      {canSchedule && (
        <Card title="Schedule a report by email" description="Goes to staff accounts at this school only, as a CSV attachment. Times are UTC.">
          <form onSubmit={(e) => void create(e)} className="grid gap-3 md:grid-cols-3">
            <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={120} />
            <Select label="Report to send" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {REPORT_KINDS.map((k) => (
                <option key={k} value={k}>
                  {KIND_LABELS[k]}
                </option>
              ))}
            </Select>
            {form.kind === 'class_summary' ? (
              <Select label="Class" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })} required>
                <option value="">Choose</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            ) : (
              <div />
            )}
            <Select label="How often" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value })}>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </Select>
            {form.frequency === 'weekly' && (
              <Select label="Day" value={form.dayOfWeek} onChange={(e) => setForm({ ...form, dayOfWeek: e.target.value })}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </Select>
            )}
            {form.frequency === 'monthly' && <Input label="Day of month" type="number" min={1} max={31} value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: e.target.value })} />}
            {form.frequency === 'daily' && <div />}
            <Input label="Hour (UTC)" type="number" min={0} max={23} value={form.hour} onChange={(e) => setForm({ ...form, hour: e.target.value })} />
            <div className="md:col-span-2">
              <Input label="Recipients (staff emails, comma separated)" value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} required />
            </div>
            <div className="flex items-end">
              <Button type="submit" loading={state.busy}>
                Save schedule
              </Button>
            </div>
          </form>
        </Card>
      )}
      <Card title="Schedules" description="What goes out, to whom and when. Run now sends it today without changing the schedule.">
        {schedules === null ? (
          <SkeletonRows rows={2} />
        ) : schedules.length === 0 ? (
          <p className="text-sm text-slate-500">No schedules yet.</p>
        ) : (
          <MotionList className="divide-y divide-slate-100">
            {schedules.map((s) => (
              <MotionItem key={s.id} className="py-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium text-slate-900">
                      {s.name} <span className="font-normal text-slate-500">· {KIND_LABELS[s.kind as keyof typeof KIND_LABELS] ?? s.kind}</span>
                      {!s.active && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">paused</span>}
                    </p>
                    <p className="text-xs text-slate-600">
                      {when(s)} · to {s.recipients.join(', ')} · next {new Date(s.nextRunAt).toLocaleString()}
                      {s.lastRunAt ? ` · last ${new Date(s.lastRunAt).toLocaleString()}` : ''}
                    </p>
                  </div>
                  {canSchedule && (
                    <div className="flex gap-2">
                      <Button variant="secondary" loading={state.busy} onClick={() => void runNow(s)}>
                        Run now
                      </Button>
                      <Button variant="secondary" onClick={() => void showRuns(s)}>
                        Runs
                      </Button>
                      <Button variant="secondary" onClick={() => void toggle(s)}>
                        {s.active ? 'Pause' : 'Resume'}
                      </Button>
                      <Button variant="secondary" onClick={() => void remove(s)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
                {runs[s.id] && (
                  <ul className="mt-2 space-y-1 text-xs text-slate-600">
                    {runs[s.id].length === 0 && <li>No runs yet.</li>}
                    {runs[s.id].map((r) => (
                      <li key={r.id}>
                        {new Date(r.startedAt).toLocaleString()} · {r.status} · {r.rowCount} rows · {r.delivered ? 'delivered' : 'not delivered (no mail transport)'}
                        {r.error ? ` · ${r.error}` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </MotionItem>
            ))}
          </MotionList>
        )}
      </Card>
    </div>
  );
}

/** Every class with a link to its insight page; teachers land here with just their classes. */
function ClassList() {
  const [classes, setClasses] = useState<ClassItem[] | null>(null);
  useEffect(() => {
    api<{ data: ClassItem[] }>('/classes?pageSize=100')
      .then((r) => setClasses(r.data))
      .catch(() => setClasses([]));
  }, []);
  return (
    <Card title="By class" description="Grade distribution, attendance, missing work and who needs a conversation, per class.">
      {classes === null ? (
        <SkeletonRows rows={3} />
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2 md:grid-cols-3">
          {classes.map((c) => (
            <li key={c.id}>
              <Link href={`/classes/${c.id}/insight`} className="block rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800 ring-1 ring-slate-200 hover:bg-slate-100">
                {c.name}
                <span className="block text-xs text-slate-600">{c.course.title}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TeacherInsight() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Insight</h1>
        <p className="mt-1 text-sm text-slate-500">Your classes, one picture each: grade distribution, attendance, missing work and who needs a conversation.</p>
      </div>
      <ClassList />
    </div>
  );
}
