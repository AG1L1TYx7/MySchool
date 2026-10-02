'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { MotionItem, MotionList, PillGroup, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CATEGORY_LABELS, timeAgo, type Notification, type NotificationPreference } from '@/lib/communication';
import type { Paged } from '@/lib/students';

const FILTERS = ['all', 'unread'] as const;

export default function NotificationsPage() {
  const [rows, setRows] = useState<Notification[] | null>(null);
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>('all');
  const [prefs, setPrefs] = useState<NotificationPreference[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<Paged<Notification>>(`/notifications?pageSize=50${filter === 'unread' ? '&unreadOnly=true' : ''}`);
      setRows(r.data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [filter]);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    api<{ data: NotificationPreference[] }>('/notifications/preferences').then((r) => setPrefs(r.data)).catch(() => setPrefs([]));
  }, []);

  async function markRead(n: Notification) {
    if (n.isRead) return;
    setRows((r) => r?.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)) ?? r);
    await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
  }

  async function toggle(category: string, key: 'inApp' | 'email') {
    if (!prefs) return;
    const next = prefs.map((p) => (p.category === category ? { ...p, [key]: !p[key] } : p));
    setPrefs(next);
    setSaving(true);
    try {
      const r = await api<{ data: NotificationPreference[] }>('/notifications/preferences', { method: 'PUT', body: { preferences: next } });
      setPrefs(r.data);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Notifications</h1>
          <p className="mt-1 text-sm text-slate-500">Grades, assignments, announcements and messages, as they happen.</p>
        </div>
        <div className="flex items-center gap-3">
          <PillGroup name="Filter" options={FILTERS} value={filter} onChange={setFilter} labels={(f) => (f === 'all' ? 'All' : 'Unread')} />
          <Button variant="secondary" onClick={() => void api('/notifications/read-all', { method: 'POST' }).then(load)}>
            Mark all read
          </Button>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      <Card>
        {rows === null ? (
          <SkeletonRows rows={5} />
        ) : rows.length === 0 ? (
          <p className="text-sm text-slate-500">{filter === 'unread' ? 'You are all caught up.' : 'Nothing yet.'}</p>
        ) : (
          <MotionList className="divide-y divide-slate-100">
            {rows.map((n) => (
              <MotionItem key={n.id} className={`flex items-start gap-3 py-3 ${n.isRead ? '' : 'bg-brand-50/40'}`}>
                <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.isRead ? 'bg-transparent' : 'bg-brand-600'}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] uppercase tracking-wide text-slate-500">
                    {CATEGORY_LABELS[n.category] ?? n.category} · {timeAgo(n.createdAt)}
                  </p>
                  {n.link ? (
                    <Link href={n.link} onClick={() => void markRead(n)} className={`text-sm hover:underline ${n.isRead ? 'text-slate-700' : 'font-medium text-slate-900'}`}>
                      {n.title}
                    </Link>
                  ) : (
                    <p className={`text-sm ${n.isRead ? 'text-slate-700' : 'font-medium text-slate-900'}`}>{n.title}</p>
                  )}
                  {n.body && <p className="text-sm text-slate-500">{n.body}</p>}
                </div>
                {!n.isRead && (
                  <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => void markRead(n)}>
                    Mark read
                  </button>
                )}
              </MotionItem>
            ))}
          </MotionList>
        )}
      </Card>

      <Card title="Preferences" description={`Choose where each kind of notice reaches you.${saving ? ' Saving…' : ''}`}>
        {prefs === null ? (
          <SkeletonRows rows={4} />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="py-1">Category</th>
                <th className="py-1 text-center">In app</th>
                <th className="py-1 text-center">Email</th>
              </tr>
            </thead>
            <tbody>
              {prefs.map((p) => (
                <tr key={p.category} className="border-t border-slate-100">
                  <td className="py-2 text-slate-800">{CATEGORY_LABELS[p.category] ?? p.category}</td>
                  {(['inApp', 'email'] as const).map((k) => (
                    <td key={k} className="py-2 text-center">
                      <input type="checkbox" checked={p[k]} onChange={() => void toggle(p.category, k)} aria-label={`${CATEGORY_LABELS[p.category] ?? p.category} ${k === 'inApp' ? 'in app' : 'by email'}`} className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="mt-3 text-xs text-slate-500">Urgent school announcements and account security notices are always delivered.</p>
      </Card>
    </div>
  );
}
