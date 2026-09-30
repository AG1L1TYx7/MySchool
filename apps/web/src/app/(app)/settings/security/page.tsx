'use client';

/* eslint-disable @next/next/no-img-element */
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Session {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  rememberMe: boolean;
  current: boolean;
}

export default function SecurityPage() {
  const { user, reload } = useAuth();
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">Security</h1>
      <ChangePassword />
      {user?.twoFactorEnabled ? <DisableTwoFactor onDone={reload} /> : <EnableTwoFactor onDone={reload} />}
      <Sessions />
    </div>
  );
}

function ChangePassword() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [state, setState] = useState<{ error?: string; ok?: boolean; busy?: boolean }>({});
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setState({ error: 'The new passwords do not match.' });
    setState({ busy: true });
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
      setForm({ currentPassword: '', newPassword: '', confirm: '' });
      setState({ ok: true });
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  return (
    <Card title="Change password" description="Your other sessions are signed out when the password changes.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {state.error && <Alert>{state.error}</Alert>}
        {state.ok && <Alert kind="success">Password updated.</Alert>}
        <Input label="Current password" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="New password" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
          <Input label="Confirm new password" type="password" autoComplete="new-password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </div>
        <Button type="submit" loading={state.busy}>
          Update password
        </Button>
      </form>
    </Card>
  );
}

function EnableTwoFactor({ onDone }: { onDone: () => Promise<void> }) {
  const [setup, setSetup] = useState<{ otpauthUrl: string; qrDataUrl: string; manualKey: string } | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [state, setState] = useState<{ error?: string; busy?: boolean }>({});

  async function start() {
    setState({ busy: true });
    try {
      setSetup(await api('/auth/2fa/setup', { method: 'POST' }));
      setState({});
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function verify(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      const result = await api<{ backupCodes: string[] }>('/auth/2fa/verify', { method: 'POST', body: { code } });
      setBackupCodes(result.backupCodes);
      setState({});
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }

  if (backupCodes) {
    return (
      <Card title="Two-factor authentication is on" description="Save these backup codes somewhere safe. Each works once, and they are shown only now.">
        <ul className="grid grid-cols-2 gap-2 font-mono text-sm md:grid-cols-5">
          {backupCodes.map((c) => (
            <li key={c} className="rounded bg-slate-50 px-2 py-1 text-center">
              {c}
            </li>
          ))}
        </ul>
        <Button className="mt-4" onClick={() => void onDone()}>
          I have saved them
        </Button>
      </Card>
    );
  }

  return (
    <Card title="Two-factor authentication" description="Add a second step to sign-in using an authenticator app such as Google Authenticator, Authy or 1Password.">
      {state.error && <Alert>{state.error}</Alert>}
      {!setup ? (
        <Button className="mt-2" onClick={() => void start()} loading={state.busy}>
          Set up two-factor
        </Button>
      ) : (
        <form onSubmit={verify} className="mt-2 grid gap-6 md:grid-cols-[240px_1fr]" noValidate>
          <img src={setup.qrDataUrl} alt="QR code for your authenticator app" width={240} height={240} className="rounded-md ring-1 ring-slate-200" />
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Scan the code, or enter this key manually: <code className="font-mono text-xs">{setup.manualKey}</code>
            </p>
            <Input label="Six-digit code from the app" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} />
            <Button type="submit" loading={state.busy}>
              Turn on two-factor
            </Button>
          </div>
        </form>
      )}
    </Card>
  );
}

function DisableTwoFactor({ onDone }: { onDone: () => Promise<void> }) {
  const [form, setForm] = useState({ password: '', code: '' });
  const [state, setState] = useState<{ error?: string; busy?: boolean }>({});
  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api('/auth/2fa/disable', { method: 'POST', body: form });
      await onDone();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  return (
    <Card title="Two-factor authentication is on" description="Turning it off requires your password and a current code.">
      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        {state.error && <Alert>{state.error}</Alert>}
        <div className="grid gap-4 md:grid-cols-2">
          <Input label="Password" type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <Input label="Authenticator or backup code" inputMode="numeric" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
        </div>
        <Button type="submit" variant="danger" loading={state.busy}>
          Turn off two-factor
        </Button>
      </form>
    </Card>
  );
}

function Sessions() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setSessions((await api<{ data: Session[] }>('/auth/sessions')).data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  async function revoke(id: string) {
    await api(`/auth/sessions/${id}`, { method: 'DELETE' });
    await load();
  }
  return (
    <Card title="Active sessions" description="Devices currently signed in to your account.">
      {error && <Alert>{error}</Alert>}
      <ul className="divide-y divide-slate-100 text-sm">
        {sessions.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-4 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-slate-800">
                {s.userAgent ?? 'Unknown device'} {s.current && <span className="ml-1 rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">this device</span>}
              </p>
              <p className="text-xs text-slate-500">
                {s.ipAddress ?? 'unknown address'} · last used {new Date(s.lastUsedAt).toLocaleString()}
              </p>
            </div>
            {!s.current && (
              <Button variant="secondary" onClick={() => void revoke(s.id)}>
                Sign out
              </Button>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}
