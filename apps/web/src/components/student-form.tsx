'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Input, Select } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { ENROLLMENT_STATUSES, GRADE_LEVELS, LEARNING_STYLES, label, type Student } from '@/lib/students';

export interface StudentFormValues {
  studentNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  dateOfBirth: string;
  gender: string;
  gradeLevel: string;
  enrollmentStatus: string;
  enrollmentDate: string;
  preferredLearningStyle: string;
  accessibilityNeeds: string;
  goals: string;
  notes: string;
  address: string;
  createAccount: boolean;
}

export function valuesFrom(s?: Student | null): StudentFormValues {
  return {
    studentNumber: s?.studentNumber ?? '',
    firstName: s?.firstName ?? '',
    lastName: s?.lastName ?? '',
    email: s?.email ?? '',
    phone: s?.phone ?? '',
    dateOfBirth: s?.dateOfBirth ?? '',
    gender: s?.gender ?? '',
    gradeLevel: s?.gradeLevel ?? '',
    enrollmentStatus: s?.enrollmentStatus ?? 'active',
    enrollmentDate: s?.enrollmentDate ?? '',
    preferredLearningStyle: s?.preferredLearningStyle ?? '',
    accessibilityNeeds: s?.accessibilityNeeds ?? '',
    goals: s?.goals ?? '',
    notes: s?.notes ?? '',
    address: s?.address ?? '',
    createAccount: false,
  };
}

/** Converts form values into the API payload, omitting blanks so PATCH never clears untouched fields. */
export function payloadFrom(v: StudentFormValues, mode: 'create' | 'edit'): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const keys: Array<keyof StudentFormValues> = ['studentNumber', 'firstName', 'lastName', 'email', 'phone', 'dateOfBirth', 'gender', 'gradeLevel', 'enrollmentStatus', 'enrollmentDate', 'preferredLearningStyle', 'accessibilityNeeds', 'goals', 'notes', 'address'];
  for (const k of keys) {
    const val = v[k];
    if (typeof val === 'string' && val.trim() !== '') out[k] = val.trim();
  }
  if (mode === 'create' && v.createAccount) out.createAccount = true;
  return out;
}

export function StudentForm({ initial, mode, onSubmit, submitLabel }: { initial: StudentFormValues; mode: 'create' | 'edit'; onSubmit: (values: StudentFormValues) => Promise<void>; submitLabel: string }) {
  const [v, setV] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof StudentFormValues) => (e: { target: { value: string } }) => setV((cur) => ({ ...cur, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit(v);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-6" noValidate>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-4 md:grid-cols-3">
        <Input label="Student number" hint={mode === 'create' ? 'Generated when left blank' : undefined} value={v.studentNumber} onChange={set('studentNumber')} />
        <Input label="First name" required value={v.firstName} onChange={set('firstName')} />
        <Input label="Last name" required value={v.lastName} onChange={set('lastName')} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Select label="Grade" value={v.gradeLevel} onChange={set('gradeLevel')}>
          <option value="">Not set</option>
          {GRADE_LEVELS.map((g) => (
            <option key={g} value={g}>
              {g === 'K' ? 'Kindergarten' : `Grade ${g}`}
            </option>
          ))}
        </Select>
        <Select label="Enrolment status" value={v.enrollmentStatus} onChange={set('enrollmentStatus')}>
          {ENROLLMENT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </Select>
        <Input label="Enrolment date" type="date" value={v.enrollmentDate} onChange={set('enrollmentDate')} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Input label="Date of birth" type="date" value={v.dateOfBirth} onChange={set('dateOfBirth')} />
        <Input label="Gender" value={v.gender} onChange={set('gender')} />
        <Select label="Preferred learning style" value={v.preferredLearningStyle} onChange={set('preferredLearningStyle')}>
          <option value="">Not set</option>
          {LEARNING_STYLES.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Input label="Email" type="email" value={v.email} onChange={set('email')} />
        <Input label="Phone" value={v.phone} onChange={set('phone')} />
        <Input label="Address" value={v.address} onChange={set('address')} />
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        <Input label="Accessibility needs" value={v.accessibilityNeeds} onChange={set('accessibilityNeeds')} />
        <Input label="Goals" value={v.goals} onChange={set('goals')} />
        <Input label="Notes" value={v.notes} onChange={set('notes')} />
      </div>
      {mode === 'create' && (
        <label className="inline-flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" className="rounded border-slate-300 text-brand-600 focus:ring-brand-500" checked={v.createAccount} onChange={(e) => setV((cur) => ({ ...cur, createAccount: e.target.checked }))} />
          Create a sign-in account and email an invitation (requires an email)
        </label>
      )}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
