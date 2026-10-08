'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { MotionItem, MotionList, PillGroup, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage, upload } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { KIND_LABELS, STATUS_LABELS, VISIBILITY_HELP, VISIBILITY_LABELS, statusClass, type Collection, type LibraryItem, type LibraryKind, type ModerationQueue, type Visibility } from '@/lib/library';

type Tab = 'browse' | 'mine' | 'collections' | 'moderation';
const TAB_LABELS: Record<Tab, string> = { browse: 'Browse', mine: 'My items', collections: 'Collections', moderation: 'Review' };

/** Library (docs/02 sections 10 and 30): what the school, the district and everyone share, searched by meaning. English. */
export default function LibraryPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <Library />
    </Suspense>
  );
}

function Library() {
  const { can } = useAuth();
  const params = useSearchParams();
  const raw = params.get('tab');
  const tabs: Tab[] = ['browse', ...(can('library.create') ? (['mine', 'collections'] as Tab[]) : (['collections'] as Tab[])), ...(can('library.moderate') ? (['moderation'] as Tab[]) : [])];
  // The tab lives in state and is only mirrored to the URL: re-rendering from the URL would remount the forms and lose typed input.
  const [tab, setTabState] = useState<Tab>((tabs as string[]).includes(raw ?? '') ? (raw as Tab) : 'browse');
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, '', t === 'browse' ? '/library' : `/library?tab=${t}`);
  };
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Library</h1>
        <p className="mt-1 text-sm text-slate-600">Interactive content, documents, links and lesson plans shared by teachers at your school, across the district and beyond. Search by what you mean, not only by the words in the title.</p>
      </div>
      <PillGroup name="library-tab" options={tabs} value={tab} onChange={setTab} labels={(v) => TAB_LABELS[v]} />
      {tab === 'browse' && <BrowseView />}
      {tab === 'mine' && <MineView />}
      {tab === 'collections' && <CollectionsView canCreate={can('library.create')} />}
      {tab === 'moderation' && <ModerationView />}
    </div>
  );
}

function ItemCard({ item }: { item: LibraryItem }) {
  return (
    <MotionItem className="flex h-full flex-col rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-start justify-between gap-2">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{KIND_LABELS[item.kind]}</span>
        {item.status !== 'published' && <span className={`rounded px-1.5 py-0.5 text-xs ${statusClass(item.status)}`}>{STATUS_LABELS[item.status]}</span>}
        {item.featured && <span className="rounded bg-brand-50 px-1.5 py-0.5 text-xs text-brand-700">Featured</span>}
      </div>
      <h2 className="mt-2 font-medium">
        <Link href={`/library/${item.id}`} className="hover:underline">
          {item.title}
        </Link>
      </h2>
      {item.description && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{item.description}</p>}
      <p className="mt-auto pt-3 text-xs text-slate-600">
        {[item.subject, item.gradeLevel ? `Grade ${item.gradeLevel}` : null, item.organizationName, item.rating.average !== null ? `${item.rating.average} of 5 (${item.rating.count})` : null].filter(Boolean).join(' · ')}
      </p>
    </MotionItem>
  );
}

function ItemGrid({ items, empty }: { items: LibraryItem[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-slate-600">{empty}</p>;
  return (
    <MotionList className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((i) => (
        <ItemCard key={i.id} item={i} />
      ))}
    </MotionList>
  );
}

function BrowseView() {
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [subject, setSubject] = useState('');
  const [gradeLevel, setGradeLevel] = useState('');
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [semantic, setSemantic] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      if (q.trim().length >= 2) {
        const r = await api<{ semantic: boolean; data: LibraryItem[] }>(`/library/items/search?q=${encodeURIComponent(q.trim())}${kind ? `&kind=${kind}` : ''}`);
        setItems(r.data.filter((i) => (!subject || (i.subject ?? '').toLowerCase().includes(subject.toLowerCase())) && (!gradeLevel || i.gradeLevel === gradeLevel)));
        setSemantic(r.semantic);
      } else {
        const p = new URLSearchParams({ pageSize: '60' });
        if (kind) p.set('kind', kind);
        if (subject) p.set('subject', subject);
        if (gradeLevel) p.set('gradeLevel', gradeLevel);
        setItems((await api<{ data: LibraryItem[] }>(`/library/items?${p.toString()}`)).data);
        setSemantic(null);
      }
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [q, kind, subject, gradeLevel]);
  useEffect(() => {
    const t = setTimeout(() => void load(), 250);
    return () => clearTimeout(t);
  }, [load]);
  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Input label="Search by meaning" id="lib-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="fractions practice for fifth grade" />
          </div>
          <Select label="Kind" id="lib-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Any kind</option>
            {(Object.keys(KIND_LABELS) as LibraryKind[]).map((k) => (
              <option key={k} value={k}>
                {KIND_LABELS[k]}
              </option>
            ))}
          </Select>
          <Input label="Subject" id="lib-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <Input label="Grade" id="lib-grade" value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)} placeholder="5" />
        </div>
        {semantic === false && <p className="mt-2 text-xs text-slate-600">The AI service is away, so this is a word match only.</p>}
      </Card>
      {error && <Alert>{error}</Alert>}
      {!items ? <SkeletonRows rows={4} /> : <ItemGrid items={items} empty="Nothing here yet. Try other words, or widen the filters." />}
    </div>
  );
}

