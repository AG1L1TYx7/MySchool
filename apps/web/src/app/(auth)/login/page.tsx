'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Input } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useT } from '@/lib/i18n';
import type { MessageKey } from '@/locales/en';

const SSO_ERROR_CODES = ['sso_unknown', 'sso_not_allowed', 'sso_disabled', 'sso_no_email', 'sso_state', 'sso_denied', 'sso_not_configured'] as const;

export default function LoginPage() {
  const { login } = useAuth();
  const t = useT();
  const [providers, setProviders] = useState<Array<{ id: string; label: string }>>([]);
  const [ssoErrorCode, setSsoErrorCode] = useState<string | null>(null);
  useEffect(() => {
    api<{ data: Array<{ id: string; label: string }> }>('/auth/sso/providers', { auth: false }).then((r) => setProviders(r.data)).catch(() => setProviders([]));
    const code = new URLSearchParams(window.location.search).get('error');
    if (code) setSsoErrorCode(code);
  }, []);
  const ssoError = ssoErrorCode ? ((SSO_ERROR_CODES as readonly string[]).includes(ssoErrorCode) ? t(`sso.${ssoErrorCode}` as MessageKey) : t('login.ssoFailed')) : null;
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
      <h1 className="text-xl font-semibold">{t('login.title')}</h1>
      <p className="mt-1 text-sm text-slate-500">{t('login.subtitle')}</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        {unverified && !resent && (
          <Button type="button" variant="secondary" className="w-full" onClick={() => void resend()}>
            {t('login.resend')}
          </Button>
        )}
        {resent && <Alert kind="success">{resent}</Alert>}
        <Input label={t('login.email')} name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Input label={t('login.password')} name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <div className="flex items-center justify-between text-sm">
          <label className="inline-flex items-center gap-2 text-slate-600">
            <input type="checkbox" className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
            {t('login.keepSignedIn')}
          </label>
          <Link href="/forgot-password" className="font-medium text-brand-700 hover:underline">
            {t('login.forgot')}
          </Link>
        </div>
        <Button type="submit" className="w-full" loading={busy}>
          {t('login.submit')}
        </Button>
      </form>
      {providers.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 text-center text-xs uppercase tracking-wide text-slate-500">{t('login.orSso')}</p>
          {ssoError && <Alert>{ssoError}</Alert>}
          <div className="mt-2 grid gap-2">
            {providers.map((p) => (
              <a key={p.id} href={`/api/v1/auth/sso/${p.id}/start`} className="inline-flex w-full items-center justify-center rounded-md bg-white px-4 py-2 text-sm font-medium text-slate-800 ring-1 ring-inset ring-slate-300 hover:bg-slate-50">
                {t('login.continueWith', { label: p.label })}
              </a>
            ))}
          </div>
        </div>
      )}
      <p className="mt-6 text-center text-sm text-slate-600">
        {t('login.newHere')}{' '}
        <Link href="/register" className="font-medium text-brand-700 hover:underline">
          {t('login.create')}
        </Link>
      </p>
    </>
  );
}
