'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';

export default function ForgotPasswordPage() {
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
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-sm text-slate-500">We will email you a code that is valid for one hour.</p>
      {done ? (
        <div className="mt-6 space-y-4">
          <Alert kind="success">{done.message}</Alert>
          {done.devToken && (
            <Alert kind="info">
              Development mode (no mail server configured). Your reset code: <code className="break-all font-mono text-xs">{done.devToken}</code>
            </Alert>
          )}
          <Link href={done.devToken ? `/reset-password?token=${encodeURIComponent(done.devToken)}` : '/reset-password'} className="block">
            <Button className="w-full">I have my code</Button>
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Input label="Email" name="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <Button type="submit" className="w-full" loading={busy}>
            Send reset code
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-slate-600">
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Back to sign in
        </Link>
      </p>
    </>
  );
}
