'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { MotionItem } from '@/components/motion';
import { Alert, Button, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { KIND_LABELS, REASON_LABELS, STATUS_LABELS, statusClass, type ContentStatus, type Group, type ReportReason, type Topic } from '@/lib/community';
import { timeAgo } from '@/lib/communication';

/** A labelled multi-line box; the UI kit only has a single-line input. */
export function TextArea({ label, id, value, onChange, maxLength, rows = 4, required, placeholder }: { label: string; id: string; value: string; onChange: (v: string) => void; maxLength?: number; rows?: number; required?: boolean; placeholder?: string }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-slate-700">
        {label}
      </label>
      <textarea
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        maxLength={maxLength}
        required={required}
        placeholder={placeholder}
        className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
      />
    </div>
  );
}

export function StatusPill({ status }: { status: ContentStatus }) {
  if (status === 'visible') return null;
  return <span className={`rounded px-1.5 py-0.5 text-xs ${statusClass(status)}`}>{STATUS_LABELS[status]}</span>;
}

export function GroupCard({ group }: { group: Group }) {
  const readable = group.canSee;
  return (
    <MotionItem className="flex h-full flex-col rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{KIND_LABELS[group.kind]}</span>
        {group.status === 'archived' && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-xs text-slate-700">Archived</span>}
        {group.membership?.status === 'pending' && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">Waiting for approval</span>}
        {group.membership?.role === 'moderator' && <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">You moderate</span>}
      </div>
      <h2 className="mt-2 font-medium">
        {readable ? (
          <Link href={`/community/groups/${group.id}`} className="hover:underline">
            {group.name}
          </Link>
        ) : (
          group.name
        )}
      </h2>
      {group.description && <p className="mt-1 line-clamp-3 text-sm text-slate-600">{group.description}</p>}
      <p className="mt-auto pt-3 text-xs text-slate-500">
        {group.memberCount} member{group.memberCount === 1 ? '' : 's'} · {group.topicCount} topic{group.topicCount === 1 ? '' : 's'}
      </p>
    </MotionItem>
  );
}

export function TopicRow({ topic, groupName }: { topic: Topic | { id: string; title: string; author: string; pinned: boolean; locked: boolean; postCount: number; lastPostAt: string | null; createdAt: string; status?: ContentStatus }; groupName?: string }) {
  return (
    <MotionItem className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {topic.pinned && <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">Pinned</span>}
          {topic.locked && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">Locked</span>}
          {topic.status && <StatusPill status={topic.status} />}
          <Link href={`/community/topics/${topic.id}`} className="font-medium hover:underline">
            {topic.title}
          </Link>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {groupName ? `${groupName} · ` : ''}
          {topic.author} · {topic.postCount} repl{topic.postCount === 1 ? 'y' : 'ies'} · {timeAgo(topic.lastPostAt ?? topic.createdAt)}
        </p>
      </div>
    </MotionItem>
  );
}

/** Report a topic or reply to the moderators. */
export function ReportForm({ targetType, targetId, onDone }: { targetType: 'topic' | 'post'; targetId: string; onDone: () => void }) {
  const [reason, setReason] = useState<ReportReason>('inappropriate');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/community/reports', { method: 'POST', body: { targetType, targetId, reason, details: details || undefined } });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="mt-2 space-y-2 rounded-md bg-slate-50 p-3">
      {error && <Alert>{error}</Alert>}
      <Select label="Why are you reporting this?" id={`report-reason-${targetId}`} value={reason} onChange={(e) => setReason(e.target.value as ReportReason)}>
        {(Object.keys(REASON_LABELS) as ReportReason[]).map((r) => (
          <option key={r} value={r}>
            {REASON_LABELS[r]}
          </option>
        ))}
      </Select>
      <TextArea label="Anything the moderators should know (optional)" id={`report-details-${targetId}`} value={details} onChange={setDetails} rows={2} maxLength={1000} />
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" variant="secondary" loading={busy}>
          Send report
        </Button>
      </div>
    </form>
  );
}
