'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/ui';
import { api } from '@/lib/api';
import { COMPONENT_LABELS, COMPONENT_TONES, IMPACT_LABELS, INCIDENT_STATUS_LABELS, STATUS_TONES, type Incident, type StatusPage } from '@/lib/billing';

/**
 * The public status page (docs/02 section 35): no sign-in. The server hands over the last known state so
 * the page paints with an answer, then this view refreshes every minute (slice 28).
 */
export function StatusView({ initial }: { initial: StatusPage | null }) {
  const [data, setData] = useState<StatusPage | null>(initial);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const load = () =>
      api<StatusPage>('/status', { auth: false })
        .then((d) => {
          setData(d);
          setFailed(false);
        })
        .catch(() => setFailed(true));
    load();
    const t = window.setInterval(load, 60_000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <main className="mx-auto min-h-screen max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <Logo className="text-lg" />
        <Link href="/login" className="text-sm text-brand-700 hover:underline">
          Sign in
        </Link>
      </div>
      <h1 className="text-2xl font-semibold">SmartSchool status</h1>
      {failed && !data ? (
        <div className="mt-4 rounded-md bg-red-50 p-4 text-sm text-red-800 ring-1 ring-red-200" role="status">
          We cannot reach the service right now. If this continues, the service is down; please try again in a few minutes.
        </div>
      ) : !data ? (
        <p className="mt-4 text-sm text-slate-600">Loading…</p>
      ) : (
        <>
          {failed && (
            <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900 ring-1 ring-amber-200" role="status">
              We cannot reach the service right now; this is the last state we saw.
            </p>
          )}
          <div className={`mt-4 rounded-md p-4 ring-1 ${STATUS_TONES[data.status]}`} role="status">
            <p className="text-lg font-medium">{data.label}</p>
            {data.checkedAt && <p className="mt-1 text-xs">Last checked {new Date(data.checkedAt).toLocaleString()}</p>}
          </div>
          <section className="mt-6" aria-labelledby="components">
            <h2 id="components" className="text-lg font-semibold">
              Components
            </h2>
            <ul className="mt-2 divide-y divide-slate-100 rounded-md bg-white ring-1 ring-slate-200">
              {data.components.map((c) => (
                <li key={c.key} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span>{c.name}</span>
                  <span className={`font-medium ${COMPONENT_TONES[c.status]}`}>{COMPONENT_LABELS[c.status]}</span>
                </li>
              ))}
            </ul>
          </section>
          <section className="mt-6" aria-labelledby="uptime">
            <h2 id="uptime" className="text-lg font-semibold">
              Uptime, last {data.uptime.days} days
            </h2>
            <p className="mt-1 text-sm text-slate-600">{data.uptime.percent === null ? 'No checks recorded yet.' : `${data.uptime.percent}% of checks found the service up.`}</p>
            <ol className="mt-2 flex flex-wrap gap-0.5" aria-label="Uptime by day">
              {data.uptime.byDay.map((d) => (
                <li
                  key={d.day}
                  title={`${d.day}: ${d.percent === null ? 'no checks' : `${d.percent}%`}`}
                  className={`h-6 w-2 rounded-sm ${d.percent === null ? 'bg-slate-200' : d.percent >= 99.5 ? 'bg-green-500' : d.percent >= 95 ? 'bg-amber-400' : 'bg-red-500'}`}
                >
                  <span className="sr-only">
                    {d.day}: {d.percent === null ? 'no checks' : `${d.percent} percent`}
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <IncidentList title="Incidents" empty="No incidents in the last seven days." items={data.incidents} />
          <IncidentList title="Planned maintenance" empty="Nothing planned." items={data.maintenance} />
        </>
      )}
      <p className="mt-10 text-xs text-slate-500">Status is checked every five minutes. Times are shown in your local time zone.</p>
    </main>
  );
}

function IncidentList({ title, empty, items }: { title: string; empty: string; items: Incident[] }) {
  const id = title.toLowerCase().replace(/\s+/g, '-');
  return (
    <section className="mt-6" aria-labelledby={id}>
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {items.length === 0 ? (
        <p className="mt-1 text-sm text-slate-600">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-3">
          {items.map((i) => (
            <li key={i.id} className="rounded-md bg-white p-4 ring-1 ring-slate-200">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium">{i.title}</h3>
                <span className={`rounded px-1.5 py-0.5 text-xs ${i.open ? 'bg-amber-50 text-amber-800' : 'bg-green-50 text-green-700'}`}>{INCIDENT_STATUS_LABELS[i.status] ?? i.status}</span>
                {i.kind === 'incident' && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{IMPACT_LABELS[i.impact]}</span>}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                {i.kind === 'maintenance' && i.scheduledFor ? `Planned for ${new Date(i.scheduledFor).toLocaleString()}${i.scheduledUntil ? ` until ${new Date(i.scheduledUntil).toLocaleString()}` : ''}` : `Started ${new Date(i.startedAt).toLocaleString()}`}
                {i.resolvedAt ? ` · ended ${new Date(i.resolvedAt).toLocaleString()}` : ''}
              </p>
              <ol className="mt-2 space-y-1 text-sm">
                {[...i.updates].reverse().map((u, n) => (
                  <li key={n}>
                    <span className="text-xs text-slate-500">{new Date(u.at).toLocaleString()} · </span>
                    <span className="font-medium">{INCIDENT_STATUS_LABELS[u.status] ?? u.status}: </span>
                    {u.message}
                  </li>
                ))}
              </ol>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
