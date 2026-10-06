'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { PlannerWeek } from '@/lib/assistant';
import { useAuth } from '@/lib/auth';

const KIND_TONE: Record<string, string> = { assignment: 'bg-brand-50 text-brand-800', plan: 'bg-green-50 text-green-800', event: 'bg-amber-50 text-amber-900', term: 'bg-slate-100 text-slate-700' };
const KIND_LABEL: Record<string, string> = { assignment: 'Due', plan: 'Plan', event: 'Event', term: 'Term' };

const shift = (iso: string, days: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** The teacher's week: due dates, scheduled lesson plans, events and term boundaries for the classes they teach. */
export default function PlannerPage() {
  const { can } = useAuth();
  const [week, setWeek] = useState<string | undefined>(undefined);
  const [data, setData] = useState<PlannerWeek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const allowed = can('planner.view');

  useEffect(() => {
    if (!allowed) return;
    setData(null);
    api<PlannerWeek>(`/planner${week ? `?week=${week}` : ''}`)
      .then(setData)
      .catch((err) => setError(errorMessage(err)));
  }, [allowed, week]);

  if (!allowed) return <NotForYou what="the planner" back="/dashboard" />;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Weekly planner</h1>
          <p className="mt-1 text-sm text-slate-500">Due dates, scheduled lesson plans, events and term boundaries for your classes. Plans come from the assistant.</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" aria-label="Previous week" onClick={() => setWeek(shift(data?.weekStart ?? today, -7))}>
            ‹
          </Button>
          <span className="min-w-[200px] text-center text-sm font-medium text-slate-800">{data ? `Week of ${new Date(`${data.weekStart}T12:00:00Z`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}` : '…'}</span>
          <Button variant="secondary" aria-label="Next week" onClick={() => setWeek(shift(data?.weekStart ?? today, 7))}>
            ›
          </Button>
          <Button variant="ghost" onClick={() => setWeek(undefined)}>
            This week
          </Button>
          <Link href="/assistant" className="text-sm text-brand-700 hover:underline">
            Assistant
          </Link>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {!data && !error && <SkeletonRows rows={4} />}
      {data && (
        <div className="grid gap-3 md:grid-cols-5 lg:grid-cols-7">
          {data.days.map((d) => {
            const weekend = [0, 6].includes(new Date(`${d.date}T12:00:00Z`).getUTCDay());
            return (
              <section key={d.date} className={`min-h-[160px] rounded-xl p-3 ring-1 ring-slate-200 ${d.date === today ? 'bg-brand-50/40 ring-brand-300' : 'bg-white'} ${weekend ? 'md:hidden lg:block' : ''}`} aria-label={d.date}>
                <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                  {new Date(`${d.date}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}
                </h2>
                <ul className="mt-2 space-y-2">
                  {d.items.length === 0 && <li className="text-xs text-slate-500">—</li>}
                  {d.items.map((i) => (
                    <li key={`${i.kind}-${i.id}`} className="rounded-md bg-slate-50 px-2 py-1.5 text-xs">
                      <span className={`mr-1 rounded px-1 py-0.5 text-[10px] font-medium ${KIND_TONE[i.kind]}`}>{KIND_LABEL[i.kind]}</span>
                      {i.link ? (
                        <Link href={i.link} className="font-medium text-slate-900 hover:underline">
                          {i.title}
                        </Link>
                      ) : (
                        <span className="font-medium text-slate-900">{i.title}</span>
                      )}
                      <p className="text-slate-600">
                        {i.time ? `${i.time} · ` : ''}
                        {i.className ?? ''}
                        {i.detail ? ` · ${i.detail}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      )}
      {data && (
        <Card title="Your classes">
          <ul className="flex flex-wrap gap-2 text-sm">
            {data.classes.map((c) => (
              <li key={c.id}>
                <Link href={`/classes/${c.id}`} className="rounded-full bg-slate-100 px-3 py-1 text-slate-700 hover:bg-brand-50">
                  {c.name}
                  {c.period ? ` · ${c.period}` : ''}
                </Link>
              </li>
            ))}
            {data.classes.length === 0 && <li className="text-slate-500">No classes this term.</li>}
          </ul>
        </Card>
      )}
    </div>
  );
}
