'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { ReportForm, StatusPill, TextArea } from '@/components/community-cards';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { REACTION_ICONS, REACTION_LABELS, type ModerationAction, type Post, type ReactionKind, type TopicDetail } from '@/lib/community';
import { timeAgo } from '@/lib/communication';

const REACTIONS: ReactionKind[] = ['like', 'helpful', 'celebrate'];

/** One topic with its replies: react, reply, subscribe, report; moderators pin, lock, approve, hide and remove. */
export default function TopicPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <TopicView />
    </Suspense>
  );
}

function TopicView() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [topic, setTopic] = useState<TopicDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState('');
  const [reporting, setReporting] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ id: string; body: string; title?: string } | null>(null);
  const load = useCallback(() => {
    api<TopicDetail>(`/community/topics/${id}`).then(setTopic).catch((e) => setError(errorMessage(e)));
  }, [id]);
  useEffect(load, [load]);
  const act = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    setError(null);
    setNote(null);
    try {
      await fn();
      if (done) setNote(done);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const send = async (e: FormEvent) => {
    e.preventDefault();
    await act('reply', async () => {
      const p = await api<Post>(`/community/topics/${id}/posts`, { method: 'POST', body: { body: reply } });
      setReply('');
      setNote(p.status === 'held' ? `Sent, but it is waiting for a teacher. ${p.holdReason ?? ''}` : 'Reply posted.');
    });
  };
  const react = (p: Post, kind: ReactionKind) =>
    act(`react-${p.id}`, () => (p.myReaction === kind ? api(`/community/posts/${p.id}/reaction`, { method: 'DELETE' }) : api(`/community/posts/${p.id}/reaction`, { method: 'PUT', body: { kind } })));
  const moderate = (type: 'topic' | 'post', targetId: string, action: ModerationAction) =>
    act(`mod-${targetId}`, () => api(`/community/${type}s/${targetId}/moderate`, { method: 'POST', body: { action } }), action === 'approve' ? 'Approved and now visible.' : action === 'restore' ? 'Restored.' : action === 'hide' ? 'Hidden. The author still sees it and has been told.' : 'Removed. The author has been told.');
  const saveEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editing) return;
    await act('edit', async () => {
      if (editing.id === id) await api(`/community/topics/${id}`, { method: 'PATCH', body: { title: editing.title, body: editing.body } });
      else await api(`/community/posts/${editing.id}`, { method: 'PATCH', body: { body: editing.body } });
      setEditing(null);
    }, 'Saved.');
  };
  if (error && !topic) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl font-semibold">Topic</h1>
        <Alert>{error}</Alert>
        <Link href="/community" className="text-sm text-brand-700 hover:underline">
          Back to the community
        </Link>
      </div>
    );
  }
  if (!topic) return <SkeletonRows rows={4} />;
  const canReply = topic.canReply && can('community.post');
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm text-slate-500">
          <Link href="/community" className="hover:underline">
            Community
          </Link>{' '}
          /{' '}
          <Link href={`/community/groups/${topic.groupId}`} className="hover:underline">
            {topic.group.name}
          </Link>
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {topic.pinned && <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">Pinned</span>}
          {topic.locked && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">Locked</span>}
          <StatusPill status={topic.status} />
        </div>
        <h1 className="text-2xl font-semibold">{topic.title}</h1>
        <p className="mt-1 text-xs text-slate-500">
          {topic.author} · {timeAgo(topic.createdAt)}
        </p>
      </div>
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      {topic.holdReason && topic.status === 'held' && <Alert kind="info">{topic.holdReason}</Alert>}
      <Card>
        {editing?.id === id ? (
          <form onSubmit={saveEdit} className="space-y-3">
            <TextArea label="Title" id="edit-title" value={editing.title ?? ''} onChange={(v) => setEditing({ ...editing, title: v })} rows={1} maxLength={200} required />
            <TextArea label="Your words" id="edit-body" value={editing.body} onChange={(v) => setEditing({ ...editing, body: v })} maxLength={4000} required />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button type="submit" loading={busy === 'edit'}>
                Save
              </Button>
            </div>
          </form>
        ) : (
          <p className="whitespace-pre-wrap text-sm">{topic.body}</p>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <Button variant="ghost" onClick={() => void act('sub', () => api(`/community/topics/${id}/subscribe`, { method: topic.subscribed ? 'DELETE' : 'POST' }))}>
            {topic.subscribed ? 'Stop following' : 'Follow this topic'}
          </Button>
          {topic.canEdit && !editing && (
            <Button variant="ghost" onClick={() => setEditing({ id, title: topic.title, body: topic.body })}>
              Edit
            </Button>
          )}
          {(topic.own || topic.canModerate) && topic.status !== 'removed' && (
            <Button variant="ghost" onClick={() => void act('del', () => api(`/community/topics/${id}`, { method: 'DELETE' }), 'Removed.')}>
              Remove topic
            </Button>
          )}
          {!topic.own && (
            <Button variant="ghost" onClick={() => setReporting(reporting === id ? null : id)}>
              Report
            </Button>
          )}
          {topic.canModerate && (
            <>
              <Button variant="secondary" onClick={() => void act('pin', () => api(`/community/topics/${id}`, { method: 'PATCH', body: { pinned: !topic.pinned } }))}>
                {topic.pinned ? 'Unpin' : 'Pin'}
              </Button>
              <Button variant="secondary" onClick={() => void act('lock', () => api(`/community/topics/${id}`, { method: 'PATCH', body: { locked: !topic.locked } }))}>
                {topic.locked ? 'Unlock' : 'Lock'}
              </Button>
              {topic.status === 'held' && <Button onClick={() => void moderate('topic', id, 'approve')}>Approve</Button>}
              {topic.status === 'visible' && (
                <Button variant="secondary" onClick={() => void moderate('topic', id, 'hide')}>
                  Hide
                </Button>
              )}
              {topic.status === 'hidden' && (
                <Button variant="secondary" onClick={() => void moderate('topic', id, 'restore')}>
                  Restore
                </Button>
              )}
            </>
          )}
        </div>
        {reporting === id && <ReportForm targetType="topic" targetId={id} onDone={() => { setReporting(null); setNote('Thanks. The moderators have been told.'); }} />}
      </Card>
      <section aria-labelledby="replies">
        <h2 id="replies" className="text-lg font-semibold">
          Replies ({topic.posts.filter((p) => p.status === 'visible').length})
        </h2>
        {topic.posts.length === 0 ? (
          <p className="mt-1 text-sm text-slate-600">No replies yet.</p>
        ) : (
          <MotionList className="mt-2 space-y-2">
            {topic.posts.map((p) => (
              <MotionItem key={p.id} className={`rounded-lg bg-white p-3 shadow-sm ring-1 ring-slate-200 ${p.status !== 'visible' ? 'opacity-80' : ''}`}>
                <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                  <span className="font-medium text-slate-700">{p.author}</span>
                  <span>{timeAgo(p.createdAt)}</span>
                  {p.editedAt && <span>(edited)</span>}
                  <StatusPill status={p.status} />
                </div>
                {editing?.id === p.id ? (
                  <form onSubmit={saveEdit} className="mt-2 space-y-2">
                    <TextArea label="Your words" id={`edit-${p.id}`} value={editing.body} onChange={(v) => setEditing({ ...editing, body: v })} maxLength={4000} required />
                    <div className="flex justify-end gap-2">
                      <Button type="button" variant="ghost" onClick={() => setEditing(null)}>
                        Cancel
                      </Button>
                      <Button type="submit" loading={busy === 'edit'}>
                        Save
                      </Button>
                    </div>
                  </form>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap text-sm">{p.body}</p>
                )}
                {p.holdReason && p.status === 'held' && <p className="mt-1 text-sm text-amber-800">{p.holdReason}</p>}
                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {REACTIONS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={p.myReaction === k}
                      aria-label={`${REACTION_LABELS[k]} (${p.reactions[k]})`}
                      disabled={busy === `react-${p.id}` || p.status !== 'visible'}
                      onClick={() => void react(p, k)}
                      className={`rounded-full px-2 py-0.5 text-xs ring-1 ${p.myReaction === k ? 'bg-brand-50 text-brand-700 ring-brand-300' : 'bg-white text-slate-600 ring-slate-200 hover:bg-slate-50'}`}
                    >
                      <span aria-hidden="true">{REACTION_ICONS[k]}</span> {p.reactions[k]}
                    </button>
                  ))}
                  {p.canEdit && !editing && (
                    <Button variant="ghost" onClick={() => setEditing({ id: p.id, body: p.body })}>
                      Edit
                    </Button>
                  )}
                  {(p.own || topic.canModerate) && p.status !== 'removed' && (
                    <Button variant="ghost" onClick={() => void act(`del-${p.id}`, () => api(`/community/posts/${p.id}`, { method: 'DELETE' }), 'Removed.')}>
                      Remove
                    </Button>
                  )}
                  {!p.own && (
                    <Button variant="ghost" onClick={() => setReporting(reporting === p.id ? null : p.id)}>
                      Report
                    </Button>
                  )}
                  {topic.canModerate && p.status === 'held' && <Button onClick={() => void moderate('post', p.id, 'approve')}>Approve</Button>}
                  {topic.canModerate && p.status === 'visible' && (
                    <Button variant="secondary" onClick={() => void moderate('post', p.id, 'hide')}>
                      Hide
                    </Button>
                  )}
                  {topic.canModerate && p.status === 'hidden' && (
                    <Button variant="secondary" onClick={() => void moderate('post', p.id, 'restore')}>
                      Restore
                    </Button>
                  )}
                </div>
                {reporting === p.id && <ReportForm targetType="post" targetId={p.id} onDone={() => { setReporting(null); setNote('Thanks. The moderators have been told.'); }} />}
              </MotionItem>
            ))}
          </MotionList>
        )}
      </section>
      {canReply ? (
        <Card title="Reply">
          <form onSubmit={send} className="space-y-3">
            <TextArea label="Your reply" id="reply-body" required maxLength={4000} value={reply} onChange={setReply} />
            <div className="flex justify-end">
              <Button type="submit" loading={busy === 'reply'}>
                Post reply
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        topic.replyBlockedReason && <p className="text-sm text-slate-600">{topic.replyBlockedReason}</p>
      )}
    </div>
  );
}