function MineView() {
  const { user } = useAuth();
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<LibraryKind>('h5p');
  const [form, setForm] = useState({ title: '', description: '', subject: '', gradeLevel: '', topics: '', standards: '', visibility: 'school' as Visibility, h5pContentId: '', url: '', lessonPlanId: '' });
  const [file, setFile] = useState<File | null>(null);
  const [contents, setContents] = useState<Array<{ id: string; title: string }>>([]);
  const [plans, setPlans] = useState<Array<{ id: string; topic: string }>>([]);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const load = useCallback(() => {
    api<{ data: LibraryItem[] }>('/library/items?mine=true&pageSize=100').then((r) => setItems(r.data)).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    api<Array<{ id: string; title: string }>>('/h5p/contents?pageSize=100').then((r) => setContents(Array.isArray(r) ? r : [])).catch(() => setContents([]));
    api<{ data: Array<{ id: string; topic: string }> }>('/assistant/lesson-plans?pageSize=100').then((r) => setPlans(r.data ?? [])).catch(() => setPlans([]));
  }, []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      let fileId: string | undefined;
      if (kind === 'document') {
        if (!file) throw new Error('Choose a file to share.');
        fileId = (await upload<{ id: string }>('/files', file)).id;
      }
      const body = {
        kind,
        title: form.title,
        description: form.description || undefined,
        subject: form.subject || undefined,
        gradeLevel: form.gradeLevel || undefined,
        topics: form.topics.split(',').map((t) => t.trim()).filter(Boolean),
        standards: form.standards.split(',').map((t) => t.trim()).filter(Boolean),
        visibility: form.visibility,
        ...(kind === 'h5p' ? { h5pContentId: form.h5pContentId } : {}),
        ...(kind === 'document' ? { fileId } : {}),
        ...(kind === 'link' ? { url: form.url } : {}),
        ...(kind === 'lesson_plan' ? { lessonPlanId: form.lessonPlanId } : {}),
      };
      const item = await api<LibraryItem>('/library/items', { method: 'POST', body });
      setSaved(item.title);
      setForm({ ...form, title: '', description: '', url: '', topics: '', standards: '' });
      setFile(null);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const visibilities = (user?.role === 'student' || user?.role === 'parent' ? ['private'] : ['private', 'school', 'district', 'public']) as Visibility[];
  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      {saved && (
        <Alert kind="success">
          Added {saved} as a draft. Open it under My items to publish it.
        </Alert>
      )}
      <Card title="Add to the library" description="Items start as drafts. Publish from the item page; school-wide items go live at once, district and public items are reviewed first.">
        <form onSubmit={submit} className="space-y-3">
          <PillGroup name="library-kind" options={Object.keys(KIND_LABELS) as LibraryKind[]} value={kind} onChange={setKind} labels={(v) => KIND_LABELS[v]} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Title" id="lib-title" required minLength={2} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <Select label="Who can see it" id="lib-visibility" value={form.visibility} onChange={(e) => setForm({ ...form, visibility: e.target.value as Visibility })}>
              {visibilities.map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABELS[v]}
                </option>
              ))}
            </Select>
            <div className="sm:col-span-2">
              <Input label="Description" id="lib-description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <Input label="Subject" id="lib-form-subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            <Input label="Grade level" id="lib-form-grade" value={form.gradeLevel} onChange={(e) => setForm({ ...form, gradeLevel: e.target.value })} />
            <Input label="Topics (comma separated)" id="lib-topics" value={form.topics} onChange={(e) => setForm({ ...form, topics: e.target.value })} />
            <Input label="Standards (comma separated)" id="lib-standards" value={form.standards} onChange={(e) => setForm({ ...form, standards: e.target.value })} placeholder="CCSS.MATH.5.NF.1" />
            {kind === 'h5p' && (
              <Select label="Interactive content" id="lib-h5p" required value={form.h5pContentId} onChange={(e) => setForm({ ...form, h5pContentId: e.target.value })}>
                <option value="">Choose from your content</option>
                {contents.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </Select>
            )}
            {kind === 'document' && (
              <div>
                <label htmlFor="lib-file" className="block text-sm font-medium text-slate-700">
                  File
                </label>
                <input id="lib-file" type="file" className="mt-1 block w-full text-sm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              </div>
            )}
            {kind === 'link' && <Input label="Web address" id="lib-url" type="url" required value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" />}
            {kind === 'lesson_plan' && (
              <Select label="Lesson plan" id="lib-plan" required value={form.lessonPlanId} onChange={(e) => setForm({ ...form, lessonPlanId: e.target.value })}>
                <option value="">Choose one of your plans</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.topic}
                  </option>
                ))}
              </Select>
            )}
          </div>
          <p className="text-xs text-slate-600">{VISIBILITY_HELP[form.visibility]}</p>
          <div className="flex justify-end">
            <Button type="submit" loading={busy}>
              Add item
            </Button>
          </div>
        </form>
      </Card>
      <Card title="My items" description="Everything you added, in any state.">
        {!items ? <SkeletonRows rows={3} /> : <ItemGrid items={items} empty="You have not added anything yet." />}
      </Card>
    </div>
  );
}

