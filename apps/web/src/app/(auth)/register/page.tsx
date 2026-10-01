'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Input, Select } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth, type RegisterResponse } from '@/lib/auth';

const PASSWORD_HINT = 'At least 12 characters with upper and lower case letters, a digit and a symbol. Not a common password, and not your name or email.';

export default function RegisterPage() {
  const { register } = useAuth();
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
        <h1 className="text-xl font-semibold">Check your email</h1>
        <p className="mt-2 text-sm text-slate-600">{done.message}</p>
        {done.devToken && (
          <div className="mt-4">
            <Alert kind="info">
              Development mode (no mail server). Use this link to verify:{' '}
              <Link href={`/verify-email?token=${encodeURIComponent(done.devToken)}`} className="font-medium underline">
                verify now
              </Link>
            </Alert>
          </div>
        )}
        <p className="mt-6 text-center text-sm text-slate-600">
          <Link href="/login" className="font-medium text-brand-700 hover:underline">
            Go to sign in
          </Link>
        </p>
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-slate-500">Students and parents can register here. Teachers and administrators are invited by their school.</p>
      <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
        {error && <Alert>{error}</Alert>}
        <div className="grid grid-cols-2 gap-4">
          <Input label="First name" name="firstName" autoComplete="given-name" required value={form.firstName} onChange={update('firstName')} />
          <Input label="Last name" name="lastName" autoComplete="family-name" required value={form.lastName} onChange={update('lastName')} />
        </div>
        <Input label="Email" name="email" type="email" autoComplete="email" required value={form.email} onChange={update('email')} />
        <Input label="Password" name="password" type="password" autoComplete="new-password" required hint={PASSWORD_HINT} value={form.password} onChange={update('password')} />
        <Select label="I am a" name="role" value={form.role} onChange={update('role')}>
          <option value="student">Student</option>
          <option value="parent">Parent or guardian</option>
        </Select>
        <Input label="School join code" name="joinCode" placeholder="e.g. DEMO-2026" hint="Your school gives you this code. Leave it blank to join a school later." value={form.joinCode} onChange={update('joinCode')} />
        <Button type="submit" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-600">
        Already have an account?{' '}
        <Link href="/login" className="font-medium text-brand-700 hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
