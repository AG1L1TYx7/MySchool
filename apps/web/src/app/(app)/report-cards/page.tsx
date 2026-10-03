'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { ClassItem } from '@/lib/curriculum';
import { kindLabel, type ReportCard } from '@/lib/gradebook';
import type { SchoolStructure } from '@/lib/school';
import type { Paged } from '@/lib/students';

/** Report cards and progress reports: staff generate, comment and publish; students and parents read. */
export default function ReportCardsPage() {
  const { user, can } = useAuth();
  const staff = can('report-cards.view.all');
  const allowed = staff || can('report-cards.view.own') || can('report-cards.view.child');
  const [cards, setCards] = useState<ReportCard[] | null>(null);
  const [structure, setStructure] = useState<SchoolStructure | null>(null);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [filters, setFilters] = useState({ gradingPeriodId: '', classId: '', kind: 'report_card', status: '' });
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});
  const admin = can('report-cards.publish');

  const load = useCallback(async () => {
    const params = new URLSearchParams({ pageSize: '200' });
    if (filters.gradingPeriodId) params.set('gradingPeriodId', filters.gradingPeriodId);
    if (filters.classId) params.set('classId', filters.classId);
    if (filters.kind) params.set('kind', filters.kind);
    if (filters.status) params.set('status', filters.status);
    try {
      setCards((await api<Paged<ReportCard>>(`/report-cards?${params.toString()}`)).data);
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [filters]);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);
  useEffect(() => {
    if (!staff || !user?.organizationId) return;
    api<SchoolStructure>(`/organizations/${user.organizationId}/structure`)
      .then(setStructure)
      .catch(() => setStructure(null));
    api<{ data: ClassItem[] }>('/classes/mine')
      .then((r) => setClasses(r.data.filter((c) => c.canManage)))
      .catch(() => setClasses([]));
  }, [staff, user?.organizationId]);

  if (!allowed) return <NotForYou what="report cards" back="/dashboard" />;
  const periods = (structure?.years ?? []).flatMap((y) => y.terms.flatMap((t) => t.gradingPeriods.map((g) => ({ id: g.id, label: `${y.name} · ${t.name} · ${g.name}` }))));

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
  const drafts = (cards ?? []).filter((c) => c.status === 'draft').length;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Report cards</h1>
        <p className="text-sm text-slate-500">{staff ? 'Grades, comments, attendance and GPA per grading period. Generate drafts, add comments, then publish.' : 'Published report cards and progress reports.'}</p>
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}

      {staff && (
        <Card title="Generate and publish" description={admin ? 'Administrators generate for the whole school; teachers for one class. Publishing tells students and parents.' : 'Generate drafts for a class you teach, add your comments, and the office publishes them.'}>
          <div className="grid gap-3 md:grid-cols-4">
            <Select label="Grading period" value={filters.gradingPeriodId} onChange={(e) => setFilters({ ...filters, gradingPeriodId: e.target.value })}>
              <option value="">Choose</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
            <Select label="Kind" value={filters.kind} onChange={(e) => setFilters({ ...filters, kind: e.target.value })}>
              <option value="report_card">Report card</option>
              <option value="progress">Progress report</option>
            </Select>
            <Select label="Class" value={filters.classId} onChange={(e) => setFilters({ ...filters, classId: e.target.value })}>
              <option value="">{admin ? 'Whole school' : 'Choose a class'}</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <Select label="Status" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
              <option value="">Any</option>
              <option value="draft">Draft</option>
              <option value="published">Published</option>
            </Select>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button loading={state.busy} disabled={!filters.gradingPeriodId || (!admin && !filters.classId)} onClick={() => void run(() => api('/report-cards/generate', { method: 'POST', body: { gradingPeriodId: filters.gradingPeriodId, kind: filters.kind, classId: filters.classId || undefined } }), 'Drafts generated from the current gradebooks.')}>
              Generate drafts
            </Button>
            {admin && (
              <Button variant="secondary" loading={state.busy} disabled={!filters.gradingPeriodId || drafts === 0} onClick={() => void run(() => api('/report-cards/publish', { method: 'POST', body: { gradingPeriodId: filters.gradingPeriodId, kind: filters.kind } }), 'Published. Students and parents have been told.')}>
                Publish all drafts ({drafts})
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card title={staff ? 'Report cards' : 'Yours'} description={cards ? `${cards.length} report card${cards.length === 1 ? '' : 's'}.` : undefined}>
        {!cards && <SkeletonRows rows={4} />}
        {cards && cards.length === 0 && <p className="text-sm text-slate-500">{staff ? 'Nothing generated for these filters yet.' : 'No report cards published yet.'}</p>}
        <MotionList className="divide-y divide-slate-100">
          {(cards ?? []).map((c) => (
            <MotionItem key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <Link href={`/report-cards/${c.id}`} className="font-medium text-slate-900 hover:underline">
                  {c.student.lastName}, {c.student.firstName} · {kindLabel(c.kind)} · {c.gradingPeriod.name}
                </Link>
                <p className="text-xs text-slate-500">
                  {c.gradingPeriod.yearName} · {c.gradingPeriod.termName} · {c.lines.length} class{c.lines.length === 1 ? '' : 'es'}
                  {c.gpa !== null ? ` · GPA ${c.gpa.toFixed(2)}` : ''}
                </p>
              </div>
              <span className={`rounded-full px-2 py-0.5 text-xs ${c.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>{c.status === 'published' ? 'Published' : 'Draft'}</span>
            </MotionItem>
          ))}
        </MotionList>
      </Card>
    </div>
  );
}
