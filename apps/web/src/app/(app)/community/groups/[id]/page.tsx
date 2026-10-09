'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { TextArea, TopicRow } from '@/components/community-cards';
import { MotionList, PillGroup, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { JOIN_LABELS, KIND_LABELS, VISIBILITY_LABELS, type Group, type GroupVisibility, type JoinPolicy, type Member, type Topic } from '@/lib/community';
import type { Paged } from '@/lib/students';

type Tab = 'topics' | 'members' | 'settings';
const TAB_LABELS: Record<Tab, string> = { topics: 'Topics', members: 'Members', settings: 'Settings' };

/** One group: its topics, a new-topic form, the members list and (for moderators) its settings. */
export default function GroupPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <GroupView />
    </Suspense>
  );
}

function GroupView() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const params = useSearchParams();
  const raw = params.get('tab');
  const [group, setGroup] = useState<Group | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Group>(`/community/groups/${id}`).then(setGroup).catch((e) => setError(errorMessage(e)));
  }, [id]);
  useEffect(load, [load]);
  const tabs: Tab[] = group ? ['topics', ...(group.membership || group.canModerate ? (['members'] as Tab[]) : []), ...(group.canModerate ? (['settings'] as Tab[]) : [])] : ['topics'];
  const [tab, setTabState] = useState<Tab>(raw === 'members' || raw === 'settings' ? raw : 'topics');
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, '', t === 'topics' ? `/community/groups/${id}` : `/community/groups/${id}?tab=${t}`);
  };
  if (error) {
    return (
      <div className="mx-auto max-w-4xl space-y-4">
        <h1 className="text-2xl font-semibold">Group</h1>
        <Alert>{error}</Alert>
        <Link href="/community?tab=groups" className="text-sm text-brand-700 hover:underline">
          Back to groups
        </Link>
      </div>
    );
  }
  if (!group) return <SkeletonRows rows={4} />;
  const effectiveTab = (tabs as string[]).includes(tab) ? tab : 'topics';
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <p className="text-sm text-slate-500">
          <Link href="/community?tab=groups" className="hover:underline">
            Community
          </Link>{' '}
          / {KIND_LABELS[group.kind]}
          {group.classId && (
            <>
              {' '}
              ·{' '}
              <Link href={`/classes/${group.classId}`} className="hover:underline">
                Open the class
              </Link>
            </>
          )}
        </p>
        <h1 className="text-2xl font-semibold">{group.name}</h1>
        {group.description && <p className="mt-1 text-sm text-slate-600">{group.description}</p>}
        <p className="mt-1 text-xs text-slate-500">
          {group.memberCount} member{group.memberCount === 1 ? '' : 's'} · {VISIBILITY_LABELS[group.visibility]} · {JOIN_LABELS[group.joinPolicy]}
          {group.status === 'archived' ? ' · Archived' : ''}
        </p>
        {group.postBlockedReason && <p className="mt-2 text-sm text-amber-800">{group.postBlockedReason}</p>}
      </div>
      <PillGroup name="group-tab" options={tabs} value={effectiveTab} onChange={setTab} labels={(v) => TAB_LABELS[v]} />
      {effectiveTab === 'topics' && <TopicsView group={group} canPost={group.canPost && can('community.post')} onChange={load} />}
      {effectiveTab === 'members' && <MembersView group={group} onChange={load} />}
      {effectiveTab === 'settings' && <SettingsView group={group} onChange={load} />}
    </div>
  );
}

