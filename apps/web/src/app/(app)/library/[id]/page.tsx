'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { SkeletonRows } from '@/components/motion';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, download, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { FLAG_LABELS, KIND_LABELS, STATUS_LABELS, VISIBILITY_HELP, VISIBILITY_LABELS, statusClass, stars, type Collection, type LibraryItemDetail, type Visibility } from '@/lib/library';

/** One library item: what it is, how to use it, its versions, your rating, and the actions your role allows. */
export default function LibraryItemPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { user, can } = useAuth();
  const [item, setItem] = useState<LibraryItemDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState<{ title: string; description: string; visibility: Visibility } | null>(null);
  const [rating, setRating] = useState(5);
  const [comment, setComment] = useState('');
  const [flagReason, setFlagReason] = useState('broken');
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionId, setCollectionId] = useState('');
  const load = useCallback(() => {
    api<LibraryItemDetail>(`/library/items/${id}`)
      .then((r) => {
        setItem(r);
        setEdit({ title: r.title, description: r.description ?? '', visibility: r.visibility });
        if (r.myRating) {
          setRating(r.myRating.stars);
          setComment(r.myRating.comment ?? '');
        }
      })
      .catch((e) => setError(errorMessage(e)));
  }, [id]);
  useEffect(load, [load]);
  useEffect(() => {
    if (!can('library.create')) return;
    api<Collection[]>('/library/collections').then((r) => setCollections(r.filter((c) => c.canEdit))).catch(() => setCollections([]));
  }, [can]);

  const run = async (what: string, fn: () => Promise<void>, done?: string) => {
    setBusy(what);
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

  if (error && !item) return <Alert>{error}</Alert>;
  if (!item || !edit) return <SkeletonRows rows={6} />;
  const mine = item.createdById === user?.id;
  const save = (e: FormEvent) => {
    e.preventDefault();
    void run('save', async () => void (await api(`/library/items/${id}`, { method: 'PATCH', body: { title: edit.title, description: edit.description, visibility: edit.visibility } })), 'Saved.');
  };
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <Link href="/library" className="text-sm text-brand-700 hover:underline">
          Back to the library
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold">{item.title}</h1>
          <span className={`rounded px-1.5 py-0.5 text-xs ${statusClass(item.status)}`}>{STATUS_LABELS[item.status]}</span>
        </div>
        <p className="mt-1 text-sm text-slate-600">
          {KIND_LABELS[item.kind]} · {VISIBILITY_LABELS[item.visibility]} · version {item.version} · by {item.createdBy ?? 'unknown'} at {item.organizationName} · {stars(item.rating.average)}
          {item.rating.count ? ` from ${item.rating.count}` : ''}
        </p>
      </div>
      {error && <Alert>{error}</Alert>}
      {note && <Alert kind="success">{note}</Alert>}
      {item.reviewNote && item.status !== 'published' && <Alert kind="info">Reviewer&apos;s note: {item.reviewNote}</Alert>}

      <Card title="About">
        {item.description ? <p className="text-sm">{item.description}</p> : <p className="text-sm text-slate-600">No description.</p>}
        <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-[auto_1fr]">
          {item.subject && (
            <>
              <dt className="text-slate-600">Subject</dt>
              <dd>{item.subject}</dd>
            </>
          )}
          {item.gradeLevel && (
            <>
              <dt className="text-slate-600">Grade</dt>
              <dd>{item.gradeLevel}</dd>
            </>
          )}
          {item.topics.length > 0 && (
            <>
              <dt className="text-slate-600">Topics</dt>
              <dd>{item.topics.join(', ')}</dd>
            </>
          )}
          {item.standards.length > 0 && (
            <>
              <dt className="text-slate-600">Standards</dt>
              <dd>{item.standards.join(', ')}</dd>
            </>
          )}
          <dt className="text-slate-600">Used</dt>
          <dd>
            {item.counts.views} views · {item.counts.downloads} downloads · {item.counts.copies} copies
          </dd>
        </dl>
        <div className="mt-4 flex flex-wrap gap-2">
          {item.kind === 'h5p' && item.h5pContentId && (
            <Link href={`/content/${item.h5pContentId}`} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
              Open the activity
            </Link>
          )}
          {item.kind === 'document' && item.file && (
            <Button onClick={() => void download(`/library/items/${id}/download`, item.file?.name ?? 'document')}>Download {item.file.name}</Button>
          )}
          {item.kind === 'link' && item.url && (
            <a href={item.url} target="_blank" rel="noreferrer" className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
              Open the link
            </a>
          )}
          {item.kind === 'lesson_plan' && item.lessonPlanId && (
            <Link href={`/assistant?plan=${item.lessonPlanId}`} className="rounded-md bg-brand-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-brand-700">
              Open the lesson plan
            </Link>
          )}
          {can('library.create') && !mine && (
            <Button variant="secondary" loading={busy === 'copy'} onClick={() => void run('copy', async () => void (await api(`/library/items/${id}/copy`, { method: 'POST' })), 'Copied to My items as a private draft.')}>
              Copy to my school
            </Button>
          )}
        </div>
      </Card>

      {can('library.create') && collections.length > 0 && (
        <Card title="Add to a collection">
          <div className="flex flex-wrap items-end gap-2">
            <Select label="Collection" id="item-collection" value={collectionId} onChange={(e) => setCollectionId(e.target.value)}>
              <option value="">Choose</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
            <Button variant="secondary" disabled={!collectionId} loading={busy === 'collect'} onClick={() => void run('collect', async () => void (await api(`/library/collections/${collectionId}/items`, { method: 'POST', body: { itemId: id } })), 'Added to the collection.')}>
              Add
            </Button>
          </div>
          {item.collections.length > 0 && <p className="mt-2 text-xs text-slate-600">In: {item.collections.map((c) => c.title).join(', ')}</p>}
        </Card>
      )}

      {!mine && (
        <Card title="Your rating" description="Help colleagues find what works.">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run('rate', async () => void (await api(`/library/items/${id}/rate`, { method: 'POST', body: { stars: rating, comment: comment || undefined } })), 'Thanks for rating.');
            }}
            className="flex flex-wrap items-end gap-2"
          >
            <Select label="Stars" id="item-stars" value={rating} onChange={(e) => setRating(Number(e.target.value))}>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </Select>
            <Input label="Comment (optional)" id="item-comment" value={comment} onChange={(e) => setComment(e.target.value)} />
            <Button type="submit" variant="secondary" loading={busy === 'rate'}>
              Rate
            </Button>
          </form>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run('flag', async () => void (await api(`/library/items/${id}/flag`, { method: 'POST', body: { reason: flagReason } })), 'Reported. A moderator will look at it.');
            }}
            className="mt-4 flex flex-wrap items-end gap-2"
          >
            <Select label="Report a problem" id="item-flag" value={flagReason} onChange={(e) => setFlagReason(e.target.value)}>
              {Object.entries(FLAG_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="secondary" loading={busy === 'flag'}>
              Report
            </Button>
          </form>
        </Card>
      )}

      {item.canEdit && (
        <Card title="Edit" description="Changing the title or description records a new version. Widening who can see it may send it for review.">
          <form onSubmit={save} className="space-y-3">
            <Input label="Title" id="edit-title" required minLength={2} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
            <Input label="Description" id="edit-description" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
            <Select label="Who can see it" id="edit-visibility" value={edit.visibility} onChange={(e) => setEdit({ ...edit, visibility: e.target.value as Visibility })}>
              {(Object.keys(VISIBILITY_LABELS) as Visibility[]).map((v) => (
                <option key={v} value={v}>
                  {VISIBILITY_LABELS[v]}
                </option>
              ))}
            </Select>
            <p className="text-xs text-slate-600">{VISIBILITY_HELP[edit.visibility]}</p>
            <div className="flex flex-wrap justify-end gap-2">
              {item.status !== 'published' && item.status !== 'pending_review' && (
                <Button type="button" loading={busy === 'publish'} onClick={() => void run('publish', async () => void (await api(`/library/items/${id}/publish`, { method: 'POST' })), 'Published or sent for review.')}>
                  Publish
                </Button>
              )}
              {item.status === 'published' && (
                <Button type="button" variant="secondary" loading={busy === 'unpublish'} onClick={() => void run('unpublish', async () => void (await api(`/library/items/${id}/unpublish`, { method: 'POST' })), 'Back to draft.')}>
                  Unpublish
                </Button>
              )}
              <Button type="submit" variant="secondary" loading={busy === 'save'}>
                Save
              </Button>
              <Button
                type="button"
                variant="danger"
                loading={busy === 'delete'}
                onClick={() =>
                  void run('delete', async () => {
                    await api(`/library/items/${id}`, { method: 'DELETE' });
                    router.push('/library?tab=mine');
                  })
                }
              >
                Delete
              </Button>
            </div>
          </form>
        </Card>
      )}

      {item.canReview && item.status === 'pending_review' && (
        <Card title="Review" description={`The author wants this shared with ${VISIBILITY_LABELS[item.visibility].toLowerCase()}.`}>
          <div className="flex gap-2">
            <Button loading={busy === 'approve'} onClick={() => void run('approve', async () => void (await api(`/library/items/${id}/review`, { method: 'POST', body: { decision: 'approve' } })), 'Approved and published.')}>
              Approve
            </Button>
            <Button variant="secondary" loading={busy === 'reject'} onClick={() => void run('reject', async () => void (await api(`/library/items/${id}/review`, { method: 'POST', body: { decision: 'reject' } })), 'Sent back to the author.')}>
              Reject
            </Button>
          </div>
        </Card>
      )}

      <Card title="Versions" description="Every content change is kept. Restoring makes the old version the newest one.">
        <ul className="divide-y divide-slate-100 text-sm">
          {item.versions.map((v) => (
            <li key={v.version} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                Version {v.version}: {v.title}
                {v.note ? ` (${v.note})` : ''} · {new Date(v.createdAt).toLocaleString()}
              </span>
              {item.canEdit && v.version !== item.version && (
                <Button variant="secondary" loading={busy === `restore-${v.version}`} onClick={() => void run(`restore-${v.version}`, async () => void (await api(`/library/items/${id}/versions/${v.version}/restore`, { method: 'POST' })), `Version ${v.version} restored.`)}>
                  Restore
                </Button>
              )}
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
