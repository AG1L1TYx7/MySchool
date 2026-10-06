'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Input, Select } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth, type RegisterResponse } from '@/lib/auth';
import { useT } from '@/lib/i18n';

export default function RegisterPage() {
  const { register } = useAuth();
  const t = useT();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', role: 'student', joinCode: '' });
  const [done, setDone] = useState<RegisterResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setDone(await register({ ...form, joinCode: form.joinCode.trim() || undefined }));
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <h1 className="text-xl font-semibold">{t('register.checkEmail')}</h1>
        <p className="mt-2 text-sm text-slate-600">{done.message}</p>
        {done.devToken && (
          <div className="mt-4">
            <Alert kind="info">
              {t('register.devMode')}{' '}
              <Link href={`/verify-email?token=${encodeURIComponent(done.devToken)}`} className="font-medium underline">
                {t('register.verifyNow')}
              </Link>
            </Alert>
          </div>
        )}
        <p className="mt-6 text-center text-sm text-slate-600">
          <Link href="/login" className="font-medium text-brand-700 hover:underline">
            {t('register.goToSignIn')}
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold">{t('register.title')}</h1>
      <p className="mt-1 text-sm text-slate-500">{t('register.subtitle')}</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-2 gap-4">
          <Input label={t('register.firstName')} name="firstName" autoComplete="given-name" required value={form.firstName} onChange={update('firstName')} />
          <Input label={t('register.lastName')} name="lastName" autoComplete="family-name" required value={form.lastName} onChange={update('lastName')} />
        </div>
        <Input label={t('register.email')} name="email" type="email" autoComplete="email" required value={form.email} onChange={update('email')} />
        <Input label={t('register.password')} name="password" type="password" autoComplete="new-password" required hint={t('register.passwordHint')} value={form.password} onChange={update('password')} />
        <Select label={t('register.iAm')} name="role" value={form.role} onChange={update('role')}>
          <option value="student">{t('register.student')}</option>
          <option value="parent">{t('register.parent')}</option>
        </Select>
        <Input label={t('register.joinCode')} name="joinCode" placeholder={t('register.joinCodePlaceholder')} hint={t('register.joinCodeHint')} value={form.joinCode} onChange={update('joinCode')} />
        <Button type="submit" className="w-full" loading={busy}>
          {t('register.submit')}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        {t('register.haveAccount')}{' '}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          {t('register.signIn')}
        </Link>
      </p>
    </>
  );
}
