'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Card, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { ROLE_LABELS } from '@/lib/auth';

interface UserRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  twoFactorEnabled: boolean;
  lastLoginAt: string | null;
}
interface Paged<T> {
  data: T[];
  meta: { page: number; pageSize: number; totalItems: number; totalPages: number };
}

export default function UsersPage() {
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Paged<UserRow> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const q = new URLSearchParams({ page: String(page), pageSize: '20', sort: 'lastName' });
      if (search) q.set('search', search);
      setResult(await api<Paged<UserRow>>(`/users?${q.toString()}`));
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [page, search]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 200);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">Users</h1>
      <Card>
        <div className="mb-4 max-w-sm">
          <Input label="Search" placeholder="Name or email" value={search} onChange={(e) => (setPage(1), setSearch(e.target.value))} />
        </div>
        {error && <Alert>{error}</Alert>}
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4">Email</th>
                <th className="py-2 pr-4">Role</th>
                <th className="py-2 pr-4">Status</th>
                <th className="py-2 pr-4">2FA</th>
                <th className="py-2">Last sign-in</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result?.data.map((u) => (
                <tr key={u.id}>
                  <td className="py-2 pr-4 font-medium text-slate-800">
                    {u.lastName}, {u.firstName}
                  </td>
                  <td className="py-2 pr-4 text-slate-600">{u.email}</td>
                  <td className="py-2 pr-4">{ROLE_LABELS[u.role] ?? u.role}</td>
                  <td className="py-2 pr-4 capitalize">{u.status}</td>
                  <td className="py-2 pr-4">{u.twoFactorEnabled ? 'On' : 'Off'}</td>
                  <td className="py-2 text-slate-600">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {result && (
          <div className="mt-4 flex items-center justify-between text-sm text-slate-600">
            <span>
              {result.meta.totalItems} user{result.meta.totalItems === 1 ? '' : 's'}
            </span>
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
