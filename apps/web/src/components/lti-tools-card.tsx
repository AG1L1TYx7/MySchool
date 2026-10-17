'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Select } from '@/components/ui';
import { api, errorMessage, tokenStore } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface LineItem {
  id: string;
  label: string;
  scoreMaximum: number;
  tool: { id: string; name: string };
  assignment: { id: string; title: string } | null;
  scores: number;
}

interface ToolLink {
  id: string;
  title: string;
  tool: { id: string; name: string };
  graded: boolean;
}

/**
 * External LTI tools a class can open, and the content teachers placed from them (slice 30). Launch pages
 * are served by the API and post themselves to the tool, so they are fetched with the bearer token and
 * written into a new tab rather than linked.
 */
export function LtiToolsCard({ classId, organizationId }: { classId: string; organizationId: string }) {
  const { can } = useAuth();
  const [tools, setTools] = useState<Array<{ id: string; name: string }> | null>(null);
  const [links, setLinks] = useState<ToolLink[]>([]);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [assignments, setAssignments] = useState<Array<{ id: string; title: string }>>([]);
  const [pick, setPick] = useState({ assignmentId: '', toolId: '' });
  const [error, setError] = useState<string | null>(null);
  const staff = can('assignments.create');
  const load = useCallback(() => {
    api<Array<{ id: string; name: string }>>(`/classes/${classId}/lti-tools`)
      .then(setTools)
      .catch(() => setTools([]));
    api<ToolLink[]>(`/classes/${classId}/lti-links`)
      .then(setLinks)
      .catch(() => setLinks([]));
    api<LineItem[]>(`/classes/${classId}/lti-line-items`)
      .then(setLineItems)
      .catch(() => setLineItems([]));
    if (staff)
      api<{ data: Array<{ id: string; title: string }> }>(`/assignments?classId=${classId}&pageSize=200`)
        .then((r) => setAssignments(r.data))
        .catch(() => setAssignments([]));
  }, [classId, staff]);
  useEffect(load, [load]);
  if (!tools || (tools.length === 0 && links.length === 0)) return null;
  const openPage = async (path: string, method: 'GET' | 'POST') => {
    const res = await fetch(path, { method, headers: { authorization: `Bearer ${tokenStore.access ?? ''}` } });
    if (!res.ok) {
      setError('The tool could not be opened.');
      return;
    }
    const html = await res.text();
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.open();
    w.document.write(html);
    w.document.close();
    // The tool's page must not be able to navigate this tab (docs/21 F34).
    w.opener = null;
  };
  const assign = async () => {
    if (!pick.assignmentId || !pick.toolId) return;
    try {
      await api(`/classes/${classId}/lti-line-items`, { method: 'POST', body: pick });
      setPick({ assignmentId: '', toolId: '' });
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const remove = async (id: string) => {
    try {
      await api(`/classes/${classId}/lti-links/${id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <Card title="Tools" description={staff ? 'Outside tools your school connected. Open one, or pick content from it to place in this class; graded content sends its scores to the gradebook.' : 'Outside tools your school connected. Each opens in a new tab, signed in as you.'}>
      {error && <p className="mb-2 text-sm text-red-700">{error}</p>}
      {links.length > 0 && (
        <ul className="mb-3 divide-y divide-slate-100">
          {links.map((l) => (
            <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <p className="font-medium">{l.title}</p>
                <p className="text-xs text-slate-600">
                  {l.tool.name}
                  {l.graded ? ' · graded' : ''}
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => void openPage(`/api/v1/organizations/${organizationId}/lti/tools/${l.tool.id}/launch?classId=${classId}&linkId=${l.id}`, 'GET')}>
                  Open
                </Button>
                {staff && (
                  <Button variant="danger" onClick={() => void remove(l.id)}>
                    Remove
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {lineItems.length > 0 && (
        <ul className="mb-3 text-sm text-slate-700">
          {lineItems.map((l) => (
            <li key={l.id} className="py-1">
              {l.assignment?.title ?? l.label} is graded by {l.tool.name} ({l.scoreMaximum} points{l.scores ? `, ${l.scores} scores received` : ''})
            </li>
          ))}
        </ul>
      )}
      {staff && tools.length > 0 && assignments.length > 0 && (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <Select label="Let a tool grade an assignment" id="li-assignment" value={pick.assignmentId} onChange={(e) => setPick({ ...pick, assignmentId: e.target.value })}>
            <option value="">Choose an assignment</option>
            {assignments.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </Select>
          <Select label="Tool" id="li-tool" value={pick.toolId} onChange={(e) => setPick({ ...pick, toolId: e.target.value })}>
            <option value="">Choose a tool</option>
            {tools.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <Button variant="secondary" disabled={!pick.assignmentId || !pick.toolId} onClick={() => void assign()}>
            Connect
          </Button>
        </div>
      )}
      <ul className="flex flex-wrap gap-2">
        {tools.map((t) => (
          <li key={t.id} className="flex gap-2">
            <button type="button" className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50" onClick={() => void openPage(`/api/v1/organizations/${organizationId}/lti/tools/${t.id}/launch?classId=${classId}`, 'GET')}>
              Open {t.name}
            </button>
            {staff && (
              <button type="button" className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-brand-700 ring-1 ring-slate-300 hover:bg-slate-50" onClick={() => void openPage(`/api/v1/organizations/${organizationId}/lti/tools/${t.id}/deep-link?classId=${classId}`, 'POST')}>
              Pick content from {t.name}
            </button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
