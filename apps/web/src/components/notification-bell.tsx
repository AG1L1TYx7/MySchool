'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '@/lib/api';
import { CATEGORY_LABELS, timeAgo, type Notification, type NotificationSummary } from '@/lib/communication';
import { spring, useReducedMotion } from '@/lib/motion';
import { connectHub } from '@/lib/realtime';

/**
 * Header bell: live unread badge (pops on arrival), a dropdown with the latest items,
 * mark-as-read on open, link to the full list (docs/12: feedback is visible and announced).
 */
export function NotificationBell() {
  const router = useRouter();
  const prefersReduced = useReducedMotion();
  const [summary, setSummary] = useState<NotificationSummary | null>(null);
  const [open, setOpen] = useState(false);
  const [pulse, setPulse] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  const refresh = useCallback(() => {
    api<NotificationSummary>('/notifications/summary').then(setSummary).catch(() => undefined);
  }, []);

  useEffect(() => {
    refresh();
    const socket = connectHub('/hubs/notifications');
    const onNew = (n: Notification) => {
      setSummary((s) => {
        if (!s) {
          refresh();
          return s;
        }
        return { ...s, unread: s.unread + 1, latest: [n, ...s.latest].slice(0, 8) };
      });
      setPulse((p) => p + 1);
    };
    const onChanged = () => refresh();
    socket.on('NewNotification', onNew);
    socket.on('SummaryChanged', onChanged);
    socket.on('connect', refresh);
    return () => {
      socket.off('NewNotification', onNew);
      socket.off('SummaryChanged', onChanged);
      socket.off('connect', refresh);
    };
  }, [refresh]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  async function openItem(n: Notification) {
    setOpen(false);
    if (!n.isRead) {
      setSummary((s) => (s ? { ...s, unread: Math.max(0, s.unread - 1), latest: s.latest.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)) } : s));
      await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => undefined);
    }
    if (n.link) router.push(n.link);
  }

  const unread = summary?.unread ?? 0;
  return (
    <div className="relative" ref={box}>
      <button type="button" aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} aria-expanded={open} className="relative rounded-full p-2 text-slate-600 hover:bg-slate-100" onClick={() => setOpen((o) => !o)}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.7 21a2 2 0 0 1-3.4 0" />
        </svg>
        <AnimatePresence>
          {unread > 0 && (
            <motion.span key={pulse} initial={prefersReduced ? { opacity: 0 } : { scale: 0.4, opacity: 0 }} animate={prefersReduced ? { opacity: 1 } : { scale: [1.3, 1], opacity: 1 }} exit={{ opacity: 0 }} transition={prefersReduced ? { duration: 0.1 } : spring.soft} className="absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-brand-600 px-1 text-center text-[11px] font-semibold leading-[18px] text-white" aria-live="polite">
              {unread > 99 ? '99+' : unread}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: prefersReduced ? 0.1 : 0.18 }} className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
            <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2 text-sm">
              <span className="font-medium text-slate-900">Notifications</span>
              {unread > 0 && (
                <button type="button" className="text-xs text-brand-700 hover:underline" onClick={() => void api('/notifications/read-all', { method: 'POST' }).then(refresh)}>
                  Mark all read
                </button>
              )}
            </div>
            <ul className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
              {(summary?.latest ?? []).length === 0 && <li className="px-3 py-4 text-sm text-slate-500">Nothing yet. You will hear about grades, assignments, announcements and messages here.</li>}
              {(summary?.latest ?? []).map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => void openItem(n)} className={`block w-full px-3 py-2 text-left hover:bg-slate-50 ${n.isRead ? '' : 'bg-brand-50/60'}`}>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">
                      {CATEGORY_LABELS[n.category] ?? n.category} · {timeAgo(n.createdAt)}
                    </p>
                    <p className={`text-sm ${n.isRead ? 'text-slate-700' : 'font-medium text-slate-900'}`}>{n.title}</p>
                    {n.body && <p className="truncate text-xs text-slate-500">{n.body}</p>}
                  </button>
                </li>
              ))}
            </ul>
            <Link href="/notifications" onClick={() => setOpen(false)} className="block border-t border-slate-100 px-3 py-2 text-center text-xs font-medium text-brand-700 hover:bg-slate-50">
              All notifications and preferences
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
