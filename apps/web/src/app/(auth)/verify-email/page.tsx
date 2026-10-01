'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, Button, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed');
  const [error, setError] = useState<string | null>(token ? null : 'The verification link is missing its code.');
  const [email, setEmail] = useState('');
  const [resent, setResent] = useState<{ message: string; devToken?: string } | null>(null);

  useEffect(() => {
    if (!token) return;
    api('/auth/verify-email', { method: 'POST', body: { token }, auth: false })
      .then(() => setState('done'))
      .catch((err) => {
        setError(errorMessage(err));
        setState('failed');
      });
  }, [token]);

  async function resend() {
    try {
      setResent(await api('/auth/resend-verification', { method: 'POST', body: { email }, auth: false }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  if (state === 'working') return <p className="text-sm text-slate-500">Verifying your email…</p>;
  if (state === 'done') {
    return (
      <>
        <h1 className="text-xl font-semibold">Email verified</h1>
        <p className="mt-2 text-sm text-slate-600">Your address is confirmed. You can sign in now.</p>
        <Link href="/login" className="mt-6 block">
          <Button className="w-full">Sign in</Button>
        </Link>
      </>
    );
  }
  return (
    <>
      <h1 className="text-xl font-semibold">Verification failed</h1>
      <div className="mt-4 space-y-4">
        {error && <Alert>{error}</Alert>}
        {resent ? (
          <Alert kind="success">
            {resent.message}
            {resent.devToken && (
              <>
                {' '}
                <Link href={`/verify-email?token=${encodeURIComponent(resent.devToken)}`} className="font-medium underline">
                  Development link
                </Link>
              </>
            )}
          </Alert>
        ) : (
          <>
            <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button className="w-full" variant="secondary" disabled={!email} onClick={() => void resend()}>
              Send a new verification email
            </Button>
          </>
        )}
      </div>
    </>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmail />
    </Suspense>
  );
}
