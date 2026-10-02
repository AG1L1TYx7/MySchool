'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Input } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const SSO_ERRORS: Record<string, string> = {
  sso_unknown: 'No SmartSchool account matches that email. Ask your school to add you, then try again.',
  sso_not_allowed: 'Your school has not enabled that sign-in provider for your email address.',
  sso_disabled: 'This account is not active. Ask your school office.',
  sso_no_email: 'The provider did not share an email address, so the account could not be matched.',
  sso_state: 'The sign-in request expired. Start again.',
  sso_denied: 'The sign-in was cancelled.',
  sso_not_configured: 'That sign-in provider is not set up on this server.',
};

export default function LoginPage() {
  const { login } = useAuth();
  const [providers, setProviders] = useState<Array<{ id: string; label: string }>>([]);
  const [ssoError, setSsoError] = useState<string | null>(null);
  useEffect(() => {
    api<{ data: Array<{ id: string; label: string }> }>('/auth/sso/providers', { auth: false }).then((r) => setProviders(r.data)).catch(() => setProviders([]));
    const code = new URLSearchParams(window.location.search).get('error');
    if (code) setSsoError(SSO_ERRORS[code] ?? 'Sign-in with the provider did not complete. Try again.');
  }, []);
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setUnverified(false);
    try {
      const result = await login({ email, password, rememberMe });
      if (result.mfaRequired) {
        sessionStorage.setItem('smartschool.mfa', JSON.stringify({ mfaToken: result.mfaToken, rememberMe }));
        router.push('/login/2fa');
      } else if (result.mfaSetupRequired) {
        router.replace('/settings/security?mfa=required');
      } else {
        router.replace('/dashboard');
      }
    } catch (err) {
      setError(errorMessage(err));
      if (err instanceof ApiError && err.code === 'auth.email_unverified') setUnverified(true);
    } finally {
      setBusy(false);
    }
  }

  async function resend() {
    try {
      const r = await api<{ message: string }>('/auth/resend-verification', { method: 'POST', body: { email }, auth: false });
      setResent(r.message);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="mt-1 text-sm text-slate-500">Welcome back. Use your school email address.</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        {unverified && !resent && (
          <Button type="button" variant="secondary" className="w-full" onClick={() => void resend()}>
            Send a new verification email
          </Button>
        )}
        {resent && <Alert kind="success">{resent}</Alert>}
        <Input label="Email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label="Password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex items-center justify-between text-sm">
          <label className="inline-flex items-center gap-2 text-slate-600">
            <input type="checkbox" className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
            Keep me signed in
          </label>
          <Link href="/forgot-password" className="font-medium text-brand-700 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={busy}>
          Sign in
        </Button>
      </form>
      {providers.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-center text-xs uppercase tracking-wide text-slate-500">Or sign in with your school account</p>
          {ssoError && <Alert>{ssoError}</Alert>}
          <div className="mt-2 grid gap-2">
            {providers.map((p) => (
              <a key={p.id} href={`/api/v1/auth/sso/${p.id}/start`} className="inline-flex w-full items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">
                Continue with {p.label}
              </a>
            ))}
          </div>
        </div>
      )}
      <p className="mt-6 text-center text-sm text-slate-600">
        New here?{' '}
        <Link href="/register" className="font-medium text-brand-700 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
