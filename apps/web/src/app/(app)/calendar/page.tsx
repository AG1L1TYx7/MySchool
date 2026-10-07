'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { ClassItem } from '@/lib/curriculum';
import { EVENT_LABELS, EVENT_TYPES, type FeedItem } from '@/lib/school';

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const monthRange = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, '0')}` };
};
const monthTitle = (key: string) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
};
const shift = (key: string, by: number) => {
  const [y, m] = key.split('-').map(Number);
  return monthKey(new Date(y, m - 1 + by, 1));
};
const dayOf = (iso: string) => iso.slice(0, 10);
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
const TONE: Record<string, string> = { day_off: 'bg-amber-100 text-amber-900', early_release: 'bg-amber-50 text-amber-800', term_start: 'bg-green-100 text-green-800', term_end: 'bg-green-100 text-green-800', school_event: 'bg-brand-100 text-brand-800', class_event: 'bg-slate-100 text-slate-800', assignment_due: 'bg-violet-100 text-violet-900' };

/** One calendar for everyone: days off, school and class events, due dates and term boundaries (docs/13 section 3). */
export default function CalendarPage() {
  const { user, can } = useAuth();
  const { t, n } = useI18n();
  const [month, setMonth] = useState(monthKey(new Date()));
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [subscription, setSubscription] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const manage = can('calendar.manage');

  const load = useCallback(async () => {
    const { from, to } = monthRange(month);
    try {
      setItems((await api<{ data: FeedItem[] }>(`/calendar?from=${from}&to=${to}`)).data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [month]);
  useEffect(() => {
    void load();
  }, [load]);

  const grouped = useMemo(() => {
    const map = new Map<string, FeedItem[]>();
    for (const i of items ?? []) {
      const key = dayOf(i.startsAt);
      map.set(key, [...(map.get(key) ?? []), i]);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [items]);

  async function subscribe() {
    try {
      const r = await api<{ path: string }>('/calendar/subscription');
      setSubscription(`${window.location.origin}${r.path}`);
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  async function copy() {
    if (!subscription) return;
    try {
      await navigator.clipboard.writeText(subscription);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  async function remove(id: string) {
    try {
      await api(`/calendar/events/${id}`, { method: 'DELETE' });
      setOk('Event removed.');
      await load();
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('cal.title')}</h1>
          <p className="text-sm text-slate-500">{t('cal.subtitle', { name: user?.firstName ?? '' })}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" aria-label={t('cal.prev')} onClick={() => setMonth((m) => shift(m, -1))}>
            ‹
          </Button>
          <span className="min-w-[160px] text-center text-sm font-medium text-slate-800">{monthTitle(month)}</span>
          <Button variant="secondary" aria-label={t('cal.next')} onClick={() => setMonth((m) => shift(m, 1))}>
            ›
          </Button>
          <Button variant="ghost" onClick={() => setMonth(monthKey(new Date()))}>
            {t('cal.today')}
          </Button>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {ok && <Alert kind="success">{ok}</Alert>}

      {manage && <AddEvent onAdded={async () => { setOk('Event added.'); await load(); }} onError={setError} />}

      <Card title={monthTitle(month)} description={items ? n('cal.items', items.length) : undefined}>
        {items === null && <SkeletonRows rows={4} />}
        {items && grouped.length === 0 && <p className="text-sm text-slate-500">{t('cal.nothing')}</p>}
        <MotionList as="div" className="space-y-4">
          {grouped.map(([day, list]) => (
            <MotionItem as="div" key={day} className="flex gap-4">
              <div className="w-16 shrink-0 text-right">
                <p className="text-xs uppercase tracking-wide text-slate-500">{new Date(`${day}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</p>
                <p className="text-xl font-semibold tabular-nums text-slate-900">{Number(day.slice(8))}</p>
              </div>
              <ul className="min-w-0 flex-1 divide-y divide-slate-100 rounded-lg bg-slate-50">
                {list.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${TONE[i.type] ?? TONE.school_event}`}>{EVENT_LABELS[i.type] ?? i.type}</span>
                    {i.link ? (
                      <Link href={i.link} className="font-medium text-slate-900 hover:underline">
                        {i.title}
                      </Link>
                    ) : (
                      <span className="font-medium text-slate-900">{i.title}</span>
                    )}
                    <span className="text-xs text-slate-500">
                      {i.allDay ? t('cal.allDay') : timeOf(i.startsAt)}
                      {i.endsAt && !i.allDay ? t('cal.to', { time: timeOf(i.endsAt) }) : ''}
                      {i.className ? ` · ${i.className}` : ''}
                    </span>
                    {i.kind === 'event' && i.canEdit && (
                      <button type="button" className="ml-auto text-xs text-slate-500 hover:text-red-700" onClick={() => void remove(i.id)}>
                        {t('common.remove')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </MotionItem>
          ))}
        </MotionList>
      </Card>

      <Card title={t('cal.subscribe')} description={t('cal.subscribeDesc')}>
        {subscription ? (
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-slate-100 px-3 py-2 text-xs">{subscription}</code>
            <Button variant="secondary" onClick={() => void copy()}>
              {copied ? t('cal.copied') : t('cal.copyLink')}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                void api<{ path: string }>('/calendar/subscription?rotate=true')
                  .then((r) => setSubscription(`${window.location.origin}${r.path}`))
                  .catch((err) => setError(errorMessage(err)))
              }
            >
              New link
            </Button>
          </div>
        ) : (
          <Button variant="secondary" onClick={() => void subscribe()}>
            Show my subscription link
          </Button>
        )}
      </Card>
    </div>
  );
}

function AddEvent({ onAdded, onError }: { onAdded: () => Promise<void>; onError: (m: string) => void }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [form, setForm] = useState({ title: '', type: 'class_event', classId: '', date: '', start: '', end: '', allDay: true, description: '' });
  const [busy, setBusy] = useState(false);
  const admin = user?.role === 'principal' || user?.role === 'superintendent' || user?.role === 'super_admin';
  useEffect(() => {
    if (!open) return;
    api<{ data: ClassItem[] }>('/classes/mine')
      .then((r) => setClasses(r.data.filter((c) => c.canManage)))
      .catch(() => setClasses([]));
  }, [open]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const startsAt = form.allDay ? new Date(`${form.date}T00:00:00`).toISOString() : new Date(`${form.date}T${form.start || '08:00'}`).toISOString();
      const endsAt = !form.allDay && form.end ? new Date(`${form.date}T${form.end}`).toISOString() : undefined;
      await api('/calendar/events', { method: 'POST', body: { title: form.title, type: form.type, classId: form.type === 'class_event' ? form.classId || undefined : undefined, startsAt, endsAt, allDay: form.allDay, description: form.description || undefined } });
      setForm({ title: '', type: 'class_event', classId: '', date: '', start: '', end: '', allDay: true, description: '' });
      setOpen(false);
      await onAdded();
    } catch (err) {
      onError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  if (!open) {
    return (
      <div>
        <Button onClick={() => setOpen(true)}>Add event</Button>
      </div>
    );
  }
  return (
    <Card title="Add an event" description={admin ? 'School-wide events show for everyone; class events for the people in that class.' : 'Class events show for the people in that class.'}>
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-4" noValidate>
        <div className="md:col-span-2">
          <Input label="Title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <Select label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
          {EVENT_TYPES.filter((t) => admin || t === 'class_event').map((t) => (
            <option key={t} value={t}>
              {EVENT_LABELS[t]}
            </option>
          ))}
        </Select>
        {form.type === 'class_event' && (
          <Select label="Class" required value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
            <option value="">Choose a class</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <Input label="Date" type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
        <label className="flex items-end gap-2 pb-2 text-sm text-slate-700">
          <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} />
          All day
        </label>
        {!form.allDay && (
          <>
            <Input label="Starts" type="time" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} />
            <Input label="Ends" type="time" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />
          </>
        )}
        <div className="md:col-span-4">
          <Input label="Details (optional)" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div className="flex gap-2 md:col-span-4">
          <Button type="submit" loading={busy} disabled={!form.title || !form.date || (form.type === 'class_event' && !form.classId)}>
            Add to calendar
          </Button>
          <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
