'use client';

import type { Announcement } from '@/lib/communication';
import { timeAgo, useI18n } from '@/lib/i18n';

const PRIORITY_STYLE: Record<string, string> = { urgent: 'bg-red-50 text-red-800 ring-red-200', high: 'bg-amber-50 text-amber-800 ring-amber-200', normal: 'bg-slate-50 text-slate-700 ring-slate-200', low: 'bg-slate-50 text-slate-500 ring-slate-200' };

export function AnnouncementCard({ a, compact, onPublish, onDelete, onPin }: { a: Announcement; compact?: boolean; onPublish?: () => void; onDelete?: () => void; onPin?: () => void }) {
  const { t, tag } = useI18n();
  return (
    <article className={`rounded-xl border bg-white p-4 ${a.priority === 'urgent' ? 'border-red-200' : 'border-slate-200'} ${a.pinned ? 'ring-1 ring-brand-200' : ''}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500">
            {a.pinned && <span className="text-brand-700">{t('ann.pinnedTag')}</span>}
            <span className={`rounded-full px-2 py-0.5 ring-1 ring-inset ${PRIORITY_STYLE[a.priority] ?? PRIORITY_STYLE.normal}`}>{a.priority}</span>
            <span>{a.type}</span>
            <span>· {a.className ?? t('ann.wholeSchool')}</span>
            {a.status !== 'published' && <span className="text-amber-700">· {a.status}</span>}
          </p>
          <h2 className="mt-1 text-base font-semibold text-slate-900">{a.title}</h2>
        </div>
        <span className="text-xs text-slate-500">
          {a.author ? `${a.author.firstName} ${a.author.lastName} · ` : ''}
          {timeAgo(a.publishedAt ?? a.createdAt, t, tag)}
        </span>
      </div>
      <p className={`mt-2 whitespace-pre-wrap text-sm text-slate-700 ${compact ? 'line-clamp-3' : ''}`}>{a.content}</p>
      {(onPublish || onDelete || onPin) && (
        <div className="mt-3 flex gap-3 text-xs">
          {onPublish && (
            <button type="button" className="font-medium text-brand-700 hover:underline" onClick={onPublish}>
              {t('ann.publish')}
            </button>
          )}
          {onPin && (
            <button type="button" className="text-slate-600 hover:underline" onClick={onPin}>
              {a.pinned ? t('ann.unpin') : t('ann.pin')}
            </button>
          )}
          {onDelete && (
            <button type="button" className="text-red-700 hover:underline" onClick={onDelete}>
              {t('common.delete')}
            </button>
          )}
        </div>
      )}
    </article>
  );
}
