'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Card, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

interface AuditRow {
  id: string;
  userId: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  ipAddress: string | null;
  httpMethod: string | null;
  requestPath: string | null;
  statusCode: number | null;
  timestamp: string;
}
interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

export default function AuditLogsPage() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<AuditRow> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ page: String(page), pageSize: '50' });
      if (action) q.set('action', action);
      setResult(await api<Paged<AuditRow>>(`/audit-logs?${q.toString()}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [page, action]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <Card>
        <div className="mb-4 max-w-sm">
          <Input label="Action starts with" placeholder="auth., users., access." value={action} onChange={(e) => (setPage(1), setAction(e.target.value))} />
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4">When</th>
                <th className="py-2 pr-4">Action</th>
                <th className="py-2 pr-4">Entity</th>
                <th className="py-2 pr-4">Actor</th>
                <th className="py-2 pr-4">Request</th>
                <th className="py-2">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result?.data.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap py-2 pr-4 text-slate-600">{new Date(r.timestamp).toLocaleString()}</td>
                  <td className="py-2 pr-4 font-mono text-xs">{r.action}</td>
                  <td className="py-2 pr-4 text-slate-600">{r.entityType ? `${r.entityType} ${r.entityId ?? ''}` : ''}</td>
                  <td className="py-2 pr-4 font-mono text-xs text-slate-600">{r.userId ?? 'anonymous'}</td>
                  <td className="py-2 pr-4 text-slate-600">
                    {r.httpMethod} {r.requestPath} {r.statusCode ? `→ ${r.statusCode}` : ''}
                  </td>
                  <td className="py-2 text-slate-600">{r.ipAddress}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result && (
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>{result.meta.totalItems} entries</span>
            <span className="flex gap-2">
              <button className="disabled:opacity-40" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span>
                Page {result.meta.page} of {Math.max(result.meta.totalPages, 1)}
              </span>
              <button className="disabled:opacity-40" disabled={page >= result.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </span>
          </div>
        )}
      </Card>
    </div>
  );
}
