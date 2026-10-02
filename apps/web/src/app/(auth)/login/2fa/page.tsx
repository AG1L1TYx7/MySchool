'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Input } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function TwoFactorChallengePage() {
  const { completeMfa } = useAuth();
  const router = useRouter();
  const [pending, setPending] = useState<{ mfaToken: string; rememberMe: boolean } | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (hash.get('sso') === '1' && hash.get('mfaToken')) {
      // Arrived from a provider sign-in; the second factor still applies.
      history.replaceState(null, '', window.location.pathname);
      setPending({ mfaToken: hash.get('mfaToken') as string, rememberMe: false });
      return;
    }
    const raw = sessionStorage.getItem('smartschool.mfa');
    if (!raw) {
      router.replace('/login');
      return;
    }
    setPending(JSON.parse(raw) as { mfaToken: string; rememberMe: boolean });
  }, [router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      await completeMfa({ mfaToken: pending.mfaToken, code, rememberMe: pending.rememberMe });
      sessionStorage.removeItem('smartschool.mfa');
      router.replace('/dashboard');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Two-factor verification</h1>
      <p className="mt-1 text-sm text-slate-500">Enter the six-digit code from your authenticator app, or one of your backup codes.</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <Input label="Code" name="code" inputMode="numeric" autoComplete="one-time-code" autoFocus required value={code} onChange={(e) => setCode(e.target.value)} />
        <Button type="submit" className="w-full" loading={busy}>
          Verify
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
