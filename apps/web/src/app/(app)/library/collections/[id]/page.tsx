'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { KIND_LABELS, VISIBILITY_LABELS, type Collection } from '@/lib/library';

/** One collection: its items in order, follow or unfollow, and removal for its curator. */
export default function CollectionPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [c, setC] = useState<Collection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    api<Collection>(`/library/collections/${id}`).then(setC).catch((e) => setError(errorMessage(e)));
  }, [id]);
  useEffect(load, [load]);
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setError(null);
    try {
      await fn();
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  if (error && !c) return <Alert>{error}</Alert>;
  if (!c) return <SkeletonRows rows={4} />;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/library?tab=collections" className="text-sm text-brand-700 hover:underline">
          Back to collections
        </Link>
        <h1 className="mt-1 text-2xl font-semibold">{c.title}</h1>
        <p className="mt-1 text-sm text-slate-600">
          {c.itemCount} item{c.itemCount === 1 ? '' : 's'} · {c.followerCount} follower{c.followerCount === 1 ? '' : 's'} · {VISIBILITY_LABELS[c.visibility]} · curated by {c.createdBy ?? 'unknown'} at {c.organizationName}
        </p>
        {c.description && <p className="mt-2 text-sm">{c.description}</p>}
      </div>
      {error && <Alert>{error}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={busy === 'follow'} onClick={() => void run('follow', async () => void (await api(`/library/collections/${id}/follow`, { method: c.following ? 'DELETE' : 'POST' })))}>
          {c.following ? 'Unfollow' : 'Follow'}
        </Button>
        {c.canEdit && (
          <Button
            variant="danger"
            loading={busy === 'delete'}
            onClick={() =>
              void run('delete', async () => {
                await api(`/library/collections/${id}`, { method: 'DELETE' });
                router.push('/library?tab=collections');
              })
            }
          >
            Delete collection
          </Button>
        )}
      </div>
      <Card title="Items">
        {!c.items || c.items.length === 0 ? (
          <p className="text-sm text-slate-600">Nothing in this collection yet. Add items from an item&apos;s page.</p>
        ) : (
          <MotionList className="grid gap-3 sm:grid-cols-2">
            {c.items.map((i) => (
              <MotionItem key={i.id} className="flex items-start justify-between gap-3 rounded-lg bg-white p-4 shadow-sm ring-1 ring-slate-200">
                <div>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">{KIND_LABELS[i.kind]}</span>
                  <h3 className="mt-1 font-medium">
                    <Link href={`/library/${i.id}`} className="hover:underline">
                      {i.title}
                    </Link>
                  </h3>
                  <p className="text-xs text-slate-600">{[i.subject, i.gradeLevel ? `Grade ${i.gradeLevel}` : null].filter(Boolean).join(' · ')}</p>
                </div>
                {c.canEdit && (
                  <Button variant="secondary" loading={busy === i.id} onClick={() => void run(i.id, async () => void (await api(`/library/collections/${id}/items/${i.id}`, { method: 'DELETE' })))}>
                    Remove
                  </Button>
                )}
              </MotionItem>
            ))}
          </MotionList>
        )}
      </Card>
    </div>
  );
}
