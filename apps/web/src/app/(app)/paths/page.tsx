'use client';

import { useCallback, useEffect, useState } from 'react';
import { SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { PathCard, ProfileCard } from '@/components/paths-cards';
import { Alert } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { LearningPath, Profile } from '@/lib/paths';

/** A student's own learning profile, next steps and paths (docs/02 sections 22 and 29). */
export default function PathsPage() {
  const { user, can } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [paths, setPaths] = useState<LearningPath[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isStudent = user?.role === 'student';
  const load = useCallback(() => {
    if (!isStudent) return;
    api<Profile>('/me/learning/profile').then(setProfile).catch((e) => setError(errorMessage(e)));
    api<LearningPath[]>('/me/learning/paths').then(setPaths).catch((e) => setError(errorMessage(e)));
  }, [isStudent]);
  useEffect(load, [load]);
  if (!can('learning.view') || user?.role !== 'student') return <NotForYou what="your learning path" back="/dashboard" />;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">My learning</h1>
        <p className="mt-1 text-sm text-slate-600">How things are going, what to work on next, and the paths your teachers set up for you. Steps tick themselves off when you finish the work.</p>
      </div>
      {error && <Alert>{error}</Alert>}
      {!profile ? <SkeletonRows rows={5} /> : <ProfileCard profile={profile} forStudent />}
      {paths && paths.length > 0 && (
        <section aria-label="Learning paths" className="space-y-4">
          <h2 className="text-lg font-semibold">My paths</h2>
          {paths
            .filter((p) => p.status !== 'archived')
            .map((p) => (
              <PathCard key={p.id} path={p} onChange={load} canEdit={false} />
            ))}
        </section>
      )}
    </div>
  );
}
