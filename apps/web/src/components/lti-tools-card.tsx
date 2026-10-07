'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { tokenStore } from '@/lib/api';

/** External LTI tools a class can open; the launch page is served by the API and posts itself to the tool. */
export function LtiToolsCard({ classId, organizationId }: { classId: string; organizationId: string }) {
  const [tools, setTools] = useState<Array<{ id: string; name: string }> | null>(null);
  useEffect(() => {
    api<Array<{ id: string; name: string }>>(`/classes/${classId}/lti-tools`)
      .then(setTools)
      .catch(() => setTools([]));
  }, [classId]);
  if (!tools || tools.length === 0) return null;
  const open = async (toolId: string) => {
    // The launch page needs the bearer token, so it is fetched and written into a new tab rather than linked.
    const res = await fetch(`/api/v1/organizations/${organizationId}/lti/tools/${toolId}/launch?classId=${classId}`, { headers: { authorization: `Bearer ${tokenStore.access ?? ''}` } });
    const html = await res.text();
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
  };
  return (
    <Card title="Tools" description="Outside tools your school connected. Each opens in a new tab, signed in as you.">
      <ul className="flex flex-wrap gap-2">
        {tools.map((t) => (
          <li key={t.id}>
            <button type="button" className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50" onClick={() => void open(t.id)}>
              Open {t.name}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
