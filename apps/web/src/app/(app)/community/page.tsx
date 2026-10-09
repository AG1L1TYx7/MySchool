'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { GroupCard, TextArea, TopicRow } from '@/components/community-cards';
import { MotionList, PillGroup, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { JOIN_LABELS, REASON_LABELS, RESOLUTION_LABELS, VISIBILITY_LABELS, type FeedItem, type Group, type GroupVisibility, type JoinPolicy, type ModerationAction, type Queue, type Resolution } from '@/lib/community';
import { timeAgo } from '@/lib/communication';
import type { Paged } from '@/lib/students';

type Tab = 'activity' | 'groups' | 'moderation';
const TAB_LABELS: Record<Tab, string> = { activity: 'Recent activity', groups: 'Groups', moderation: 'Moderation' };

/** Community home (docs/02 section 31): what is new in your groups, every group you can see or join, and the moderation queue. */
export default function CommunityPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <Community />
    </Suspense>
  );
}

function Community() {
  const { can } = useAuth();
  const params = useSearchParams();
  const raw = params.get('tab');
  const tabs: Tab[] = ['activity', 'groups', ...(can('community.moderate') ? (['moderation'] as Tab[]) : [])];
  const [tab, setTabState] = useState<Tab>((tabs as string[]).includes(raw ?? '') ? (raw as Tab) : 'activity');
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, '', t === 'activity' ? '/community' : `/community?tab=${t}`);
  };
  if (!can('community.view')) return <NotForYou what="the community" back="/dashboard" />;
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Community</h1>
        <p className="mt-1 text-sm text-slate-600">Class discussions, clubs and school-wide groups. Be kind, stay on topic, and keep personal details out. Teachers see everything students post.</p>
      </div>
      <PillGroup name="community-tab" options={tabs} value={tab} onChange={setTab} labels={(v) => TAB_LABELS[v]} />
      {tab === 'activity' && <ActivityView />}
      {tab === 'groups' && <GroupsView canCreate={can('community.manage')} />}
      {tab === 'moderation' && <ModerationView />}
    </div>
  );
}

function ActivityView() {
  const [items, setItems] = useState<FeedItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<FeedItem[]>('/community/feed').then(setItems).catch((e) => setError(errorMessage(e)));
  }, []);
  if (error) return <Alert>{error}</Alert>;
  if (!items) return <SkeletonRows rows={4} />;
  if (items.length === 0) {
    return (
      <Card title="Nothing yet">
        <p className="text-sm text-slate-600">Topics from your class discussions and groups appear here as people post. Open Groups to find one to join.</p>
      </Card>
    );
  }
  return (
    <MotionList className="space-y-2">
      {items.map((t) => (
        <TopicRow key={t.id} topic={t} groupName={t.groupName} />
      ))}
    </MotionList>
  );
}

