'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Alert, Button, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useT } from '@/lib/i18n';

function VerifyEmail() {
  const params = useSearchParams();
  const token = params.get('token');
  const t = useT();
  const [state, setState] = useState<'working' | 'done' | 'failed'>(token ? 'working' : 'failed');
  const [error, setError] = useState<string | null>(null);
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

  if (state === 'working') return <p className="text-sm text-slate-500">{t('verify.working')}</p>;
  if (state === 'done') {
    return (
      <>
        <h1 className="text-xl font-semibold">{t('verify.doneTitle')}</h1>
        <p className="mt-2 text-sm text-slate-600">{t('verify.doneBody')}</p>
        <Link href="/login" className="mt-6 block">
          <Button className="w-full">{t('verify.signIn')}</Button>
        </Link>
      </>
    );
  }
  const shown = error ?? (token ? null : t('verify.missing'));
  return (
    <>
      <h1 className="text-xl font-semibold">{t('verify.failedTitle')}</h1>
      <div className="mt-4 space-y-4">
        {shown && <Alert>{shown}</Alert>}
        {resent ? (
          <Alert kind="success">
            {resent.message}
            {resent.devToken && (
              <>
                {' '}
                <Link href={`/verify-email?token=${encodeURIComponent(resent.devToken)}`} className="font-medium underline">
                  {t('verify.devLink')}
                </Link>
              </>
            )}
          </Alert>
        ) : (
          <>
            <Input label={t('verify.email')} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <Button className="w-full" variant="secondary" disabled={!email} onClick={() => void resend()}>
              {t('verify.resend')}
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
