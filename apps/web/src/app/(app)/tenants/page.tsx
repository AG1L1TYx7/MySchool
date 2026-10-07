'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Tenant } from '@/lib/district';

/** Tenants (ADR-005): the platform administrator creates districts, hosts them on a subdomain or their own domain, and suspends them. English. */
export default function TenantsPage() {
  const { can } = useAuth();
  const [rows, setRows] = useState<Tenant[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const allowed = can('tenants.manage');
  const load = useCallback(() => {
    if (!allowed) return;
    api<{ data: Tenant[] }>('/tenants?pageSize=100')
      .then((r) => setRows(r.data))
      .catch((e) => setError(errorMessage(e)));
  }, [allowed]);
  useEffect(load, [load]);
  if (!allowed) return <NotForYou what="tenants" back="/dashboard" />;
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('/tenants', { method: 'POST', body: { name, ...(slug ? { slug } : {}) } });
      setName('');
      setSlug('');
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Tenants</h1>
        <p className="mt-1 text-sm text-slate-600">Each district is a tenant: its own schools, people, policies and sign-in page. Districts never see each other. A tenant signs in at its subdomain, or at its own domain once the DNS record below is in place.</p>
      </div>
      {error && <Alert>{error}</Alert>}
      <Card title="New district" description="The subdomain label is made from the name when left blank.">
        <form onSubmit={create} className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Input label="Name" id="tenant-name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
          <Input label="Subdomain label (optional)" id="tenant-slug" value={slug} onChange={(e) => setSlug(e.target.value)} hint="Lower-case letters, digits and hyphens" />
          <Button type="submit" loading={busy}>
            Create
          </Button>
        </form>
      </Card>
      {!rows ? <SkeletonRows rows={4} /> : rows.map((t) => <TenantCard key={t.id} tenant={t} onChange={load} />)}
    </div>
  );
}

function TenantCard({ tenant, onChange }: { tenant: Tenant; onChange: () => void }) {
  const [domain, setDomain] = useState(tenant.customDomain ?? '');
  const [status, setStatus] = useState(tenant.status);
  const [displayName, setDisplayName] = useState(tenant.branding.displayName ?? '');
  const [primaryColor, setPrimaryColor] = useState(tenant.branding.primaryColor ?? '#1e40af');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('save');
    setError(null);
    setNote(null);
    try {
      await api(`/tenants/${tenant.id}`, { method: 'PATCH', body: { status, customDomain: domain.trim(), branding: { displayName, primaryColor } } });
      setNote('Saved.');
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const verify = async () => {
    setBusy('verify');
    setError(null);
    setNote(null);
    try {
      const r = await api<{ verified: boolean; found: string[] }>(`/tenants/${tenant.id}/domain/verify`, { method: 'POST' });
      setNote(r.verified ? 'Domain verified. Sign-in at this domain now shows this district.' : `Record not found yet. DNS answered: ${r.found.length ? r.found.join('; ') : 'nothing'}. Records can take up to a day to spread.`);
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  return (
    <Card title={tenant.name} description={`${tenant.slug} · ${tenant.schools} school${tenant.schools === 1 ? '' : 's'} · created ${new Date(tenant.createdAt).toLocaleDateString()}`}>
      <form onSubmit={save} className="space-y-3">
        {error && <Alert>{error}</Alert>}
        {note && <Alert kind="info">{note}</Alert>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Status" id={`tenant-status-${tenant.id}`} value={status} onChange={(e) => setStatus(e.target.value as Tenant['status'])}>
            <option value="active">Active</option>
            <option value="trial">Trial</option>
            <option value="suspended">Suspended (nobody can sign in)</option>
          </Select>
          <Input label="Custom domain" id={`tenant-domain-${tenant.id}`} value={domain} onChange={(e) => setDomain(e.target.value)} hint="For example portal.district.k12.state.us; leave empty to use the subdomain only" />
          <Input label="Display name on the sign-in page" id={`tenant-brand-${tenant.id}`} value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          <Input label="Primary colour" id={`tenant-colour-${tenant.id}`} type="color" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
        </div>
        {tenant.verification && (
          <div className="rounded-lg bg-slate-50 p-3 text-sm">
            <p className="font-medium">{tenant.domainVerifiedAt ? 'Domain verified' : 'Add this DNS TXT record, then press Verify'}</p>
            <dl className="mt-1 grid gap-1 sm:grid-cols-[auto_1fr]">
              <dt className="text-slate-600">Name</dt>
              <dd className="break-all font-mono">{tenant.verification.name}</dd>
              <dt className="text-slate-600">Value</dt>
              <dd className="break-all font-mono">{tenant.verification.value}</dd>
            </dl>
          </div>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          {tenant.customDomain && !tenant.domainVerifiedAt && (
            <Button type="button" variant="secondary" loading={busy === 'verify'} onClick={verify}>
              Verify domain
            </Button>
          )}
          <Button type="submit" loading={busy === 'save'}>
            Save
          </Button>
        </div>
      </form>
    </Card>
  );
}
