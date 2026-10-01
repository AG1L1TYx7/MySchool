'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Input } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const { login } = useAuth();
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
      <p className="mt-6 text-center text-sm text-slate-600">
        New here?{' '}
        <Link href="/register" className="font-medium text-brand-700 hover:underline">
          Create an account
        </Link>
      </p>
    </>
  );
}
