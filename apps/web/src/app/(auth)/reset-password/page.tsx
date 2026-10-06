'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Alert, Button, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useT } from '@/lib/i18n';

function ResetPasswordForm() {
  const params = useSearchParams();
  const router = useRouter();
  const t = useT();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) {
      setError(t('reset.mismatch'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/auth/reset-password', { method: 'POST', body: { token: token.trim(), newPassword }, auth: false });
      setDone(true);
      setTimeout(() => router.replace('/login'), 1500);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">{t('reset.title')}</h1>
      <p className="mt-1 text-sm text-slate-500">{t('reset.subtitle')}</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        {done && <Alert kind="success">{t('reset.done')}</Alert>}
        <Input label={t('reset.code')} name="token" required value={token} onChange={(e) => setToken(e.target.value)} />
        <Input label={t('reset.newPassword')} name="newPassword" type="password" autoComplete="new-password" required value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <Input label={t('reset.confirm')} name="confirm" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        <Button type="submit" className="w-full" loading={busy} disabled={done}>
          {t('reset.submit')}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          {t('forgot.back')}
        </Link>
      </p>
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}
