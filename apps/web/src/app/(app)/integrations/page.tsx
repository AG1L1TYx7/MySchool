'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState, type FormEvent } from 'react';
import { PillGroup, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { EVENT_LABELS, SCOPE_LABELS, statusClass, type ApiKey, type Delivery, type LtiPlatform, type LtiTool, type Webhook } from '@/lib/integrations';

type Tab = 'webhooks' | 'api-keys' | 'lti';
const TABS: readonly Tab[] = ['webhooks', 'api-keys', 'lti'];
const TAB_LABELS: Record<Tab, string> = { webhooks: 'Webhooks', 'api-keys': 'API keys', lti: 'LTI 1.3' };

/** Integrations (docs/02 section 33): what IT connects to the school. Administrators, English. */
export default function IntegrationsPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <Integrations />
    </Suspense>
  );
}

function Integrations() {
  const { user, can } = useAuth();
  const params = useSearchParams();
  const raw = params.get('tab');
  // The tab lives in state and is only mirrored to the URL: re-rendering from the URL would remount the forms and lose typed input.
  const [tab, setTabState] = useState<Tab>((TABS as readonly string[]).includes(raw ?? '') ? (raw as Tab) : 'webhooks');
  const setTab = (t: Tab) => {
    setTabState(t);
    window.history.replaceState(null, '', t === 'webhooks' ? '/integrations' : `/integrations?tab=${t}`);
  };
  if (!can('integrations.manage')) return <NotForYou what="integrations" back="/dashboard" />;
  const orgId = user?.organizationId ?? '';
  if (!orgId)
    return (
      <div className="mx-auto max-w-6xl space-y-6">
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <Alert kind="info">Integrations are set up per school. Sign in with a school account, or ask that school&apos;s principal, to manage its webhooks, API keys and LTI connections.</Alert>
      </div>
    );
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Integrations</h1>
        <p className="mt-1 text-sm text-slate-600">Webhooks tell your other systems when something happens here. API keys let a district tool read data with its own budget and scopes. LTI 1.3 runs SmartSchool inside Canvas or Schoology, and opens outside tools from a class.</p>
      </div>
      <PillGroup name="integrations-tab" options={TABS} value={tab} onChange={setTab} labels={(v) => TAB_LABELS[v]} />
      {tab === 'webhooks' && <WebhooksView orgId={orgId} />}
      {tab === 'api-keys' && <ApiKeysView orgId={orgId} />}
      {tab === 'lti' && <LtiView orgId={orgId} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

function WebhooksView({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<Webhook[] | null>(null);
  const [types, setTypes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [secret, setSecret] = useState<{ name: string; secret: string } | null>(null);
  const load = useCallback(() => {
    api<Webhook[]>(`/organizations/${orgId}/webhooks`).then(setRows).catch((e) => setError(errorMessage(e)));
    api<{ eventTypes: string[] }>(`/organizations/${orgId}/webhooks/event-types`).then((r) => setTypes(r.eventTypes)).catch(() => setTypes([]));
  }, [orgId]);
  useEffect(load, [load]);
  const toggle = (t: string) => setEvents(events.includes(t) ? events.filter((x) => x !== t) : [...events, t]);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const w = await api<Webhook>(`/organizations/${orgId}/webhooks`, { method: 'POST', body: { name, url, events } });
      setSecret({ name: w.name, secret: w.secret ?? '' });
      setName('');
      setUrl('');
      setEvents([]);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      {secret && (
        <Alert kind="success">
          Secret for {secret.name}, shown once. Give it to the receiver so it can check the signature header: <code className="break-all font-mono">{secret.secret}</code>
        </Alert>
      )}
      <Card title="New webhook" description="Every delivery is a POST with a JSON body and an X-Webhook-Signature header (sha256 HMAC of timestamp.body with the secret). Failed deliveries retry after 1, 2, 4, 8 and 16 minutes. Only https endpoints.">
        <form onSubmit={create} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Name" id="wh-name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="Endpoint URL" id="wh-url" type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://sis.district.org/hooks/smartschool" />
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Events (none selected means every event)</legend>
            <ul className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {types.map((t) => (
                <li key={t}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={events.includes(t)} onChange={() => toggle(t)} />
                    {EVENT_LABELS[t] ?? t} <span className="font-mono text-xs text-slate-600">{t}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="flex justify-end">
            <Button type="submit" loading={busy}>
              Create webhook
            </Button>
          </div>
        </form>
      </Card>
      {!rows ? <SkeletonRows rows={3} /> : rows.length === 0 ? <p className="text-sm text-slate-600">No webhooks yet.</p> : rows.map((w) => <WebhookCard key={w.id} orgId={orgId} hook={w} onChange={load} onSecret={(s) => setSecret({ name: w.name, secret: s })} />)}
    </div>
  );
}

function WebhookCard({ orgId, hook, onChange, onSecret }: { orgId: string; hook: Webhook; onChange: () => void; onSecret: (s: string) => void }) {
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<Delivery[] | null>(null);
  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what);
    setNote(null);
    try {
      await fn();
    } catch (err) {
      setNote(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const test = () =>
    run('test', async () => {
      const r = await api<{ status: string; responseCode: number | null; lastError: string | null }>(`/organizations/${orgId}/webhooks/${hook.id}/test`, { method: 'POST' });
      setNote(r.status === 'delivered' ? `Delivered, the receiver answered ${r.responseCode}.` : `Not delivered: ${r.lastError ?? `HTTP ${r.responseCode}`}. It will be retried.`);
      onChange();
    });
  const toggle = () => run('toggle', async () => void (await api(`/organizations/${orgId}/webhooks/${hook.id}`, { method: 'PATCH', body: { isActive: !hook.isActive } }), onChange()));
  const rotate = () => run('rotate', async () => onSecret((await api<Webhook>(`/organizations/${orgId}/webhooks/${hook.id}/rotate-secret`, { method: 'POST' })).secret ?? ''));
  const remove = () => run('remove', async () => void (await api(`/organizations/${orgId}/webhooks/${hook.id}`, { method: 'DELETE' }), onChange()));
  const history = () => run('history', async () => setDeliveries((await api<{ data: Delivery[] }>(`/organizations/${orgId}/webhooks/${hook.id}/deliveries?pageSize=20`)).data));
  return (
    <Card title={hook.name} description={`${hook.url} · ${hook.events.length ? hook.events.join(', ') : 'every event'} · ${hook.isActive ? 'active' : 'paused'}${hook.lastDeliveredAt ? ` · last delivered ${new Date(hook.lastDeliveredAt).toLocaleString()}` : ''}`}>
      {note && <Alert kind="info">{note}</Alert>}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" loading={busy === 'test'} onClick={test}>
          Send test
        </Button>
        <Button variant="secondary" loading={busy === 'history'} onClick={history}>
          Deliveries
        </Button>
        <Button variant="secondary" loading={busy === 'toggle'} onClick={toggle}>
          {hook.isActive ? 'Pause' : 'Resume'}
        </Button>
        <Button variant="secondary" loading={busy === 'rotate'} onClick={rotate}>
          Rotate secret
        </Button>
        <Button variant="danger" loading={busy === 'remove'} onClick={remove}>
          Delete
        </Button>
      </div>
      {deliveries && (
        <div className="mt-3 overflow-x-auto" tabIndex={0} role="region" aria-label={`Deliveries of ${hook.name}`}>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase tracking-wide text-slate-600">
              <tr>
                <th className="py-1 pr-3">When</th>
                <th className="py-1 pr-3">Event</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Attempts</th>
                <th className="py-1 pr-3">Response</th>
              </tr>
            </thead>
            <tbody>
              {deliveries.map((d) => (
                <tr key={d.id} className="border-t border-slate-100">
                  <td className="py-1 pr-3 text-slate-600">{new Date(d.createdAt).toLocaleString()}</td>
                  <td className="py-1 pr-3 font-mono text-xs">{d.eventType}</td>
                  <td className="py-1 pr-3">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${statusClass(d.status)}`}>{d.status}</span>
                  </td>
                  <td className="py-1 pr-3 tabular-nums">{d.attempts}</td>
                  <td className="py-1 pr-3">{d.responseCode ?? d.lastError ?? '—'}</td>
                </tr>
              ))}
              {deliveries.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-2 text-slate-600">
                    Nothing delivered yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// API keys
// ---------------------------------------------------------------------------

function ApiKeysView({ orgId }: { orgId: string }) {
  const [rows, setRows] = useState<ApiKey[] | null>(null);
  const [scopes, setScopes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [limit, setLimit] = useState(600);
  const [days, setDays] = useState('');
  const [busy, setBusy] = useState('');
  const [shown, setShown] = useState<{ name: string; key: string } | null>(null);
  const load = useCallback(() => {
    api<ApiKey[]>(`/organizations/${orgId}/api-keys`).then(setRows).catch((e) => setError(errorMessage(e)));
    api<{ scopes: string[] }>(`/organizations/${orgId}/api-keys/scopes`).then((r) => setScopes(r.scopes)).catch(() => setScopes([]));
  }, [orgId]);
  useEffect(load, [load]);
  const toggle = (s: string) => setChosen(chosen.includes(s) ? chosen.filter((x) => x !== s) : [...chosen, s]);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('create');
    setError(null);
    try {
      const k = await api<ApiKey>(`/organizations/${orgId}/api-keys`, { method: 'POST', body: { name, scopes: chosen, rateLimitPerMinute: limit, ...(days ? { expiresInDays: Number(days) } : {}) } });
      setShown({ name: k.name, key: k.key ?? '' });
      setName('');
      setChosen([]);
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const revoke = async (id: string) => {
    setBusy(id);
    try {
      await api(`/organizations/${orgId}/api-keys/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      {shown && (
        <Alert kind="success">
          Key for {shown.name}, shown once. Send it as the X-Api-Key header: <code className="break-all font-mono">{shown.key}</code>
        </Alert>
      )}
      <Card title="New API key" description="A key reads with the authority of the administrator who creates it, limited to the scopes ticked here and a budget of requests per minute. Keys cannot write.">
        <form onSubmit={create} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <Input label="Name" id="key-name" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} placeholder="District data warehouse" />
            <Input label="Requests per minute" id="key-limit" type="number" min={10} max={10000} value={limit} onChange={(e) => setLimit(Number(e.target.value))} />
            <Input label="Expires in days (optional)" id="key-days" type="number" min={1} max={3650} value={days} onChange={(e) => setDays(e.target.value)} />
          </div>
          <fieldset>
            <legend className="text-sm font-medium">Scopes</legend>
            <ul className="mt-1 grid gap-1 sm:grid-cols-2 lg:grid-cols-3">
              {scopes.map((s) => (
                <li key={s}>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={chosen.includes(s)} onChange={() => toggle(s)} />
                    {SCOPE_LABELS[s] ?? s} <span className="font-mono text-xs text-slate-600">{s}</span>
                  </label>
                </li>
              ))}
            </ul>
          </fieldset>
          <div className="flex justify-end">
            <Button type="submit" loading={busy === 'create'} disabled={chosen.length === 0}>
              Create key
            </Button>
          </div>
        </form>
      </Card>
      <Card title="Keys" description="The key itself is never shown again; revoke and create a new one if it is lost.">
        {!rows ? (
          <SkeletonRows rows={3} />
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="API keys table">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="py-1 pr-3">Name</th>
                  <th className="py-1 pr-3">Prefix</th>
                  <th className="py-1 pr-3">Scopes</th>
                  <th className="py-1 pr-3">Budget</th>
                  <th className="py-1 pr-3">Last used</th>
                  <th className="py-1 pr-3">Status</th>
                  <th className="py-1 pr-3"></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((k) => (
                  <tr key={k.id} className="border-t border-slate-100">
                    <td className="py-1 pr-3 font-medium">{k.name}</td>
                    <td className="py-1 pr-3 font-mono text-xs">ssk_{k.prefix}_…</td>
                    <td className="py-1 pr-3 text-xs">{k.scopes.join(', ')}</td>
                    <td className="py-1 pr-3 tabular-nums">{k.rateLimitPerMinute}/min</td>
                    <td className="py-1 pr-3 text-slate-600">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : 'never'}</td>
                    <td className="py-1 pr-3">{k.revokedAt ? 'revoked' : k.expiresAt && new Date(k.expiresAt) < new Date() ? 'expired' : 'active'}</td>
                    <td className="py-1 pr-3 text-right">
                      {!k.revokedAt && (
                        <Button variant="danger" loading={busy === k.id} onClick={() => revoke(k.id)}>
                          Revoke
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-2 text-slate-600">
                      No keys yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LTI
// ---------------------------------------------------------------------------

function LtiView({ orgId }: { orgId: string }) {
  const [platforms, setPlatforms] = useState<LtiPlatform[] | null>(null);
  const [tools, setTools] = useState<LtiTool[] | null>(null);
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [p, setP] = useState({ name: '', issuer: '', clientId: '', deploymentId: '', authorizationUrl: '', jwksUrl: '' });
  const [t, setT] = useState({ name: '', loginUrl: '', launchUrl: '' });
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    api<LtiPlatform[]>(`/organizations/${orgId}/lti/platforms`).then(setPlatforms).catch((e) => setError(errorMessage(e)));
    api<LtiTool[]>(`/organizations/${orgId}/lti/tools`).then(setTools).catch((e) => setError(errorMessage(e)));
    api<Record<string, unknown>>(`/lti/config.json?organizationId=${orgId}`, { auth: false }).then(setConfig).catch(() => setConfig(null));
  }, [orgId]);
  useEffect(load, [load]);
  const submit = async (what: 'platform' | 'tool', e: FormEvent) => {
    e.preventDefault();
    setBusy(what);
    setError(null);
    try {
      if (what === 'platform') {
        await api(`/organizations/${orgId}/lti/platforms`, { method: 'POST', body: { ...p, deploymentId: p.deploymentId || undefined } });
        setP({ name: '', issuer: '', clientId: '', deploymentId: '', authorizationUrl: '', jwksUrl: '' });
      } else {
        await api(`/organizations/${orgId}/lti/tools`, { method: 'POST', body: t });
        setT({ name: '', loginUrl: '', launchUrl: '' });
      }
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const remove = async (kind: 'platforms' | 'tools', id: string) => {
    setBusy(id);
    try {
      await api(`/organizations/${orgId}/lti/${kind}/${id}`, { method: 'DELETE' });
      load();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy('');
    }
  };
  const Row = ({ k, v }: { k: string; v: string }) => (
    <>
      <dt className="text-slate-600">{k}</dt>
      <dd className="break-all font-mono text-xs">{v}</dd>
    </>
  );
  return (
    <div className="space-y-6">
      {error && <Alert>{error}</Alert>}
      <Card title="SmartSchool inside your LMS" description="Register SmartSchool as an LTI 1.3 tool in Canvas or Schoology with these URLs, then add the platform below so launches are trusted.">
        {config ? (
          <dl className="grid gap-1 sm:grid-cols-[auto_1fr]">
            <Row k="Login initiation URL" v={String(config.oidc_initiation_url)} />
            <Row k="Target link URI" v={String(config.target_link_uri)} />
            <Row k="Public JWK URL" v={String(config.public_jwk_url)} />
            <Row k="Configuration JSON" v={`${typeof window !== 'undefined' ? window.location.origin : ''}/api/v1/lti/config.json?organizationId=${orgId}`} />
          </dl>
        ) : (
          <SkeletonRows rows={2} />
        )}
      </Card>
      <Card title="Platforms that launch SmartSchool" description="The issuer, client id, authorization and JWKS URLs come from the platform's developer key.">
        <form onSubmit={(e) => submit('platform', e)} className="grid gap-3 sm:grid-cols-2">
          <Input label="Name" id="p-name" required value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} placeholder="Canvas" />
          <Input label="Issuer" id="p-issuer" required value={p.issuer} onChange={(e) => setP({ ...p, issuer: e.target.value })} placeholder="https://canvas.instructure.com" />
          <Input label="Client id" id="p-client" required value={p.clientId} onChange={(e) => setP({ ...p, clientId: e.target.value })} />
          <Input label="Deployment id (optional)" id="p-deployment" value={p.deploymentId} onChange={(e) => setP({ ...p, deploymentId: e.target.value })} />
          <Input label="Authorization URL" id="p-auth" type="url" required value={p.authorizationUrl} onChange={(e) => setP({ ...p, authorizationUrl: e.target.value })} />
          <Input label="JWKS URL" id="p-jwks" type="url" required value={p.jwksUrl} onChange={(e) => setP({ ...p, jwksUrl: e.target.value })} />
          <div className="flex justify-end sm:col-span-2">
            <Button type="submit" loading={busy === 'platform'}>
              Add platform
            </Button>
          </div>
        </form>
        <ul className="mt-4 divide-y divide-slate-100">
          {platforms?.map((row) => (
            <li key={row.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <p className="font-medium">{row.name}</p>
                <p className="font-mono text-xs text-slate-600">{row.issuer} · client {row.clientId}</p>
              </div>
              <Button variant="danger" loading={busy === row.id} onClick={() => remove('platforms', row.id)}>
                Remove
              </Button>
            </li>
          ))}
          {platforms && platforms.length === 0 && <li className="py-2 text-sm text-slate-600">No platforms yet.</li>}
        </ul>
      </Card>
      <Card title="Tools SmartSchool opens" description="Register an external LTI 1.3 tool; give the tool the details shown under it. Teachers and students open tools from a class page.">
        <form onSubmit={(e) => submit('tool', e)} className="grid gap-3 sm:grid-cols-3">
          <Input label="Name" id="t-name" required value={t.name} onChange={(e) => setT({ ...t, name: e.target.value })} />
          <Input label="Login initiation URL" id="t-login" type="url" required value={t.loginUrl} onChange={(e) => setT({ ...t, loginUrl: e.target.value })} />
          <Input label="Launch URL" id="t-launch" type="url" required value={t.launchUrl} onChange={(e) => setT({ ...t, launchUrl: e.target.value })} />
          <div className="flex justify-end sm:col-span-3">
            <Button type="submit" loading={busy === 'tool'}>
              Add tool
            </Button>
          </div>
        </form>
        <ul className="mt-4 divide-y divide-slate-100">
          {tools?.map((row) => (
            <li key={row.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-medium">{row.name}</p>
                <Button variant="danger" loading={busy === row.id} onClick={() => remove('tools', row.id)}>
                  Remove
                </Button>
              </div>
              <dl className="mt-1 grid gap-1 sm:grid-cols-[auto_1fr]">
                <Row k="Issuer" v={row.platform.issuer} />
                <Row k="Authorization URL" v={row.platform.authorizationUrl} />
                <Row k="JWKS URL" v={row.platform.jwksUrl} />
                <Row k="Client id" v={row.platform.clientId} />
                <Row k="Deployment id" v={row.platform.deploymentId} />
              </dl>
            </li>
          ))}
          {tools && tools.length === 0 && <li className="py-2 text-sm text-slate-600">No tools yet.</li>}
        </ul>
      </Card>
    </div>
  );
}
