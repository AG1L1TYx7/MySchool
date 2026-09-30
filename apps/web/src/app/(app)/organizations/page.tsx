'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Organization {
  id: string;
  name: string;
  description: string | null;
  email: string | null;
  phone: string | null;
  timezone: string;
  isActive: boolean;
}

export default function OrganizationsPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState<Organization[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', timezone: 'UTC' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setRows((await api<{ data: Organization[] }>('/organizations?pageSize=100&includeInactive=true')).data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/organizations', { method: 'POST', body: { name: form.name, email: form.email || undefined, timezone: form.timezone || undefined } });
      setForm({ name: '', email: '', timezone: 'UTC' });
      await load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-semibold">Organisations</h1>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 md:grid-cols-2">
        {rows.map((o) => (
          <Link key={o.id} href={`/organizations/${o.id}`} className="block rounded-xl bg-white p-5 shadow-sm ring-1 ring-slate-200 hover:ring-brand-300">
            <p className="font-semibold text-slate-900">
              {o.name} {!o.isActive && <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">inactive</span>}
            </p>
            <p className="mt-1 text-sm text-slate-500">{o.description ?? o.email ?? o.timezone}</p>
          </Link>
        ))}
      </div>
      {can('organizations.manage') && (
        <Card title="New organisation">
          <form onSubmit={create} className="grid gap-3 md:grid-cols-4" noValidate>
            <Input label="Name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input label="Office email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <Input label="Timezone" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
            <div className="flex items-end">
              <Button type="submit" loading={busy} className="w-full">
                Create
              </Button>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
