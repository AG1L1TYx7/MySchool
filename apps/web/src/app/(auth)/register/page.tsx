'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Input, Select } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const PASSWORD_HINT = 'At least 12 characters with upper and lower case letters, a digit and a symbol.';

export default function RegisterPage() {
  const { register } = useAuth();
  const router = useRouter();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', password: '', role: 'student' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const update = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(form);
      router.replace('/dashboard');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-slate-500">Students, parents and teachers can register here. School administrators are invited by their district.</p>
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
          <option value="teacher">Teacher</option>
        </Select>
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
