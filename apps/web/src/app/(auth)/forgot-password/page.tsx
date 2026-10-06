'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useT } from '@/lib/i18n';

export default function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<{ message: string; devToken?: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDone(await api<{ message: string; devToken?: string }>('/auth/forgot-password', { method: 'POST', body: { email }, auth: false }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">{t('forgot.title')}</h1>
      <p className="mt-1 text-sm text-slate-500">{t('forgot.subtitle')}</p>
      {done ? (
        <div className="mt-6 space-y-4">
          <Alert kind="success">{done.message}</Alert>
          {done.devToken && (
            <Alert kind="info">
              {t('forgot.devMode')} <code className="break-all font-mono text-xs">{done.devToken}</code>
            </Alert>
          )}
          <Link href={done.devToken ? `/reset-password?token=${encodeURIComponent(done.devToken)}` : '/reset-password'} className="block">
            <Button className="w-full">{t('forgot.haveCode')}</Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Input label={t('forgot.email')} name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" className="w-full" loading={busy}>
            {t('forgot.send')}
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-slate-600">
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          {t('forgot.back')}
        </Link>
      </p>
    </>
  );
}