function GroupsView({ canCreate }: { canCreate: boolean }) {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Paged<Group>>(`/community/groups?pageSize=100${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      .then((r) => setGroups(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, [q]);
  useEffect(load, [load]);
  const join = async (g: Group) => {
    setError(null);
    setNote(null);
    try {
      const after = await api<Group>(`/community/groups/${g.id}/join`, { method: 'POST' });
      setNote(after.membership?.status === 'pending' ? `Asked to join ${g.name}. A moderator will approve you.` : `You joined ${g.name}.`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const mine = groups?.filter((g) => g.membership) ?? [];
  const others = groups?.filter((g) => !g.membership) ?? [];
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      {canCreate && <CreateGroupForm onCreated={load} />}
      <Input label="Find a group" id="group-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name" />
      {!groups ? (
        <SkeletonRows rows={3} />
      ) : (
        <>
          <section aria-labelledby="my-groups">
            <h2 id="my-groups" className="text-lg font-semibold">
              Your groups
            </h2>
            {mine.length === 0 ? (
              <p className="mt-1 text-sm text-slate-600">You are not in any group yet. Class discussions open from each class page.</p>
            ) : (
              <MotionList className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mine.map((g) => (
                  <GroupCard key={g.id} group={g} />
                ))}
              </MotionList>
            )}
          </section>
          <section aria-labelledby="other-groups">
            <h2 id="other-groups" className="text-lg font-semibold">
              Groups you can join or read
            </h2>
            {others.length === 0 ? (
              <p className="mt-1 text-sm text-slate-600">No other groups right now.</p>
            ) : (
              <MotionList className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {others.map((g) => (
                  <div key={g.id} className="flex min-w-0 flex-col gap-2">
                    <GroupCard group={g} />
                    {(g.joinOutcome === 'active' || g.joinOutcome === 'pending') && (
                      <Button variant="secondary" onClick={() => void join(g)}>
                        {g.joinOutcome === 'active' ? `Join ${g.name}` : `Ask to join ${g.name}`}
                      </Button>
                    )}
                  </div>
                ))}
              </MotionList>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function CreateGroupForm({ onCreated }: { onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', description: '', kind: 'club' as 'club' | 'school', visibility: 'school' as GroupVisibility, joinPolicy: 'open' as JoinPolicy, studentsCanPost: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/community/groups', { method: 'POST', body: { ...form, description: form.description || undefined } });
      setForm({ ...form, name: '', description: '' });
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (!open) {
    return (
      <div>
        <Button variant="secondary" onClick={() => setOpen(true)}>
          New group
        </Button>
      </div>
    );
  }
  return (
    <Card title="New group" description="A club or a school-wide group. You become its first moderator; class discussions are made from each class page instead.">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        <Input label="Name" id="g-name" required minLength={2} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Select label="Kind" id="g-kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as 'club' | 'school' })}>
          <option value="club">Club</option>
          <option value="school">School-wide</option>
        </Select>
        <div className="sm:col-span-2">
          <TextArea label="What is it for?" id="g-description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} rows={2} maxLength={1000} />
        </div>
        <Select label="Who can read it" id="g-visibility" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as GroupVisibility })}>
          {(Object.keys(VISIBILITY_LABELS) as GroupVisibility[]).map((v) => (
            <option key={v} value={v}>
              {VISIBILITY_LABELS[v]}
            </option>
          ))}
        </Select>
        <Select label="How people join" id="g-join" value={form.joinPolicy} onChange={(e) => setForm({ ...form, joinPolicy: e.target.value as JoinPolicy })}>
          {(Object.keys(JOIN_LABELS) as JoinPolicy[]).map((v) => (
            <option key={v} value={v}>
              {JOIN_LABELS[v]}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.studentsCanPost} onChange={(e) => setForm({ ...form, studentsCanPost: e.target.checked })} />
          Students can post (otherwise they read and staff write)
        </label>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            Create group
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ModerationView() {
  const [queue, setQueue] = useState<Queue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const load = useCallback(() => {
    api<Queue>('/community/moderation').then(setQueue).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  const decide = async (type: 'topic' | 'post', id: string, action: ModerationAction) => {
    setError(null);
    try {
      await api(`/community/${type}s/${id}/moderate`, { method: 'POST', body: { action, note: notes[id] || undefined } });
      setNote(action === 'approve' ? 'Approved. The author has been told it is visible.' : `Done. The author has been told it was ${action === 'hide' ? 'hidden' : 'removed'}.`);
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const resolve = async (id: string) => {
    setError(null);
    try {
      await api(`/community/reports/${id}/resolve`, { method: 'POST', body: { resolution: resolutions[id] ?? 'dismiss', note: notes[id] || undefined } });
      setNote('Report closed.');
      load();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  if (error) return <Alert>{error}</Alert>;
  if (!queue) return <SkeletonRows rows={4} />;
  return (
    <div className="space-y-4">
      {note && <Alert kind="success">{note}</Alert>}
      <Card title={`Waiting for a look (${queue.held.length})`} description="Student words the safety check held: a way to be reached outside school, an outside link, or words that could hurt. Approve to show them, hide to keep them from others, remove to take them down.">
        {queue.held.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing is waiting.</p>
        ) : (
          <ul className="space-y-3">
            {queue.held.map((h) => (
              <li key={`${h.type}-${h.id}`} className="rounded-md bg-slate-50 p-3">
                <p className="text-xs text-slate-500">
                  {h.type === 'topic' ? 'Topic' : 'Reply'} in {h.groupName} · {h.author} · {timeAgo(h.createdAt)}
                </p>
                <p className="mt-1 font-medium">
                  <Link href={`/community/topics/${h.topicId}`} className="hover:underline">
                    {h.title}
                  </Link>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{h.excerpt}</p>
                {h.reason && <p className="mt-1 text-sm text-amber-800">{h.reason}</p>}
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_auto]">
                  <Input label="Note to the author (optional)" id={`held-note-${h.id}`} value={notes[h.id] ?? ''} onChange={(e) => setNotes({ ...notes, [h.id]: e.target.value })} />
                  <div className="flex flex-wrap items-end gap-2">
                    <Button onClick={() => void decide(h.type, h.id, 'approve')}>Approve</Button>
                    <Button variant="secondary" onClick={() => void decide(h.type, h.id, 'hide')}>
                      Hide
                    </Button>
                    <Button variant="danger" onClick={() => void decide(h.type, h.id, 'remove')}>
                      Remove
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={`Reports (${queue.reports.length})`} description="What members reported. Every decision is written to the audit log; the author hears about anything other than a dismissal.">
        {queue.reports.length === 0 ? (
          <p className="text-sm text-slate-600">No open reports.</p>
        ) : (
          <ul className="space-y-3">
            {queue.reports.map((r) => (
              <li key={r.id} className="rounded-md bg-slate-50 p-3">
                <p className="text-xs text-slate-500">
                  {r.targetType === 'topic' ? 'Topic' : 'Reply'} in {r.groupName} · reported by {r.reporter} · {timeAgo(r.createdAt)}
                </p>
                <p className="mt-1 font-medium">
                  <Link href={`/community/topics/${r.topicId}`} className="hover:underline">
                    {r.title}
                  </Link>
                </p>
                <p className="mt-1 whitespace-pre-wrap text-sm">{r.excerpt}</p>
                <p className="mt-1 text-sm">
                  <span className="font-medium">{REASON_LABELS[r.reason]}</span>
                  {r.details ? ` · ${r.details}` : ''}
                </p>
                <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <Select label="Decision" id={`report-res-${r.id}`} value={resolutions[r.id] ?? 'dismiss'} onChange={(e) => setResolutions({ ...resolutions, [r.id]: e.target.value as Resolution })}>
                    {(Object.keys(RESOLUTION_LABELS) as Resolution[]).map((v) => (
                      <option key={v} value={v}>
                        {RESOLUTION_LABELS[v]}
                      </option>
                    ))}
                  </Select>
                  <Input label="Note to the author (optional)" id={`report-note-${r.id}`} value={notes[r.id] ?? ''} onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })} />
                  <div className="flex items-end">
                    <Button variant="secondary" onClick={() => void resolve(r.id)}>
                      Close report
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
