'use client';

import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { RosterSettings } from '@/components/roster-settings';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { ROLE_LABELS, useAuth } from '@/lib/auth';

interface OrganizationDetail {
  id: string;
  name: string;
  description: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  timezone: string;
  isActive: boolean;
  counts: { users: number; students: number; byRole: Record<string, number> };
}
interface Member {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
}

export default function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const [org, setOrg] = useState<OrganizationDetail | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [form, setForm] = useState({ name: '', description: '', email: '', phone: '', address: '', timezone: '' });
  const [member, setMember] = useState({ email: '', role: '' });
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});

  const load = useCallback(async () => {
    try {
      const o = await api<OrganizationDetail>(`/organizations/${id}`);
      setOrg(o);
      setForm({ name: o.name, description: o.description ?? '', email: o.email ?? '', phone: o.phone ?? '', address: o.address ?? '', timezone: o.timezone });
      setMembers((await api<{ data: Member[] }>(`/organizations/${id}/members?pageSize=200`)).data);
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api(`/organizations/${id}`, { method: 'PATCH', body: Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '')) });
      setState({ ok: 'Saved.' });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }

  async function addMember(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api(`/organizations/${id}/members`, { method: 'POST', body: { email: member.email, role: member.role || undefined } });
      setMember({ email: '', role: '' });
      setState({ ok: 'Member linked.' });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }

  if (!org) return state.error ? <Alert>{state.error}</Alert> : <p className="text-sm text-slate-500">Loading…</p>;
  const manage = can('organizations.manage');

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{org.name}</h1>
        <p className="text-sm text-slate-500">
          {org.counts.users} members · {org.counts.students} students ·{' '}
          {Object.entries(org.counts.byRole)
            .map(([r, n]) => `${n} ${ROLE_LABELS[r] ?? r}${n === 1 ? '' : 's'}`)
            .join(', ')}
        </p>
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}

      <Card title="Details">
        <form onSubmit={save} className="grid gap-3 md:grid-cols-3" noValidate>
          <Input label="Name" required disabled={!manage} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <Input label="Office email" type="email" disabled={!manage} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input label="Phone" disabled={!manage} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          <Input label="Address" disabled={!manage} value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          <Input label="Timezone" disabled={!manage} value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} />
          <Input label="Description" disabled={!manage} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          {manage && (
            <div className="md:col-span-3">
              <Button type="submit" loading={state.busy}>
                Save
              </Button>
            </div>
          )}
        </form>
      </Card>

      {can('organizations.roster') && <RosterSettings organizationId={id} />}
      <Card title="Members" description="Staff, students and parents attached to this organisation.">
        <table className="min-w-full text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Email</th>
              <th className="py-2 pr-4">Role</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {members.map((m) => (
              <tr key={m.id}>
                <td className="py-2 pr-4 font-medium text-slate-800">
                  {m.lastName}, {m.firstName}
                </td>
                <td className="py-2 pr-4 text-slate-600">{m.email}</td>
                <td className="py-2 pr-4">{ROLE_LABELS[m.role] ?? m.role}</td>
                <td className="py-2 capitalize">{m.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {manage && (
          <form onSubmit={addMember} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-3" noValidate>
            <Input label="Existing user's email" type="email" required value={member.email} onChange={(e) => setMember({ ...member, email: e.target.value })} />
            <Select label="Role (optional)" value={member.role} onChange={(e) => setMember({ ...member, role: e.target.value })}>
              <option value="">Keep current role</option>
              {Object.entries(ROLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
            <div className="flex items-end">
              <Button type="submit" loading={state.busy} className="w-full">
                Link member
              </Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}
