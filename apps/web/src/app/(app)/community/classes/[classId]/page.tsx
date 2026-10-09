'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SkeletonRows } from '@/components/motion';
import { Alert } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { Group } from '@/lib/community';

/** Opens (and on first use creates) the class discussion, then goes to the group page. */
export default function ClassDiscussionPage() {
  const { classId } = useParams<{ classId: string }>();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api<Group>(`/community/classes/${classId}`)
      .then((g) => router.replace(`/community/groups/${g.id}`))
      .catch((e) => setError(errorMessage(e)));
  }, [classId, router]);
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold">Class discussion</h1>
      {error ? (
        <>
          <Alert>{error}</Alert>
          <Link href={`/classes/${classId}`} className="text-sm text-brand-700 hover:underline">
            Back to the class
          </Link>
        </>
      ) : (
        <SkeletonRows rows={3} />
      )}
    </div>
  );
}
