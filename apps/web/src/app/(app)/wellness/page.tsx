'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate } from '@/lib/academics';
import type { WellnessAlert } from '@/lib/support';
import type { Paged } from '@/lib/students';

const TONE: Record<WellnessAlert['status'], string> = { open: 'bg-red-100 text-red-800', acknowledged: 'bg-amber-100 text-amber-900', resolved: 'bg-green-100 text-green-800' };

/** The wellness queue: tutor escalations a counselor works, with the student and a short excerpt. */
export default function WellnessPage() {
  const { user, can } = useAuth();
  const allowed = can('wellness.alerts');
  const [status, setStatus] = useState('');
  const [rows, setRows] = useState<WellnessAlert[] | null>(null);
  const [state, setState] = useState<{ error?: string; ok?: string }>({});
  const [resolution, setResolution] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setRows((await api<Paged<WellnessAlert>>(`/wellness/alerts?pageSize=100${status ? `&status=${status}` : ''}`)).data);
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [status]);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  if (!allowed) return <NotForYou what="the wellness queue" back="/dashboard" />;
  const update = (id: string, body: Record<string, unknown>, ok: string) => void api(`/wellness/alerts/${id}`, { method: 'PATCH', body }).then(() => setState({ ok })).then(load).catch((err) => setState({ error: errorMessage(err) }));
  const open = (rows ?? []).filter((r) => r.status !== 'resolved').length;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Wellness queue</h1>
          <p className="text-sm text-slate-500">When a student says something to the AI tutor that needs a trusted adult, it lands here. The student saw a caring message naming a trusted adult; no emotion inference is involved.</p>
        </div>
        <div className="w-44">
          <Select label="Show" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Everything</option>
            <option value="open">Open</option>
            <option value="acknowledged">Acknowledged</option>
            <option value="resolved">Resolved</option>
          </Select>
        </div>
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      <Card description={rows ? (open === 0 ? 'Nothing waiting.' : `${open} alert${open === 1 ? '' : 's'} need attention.`) : undefined}>
        {!rows && <SkeletonRows rows={3} />}
        {rows && rows.length === 0 && <p className="text-sm text-slate-500">No alerts.</p>}
        <MotionList className="divide-y divide-slate-100">
          {(rows ?? []).map((a) => (
            <MotionItem key={a.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-xs ${TONE[a.status]}`}>{a.status}</span>
                {a.student ? (
                  <Link href={`/students/${a.student.id}`} className="font-medium text-slate-900 hover:underline">
                    {a.student.lastName}, {a.student.firstName}
                  </Link>
                ) : (
                  <span className="font-medium text-slate-900">Unlinked account</span>
                )}
                <span className="text-xs text-slate-500">
                  {fmtDate(a.createdAt)} · {a.categories.map((c) => c.replace(/_/g, ' ')).join(', ') || 'safety'}
                  {a.assignedTo ? ` · with ${a.assignedTo.firstName} ${a.assignedTo.lastName}` : ''}
                </span>
              </div>
              <blockquote className="mt-2 rounded-md bg-slate-50 px-3 py-2 text-slate-700">{a.excerpt}</blockquote>
              {a.resolution && (
                <p className="mt-1 text-slate-600">
                  <span className="font-medium">Outcome:</span> {a.resolution}
                </p>
              )}
              {a.status !== 'resolved' && (
                <div className="mt-2 flex flex-wrap items-end gap-2">
                  {a.status === 'open' && (
                    <Button variant="secondary" onClick={() => update(a.id, { status: 'acknowledged', assignedToId: user?.id }, 'Taken. The student is on your list.')}>
                      I will follow up
                    </Button>
                  )}
                  <div className="min-w-[260px] flex-1">
                    <label className="block">
                      <span className="mb-1 block text-xs font-medium text-slate-700">What was done</span>
                      <input className="block w-full rounded-md border-0 px-3 py-1.5 text-sm ring-1 ring-inset ring-slate-300" value={resolution[a.id] ?? ''} onChange={(e) => setResolution({ ...resolution, [a.id]: e.target.value })} />
                    </label>
                  </div>
                  <Button disabled={!(resolution[a.id] ?? '').trim()} onClick={() => update(a.id, { status: 'resolved', resolution: resolution[a.id] }, 'Resolved.')}>
                    Resolve
                  </Button>
                </div>
              )}
            </MotionItem>
          ))}
        </MotionList>
      </Card>
    </div>
  );
}
