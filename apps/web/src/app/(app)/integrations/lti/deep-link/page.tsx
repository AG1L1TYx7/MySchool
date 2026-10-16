'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { SkeletonRows } from '@/components/motion';
import { Alert, Button, Card } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { LtiDeepLinkContext } from '@/lib/integrations';

/**
 * The deep-linking picker (slice 30): the LMS asked which SmartSchool assignments to place in a course. The
 * choice is posted as a plain form so the browser carries the signed answer back to the LMS itself.
 */
export default function DeepLinkPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={3} />}>
      <Picker />
    </Suspense>
  );
}

function Picker() {
  const params = useSearchParams();
  const ticket = params.get('dl') ?? '';
  const [data, setData] = useState<LtiDeepLinkContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  useEffect(() => {
    if (!ticket) {
      setError('Open this page from your LMS; it needs a launch to know which course asked.');
      return;
    }
    api<LtiDeepLinkContext>(`/lti/deep-link/${encodeURIComponent(ticket)}`)
      .then(setData)
      .catch((e) => setError(errorMessage(e)));
  }, [ticket]);
  const toggle = (id: string) => setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
  if (error) return <Alert>{error}</Alert>;
  if (!data) return <SkeletonRows rows={3} />;
  return (
    <Card title={`Add SmartSchool assignments to ${data.context ?? 'your course'}`} description={`${data.platform} asked which assignments to place in the course. Each one becomes a link in the LMS with its own grade column; grades you post here are sent to it.`}>
      <form method="post" action={`/api/v1/lti/deep-link/${encodeURIComponent(ticket)}/respond`} className="space-y-4">
        {data.classes.length === 0 && <p className="text-sm text-slate-600">You have no classes with assignments yet. Create an assignment in SmartSchool first, then open this picker again.</p>}
        {data.classes.map((c) => (
          <fieldset key={c.id} className="rounded-md ring-1 ring-slate-200">
            <legend className="px-2 text-sm font-medium">{c.name}</legend>
            <ul className="divide-y divide-slate-100 px-3">
              {c.assignments.length === 0 && <li className="py-2 text-sm text-slate-600">No assignments in this class.</li>}
              {c.assignments.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2 text-sm">
                  <input id={`a-${a.id}`} type="checkbox" name="assignmentIds" value={a.id} checked={chosen.includes(a.id)} onChange={() => toggle(a.id)} className="h-4 w-4 rounded border-slate-300" />
                  <label htmlFor={`a-${a.id}`} className="flex-1">
                    {a.title} <span className="text-xs text-slate-500">· {a.maxPoints} points · {a.status}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
        ))}
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-slate-600">{chosen.length === 0 ? 'Choose at least one assignment, or send nothing to cancel.' : `${chosen.length} chosen.`}</p>
          <Button type="submit">{chosen.length === 0 ? 'Return without adding' : `Add ${chosen.length} to the course`}</Button>
        </div>
      </form>
    </Card>
  );
}
