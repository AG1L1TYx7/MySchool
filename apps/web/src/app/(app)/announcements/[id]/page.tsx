'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AnnouncementCard } from '@/components/announcement-card';
import { SkeletonRows } from '@/components/motion';
import { Alert } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { Announcement } from '@/lib/communication';
import { useT } from '@/lib/i18n';

export default function AnnouncementPage() {
  const { id } = useParams<{ id: string }>();
  const t = useT();
  const [a, setA] = useState<Announcement | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Announcement>(`/announcements/${id}`).then(setA).catch((err) => setError(errorMessage(err)));
  }, [id]);
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Link href="/announcements" className="text-xs text-brand-700 hover:underline">
        {t('ann.back')}
      </Link>
      {error && <Alert>{error}</Alert>}
      {a ? <AnnouncementCard a={a} /> : !error && <SkeletonRows rows={3} />}
    </div>
  );
}