function CollectionsView({ canCreate }: { canCreate: boolean }) {
  const [rows, setRows] = useState<Collection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('school');
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    api<Collection[]>('/library/collections').then(setRows).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('create');
    try {
      await api('/library/collections', { method: 'POST', body: { title, visibility } });
      setTitle('');
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const follow = async (c: Collection) => {
    setBusy(c.id);
    try {
      await api(`/library/collections/${c.id}/follow`, { method: c.following ? 'DELETE' : 'POST' });
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      {canCreate && (
        <Card title="New collection" description="A named set of items, for a unit, a grade team or a department. Add items from each item's page.">
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <Input label="Title" id="col-title" required minLength={2} value={title} onChange={(e) => setTitle(e.target.value)} />
            <Select label="Who can see it" id="col-visibility" value={visibility} onChange={(e) => setVisibility(e.target.value as Visibility)}>
              {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABELS[v]}
                </option>
              ))}
            </Select>
            <Button type="submit" loading={busy === 'create'}>
              Create
            </Button>
          </form>
        </Card>
      )}
      {!rows ? (
        <SkeletonRows rows={3} />
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-600">No collections you can see yet.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {rows.map((c) => (
            <li key={c.id} className="rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200">
              <h2 className="font-medium">
                <Link href={`/library/collections/${c.id}`} className="hover:underline">
                  {c.title}
                </Link>
              </h2>
              <p className="mt-1 text-xs text-slate-600">
                {c.itemCount} item{c.itemCount === 1 ? '' : 's'} · {c.followerCount} follower{c.followerCount === 1 ? '' : 's'} · {VISIBILITY_LABELS[c.visibility]} · {c.organizationName}
              </p>
              <div className="mt-2">
                <Button variant="secondary" loading={busy === c.id} onClick={() => follow(c)}>
                  {c.following ? 'Unfollow' : 'Follow'}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ModerationView() {
  const [queue, setQueue] = useState<ModerationQueue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    api<ModerationQueue>('/library/moderation').then(setQueue).catch((e) => setError(errorMessage(e)));
  }, []);
  useEffect(load, [load]);
  const review = async (id: string, decision: 'approve' | 'reject') => {
    setBusy(id);
    try {
      await api(`/library/items/${id}/review`, { method: 'POST', body: { decision } });
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const resolve = async (id: string, action: 'dismiss' | 'unpublish') => {
    setBusy(id);
    try {
      await api(`/library/flags/${id}/resolve`, { method: 'POST', body: { action } });
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  if (error) return <Alert>{error}</Alert>;
  if (!queue) return <SkeletonRows rows={4} />;
  return (
    <div className="space-y-6">
      <Card title="Waiting for review" description="Items teachers want to share with the district or with everyone. Approve to publish; reject to send them back.">
        {queue.pending.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing waiting.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {queue.pending.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <Link href={`/library/${i.id}`} className="font-medium hover:underline">
                    {i.title}
                  </Link>
                  <p className="text-xs text-slate-600">
                    {KIND_LABELS[i.kind]} · wants {VISIBILITY_LABELS[i.visibility]} · by {i.createdBy ?? 'unknown'} at {i.organizationName}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button loading={busy === i.id} onClick={() => review(i.id, 'approve')}>
                    Approve
                  </Button>
                  <Button variant="secondary" loading={busy === i.id} onClick={() => review(i.id, 'reject')}>
                    Reject
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Reports" description="Readers flagged these. Dismiss the report or take the item down.">
        {queue.flags.length === 0 ? (
          <p className="text-sm text-slate-600">No open reports.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {queue.flags.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <Link href={`/library/${f.item.id}`} className="font-medium hover:underline">
                    {f.item.title}
                  </Link>
                  <p className="text-xs text-slate-600">
                    {f.reason} · reported by {f.reportedBy} on {new Date(f.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" loading={busy === f.id} onClick={() => resolve(f.id, 'dismiss')}>
                    Dismiss
                  </Button>
                  <Button variant="danger" loading={busy === f.id} onClick={() => resolve(f.id, 'unpublish')}>
                    Take down
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