function TopicsView({ group, canPost, onChange }: { group: Group; canPost: boolean; onChange: () => void }) {
  const [topics, setTopics] = useState<Topic[] | null>(null);
  const [q, setQ] = useState('');
  const [form, setForm] = useState({ title: '', body: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const load = useCallback(() => {
    api<Paged<Topic>>(`/community/groups/${group.id}/topics?pageSize=50${q ? `&q=${encodeURIComponent(q)}` : ''}`)
      .then((r) => setTopics(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, [group.id, q]);
  useEffect(load, [load]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const t = await api<Topic>(`/community/groups/${group.id}/topics`, { method: 'POST', body: form });
      setForm({ title: '', body: '' });
      setNote(t.status === 'held' ? `Posted, but it is waiting for a teacher. ${t.holdReason ?? ''}` : 'Posted.');
      load();
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-4">
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      {canPost && (
        <Card title="Start a topic" description="A question, an idea or something to share. Keep personal details such as phone numbers out; those wait for a teacher.">
          <form onSubmit={submit} className="space-y-3">
            <Input label="Title" id="topic-title" required minLength={2} maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <TextArea label="Your words" id="topic-body" required maxLength={4000} value={form.body} onChange={(v) => setForm({ ...form, body: v })} />
            <div className="flex justify-end">
              <Button type="submit" loading={busy}>
                Post topic
              </Button>
            </div>
          </form>
        </Card>
      )}
      <Input label="Search topics" id="topic-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Words in the title or text" />
      {!topics ? (
        <SkeletonRows rows={3} />
      ) : topics.length === 0 ? (
        <p className="text-sm text-slate-600">No topics yet.</p>
      ) : (
        <MotionList className="space-y-2">
          {topics.map((t) => (
            <TopicRow key={t.id} topic={t} />
          ))}
        </MotionList>
      )}
    </div>
  );
}

function MembersView({ group, onChange }: { group: Group; onChange: () => void }) {
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [muteDays, setMuteDays] = useState<Record<string, string>>({});
  const load = useCallback(() => {
    api<Member[]>(`/community/groups/${group.id}/members`).then(setMembers).catch((e) => setError(errorMessage(e)));
  }, [group.id]);
  useEffect(load, [load]);
  const change = async (userId: string, body: Record<string, unknown>, done: string) => {
    setError(null);
    setNote(null);
    try {
      setMembers(await api<Member[]>(`/community/groups/${group.id}/members/${userId}`, { method: 'PATCH', body }));
      setNote(done);
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const remove = async (userId: string) => {
    setError(null);
    try {
      await api(`/community/groups/${group.id}/members/${userId}`, { method: 'DELETE' });
      setNote('Removed.');
      load();
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const leave = async () => {
    setError(null);
    try {
      await api(`/community/groups/${group.id}/join`, { method: 'DELETE' });
      window.location.assign('/community?tab=groups');
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  if (error) return <Alert>{error}</Alert>;
  if (!members) return <SkeletonRows rows={3} />;
  const pending = members.filter((m) => m.status === 'pending');
  const active = members.filter((m) => m.status === 'active');
  return (
    <div className="space-y-4">
      {note && <Alert kind="success">{note}</Alert>}
      {group.canModerate && pending.length > 0 && (
        <Card title={`Asked to join (${pending.length})`}>
          <ul className="divide-y divide-slate-100">
            {pending.map((m) => (
              <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {m.name} <span className="text-xs text-slate-500">({m.role})</span>
                </span>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => void change(m.userId, { status: 'active' }, `${m.name} is in.`)}>
                    Approve
                  </Button>
                  <Button variant="ghost" onClick={() => void remove(m.userId)}>
                    Decline
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card title={`Members (${active.length})`} description={group.canModerate ? 'Moderators can pause a member for a few days, make someone a moderator, or remove them. The person is told.' : undefined}>
        <ul className="divide-y divide-slate-100">
          {active.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">
                {m.name} <span className="text-xs text-slate-500">({m.role}{m.memberRole === 'moderator' ? ', moderator' : ''})</span>
                {m.mutedUntil && new Date(m.mutedUntil) > new Date() && <span className="ml-2 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-800">Paused until {new Date(m.mutedUntil).toLocaleDateString()}</span>}
              </span>
              {group.canModerate && (
                <div className="flex flex-wrap items-end gap-2">
                  <Input label="Pause (days)" id={`mute-${m.userId}`} type="number" min={0} max={30} className="w-24" value={muteDays[m.userId] ?? ''} onChange={(e) => setMuteDays({ ...muteDays, [m.userId]: e.target.value })} />
                  <Button variant="secondary" onClick={() => void change(m.userId, { muteDays: Number(muteDays[m.userId] || 0) }, Number(muteDays[m.userId] || 0) > 0 ? `${m.name} is paused.` : `${m.name} can post again.`)}>
                    Apply pause
                  </Button>
                  <Button variant="ghost" onClick={() => void change(m.userId, { role: m.memberRole === 'moderator' ? 'member' : 'moderator' }, m.memberRole === 'moderator' ? `${m.name} is a member.` : `${m.name} is a moderator.`)}>
                    {m.memberRole === 'moderator' ? 'Make member' : 'Make moderator'}
                  </Button>
                  {group.kind !== 'class' && (
                    <Button variant="danger" onClick={() => void remove(m.userId)}>
                      Remove
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {group.membership && group.kind !== 'class' && (
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => void leave()}>
            Leave this group
          </Button>
        </div>
      )}
    </div>
  );
}

function SettingsView({ group, onChange }: { group: Group; onChange: () => void }) {
  const [form, setForm] = useState({ name: group.name, description: group.description ?? '', visibility: group.visibility, joinPolicy: group.joinPolicy, studentsCanPost: group.studentsCanPost });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    setError(null);
    try {
      await api(`/community/groups/${group.id}`, { method: 'PATCH', body: { ...form, description: form.description || '' } });
      setNote('Saved.');
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const archive = async () => {
    setBusy('archive');
    setError(null);
    try {
      await api(`/community/groups/${group.id}/${group.status === 'archived' ? 'restore' : 'archive'}`, { method: 'POST' });
      setNote(group.status === 'archived' ? 'The group is active again.' : 'Archived. Members can still read it; nobody can post.');
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  return (
    <Card title="Settings" description={group.kind === 'class' ? 'Class discussions follow the class roster, so who can read and join is fixed.' : undefined}>
      <form onSubmit={save} className="grid gap-3 sm:grid-cols-2">
        {error && (
          <div className="sm:col-span-2">
            <Alert>{error}</Alert>
          </div>
        )}
        {note && (
          <div className="sm:col-span-2">
            <Alert kind="success">{note}</Alert>
          </div>
        )}
        <Input label="Name" id="gs-name" required minLength={2} maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <div className="sm:col-span-2">
          <TextArea label="What is it for?" id="gs-description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} rows={2} maxLength={1000} />
        </div>
        {group.kind !== 'class' && (
          <>
            <Select label="Who can read it" id="gs-visibility" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as GroupVisibility })}>
              {(Object.keys(VISIBILITY_LABELS) as GroupVisibility[]).map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABELS[v]}
                </option>
              ))}
            </Select>
            <Select label="How people join" id="gs-join" value={form.joinPolicy} onChange={(e) => setForm({ ...form, joinPolicy: e.target.value as JoinPolicy })}>
              {(Object.keys(JOIN_LABELS) as JoinPolicy[]).map((v) => (
                <option key={v} value={v}>
                  {JOIN_LABELS[v]}
                </option>
              ))}
            </Select>
          </>
        )}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" checked={form.studentsCanPost} onChange={(e) => setForm({ ...form, studentsCanPost: e.target.checked })} />
          Students can post (otherwise they read and staff write)
        </label>
        <div className="flex flex-wrap justify-between gap-2 sm:col-span-2">
          <Button type="button" variant={group.status === 'archived' ? 'secondary' : 'danger'} loading={busy === 'archive'} onClick={() => void archive()}>
            {group.status === 'archived' ? 'Bring it back' : 'Archive this group'}
          </Button>
          <Button type="submit" loading={busy === 'save'}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}
