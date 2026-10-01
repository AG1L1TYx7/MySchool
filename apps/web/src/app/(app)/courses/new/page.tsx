'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { Course } from '@/lib/curriculum';
import { GRADE_LEVELS } from '@/lib/students';

export default function NewCoursePage() {
  const router = useRouter();
  const [form, setForm] = useState({ title: '', courseCode: '', subject: '', gradeLevel: '', description: '', creditHours: '', estimatedHours: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { title: form.title };
      if (form.courseCode) body.courseCode = form.courseCode;
      if (form.subject) body.subject = form.subject;
      if (form.gradeLevel) body.gradeLevel = form.gradeLevel;
      if (form.description) body.description = form.description;
      if (form.creditHours) body.creditHours = Number(form.creditHours);
      if (form.estimatedHours) body.estimatedHours = Number(form.estimatedHours);
      const course = await api<Course>('/courses', { method: 'POST', body });
      router.replace(`/courses/${course.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">New course</h1>
      <Card description="The course starts as a draft. Add modules and lessons, then publish it so students can see it.">
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Input label="Title" required value={form.title} onChange={set('title')} />
          <div className="grid gap-4 md:grid-cols-3">
            <Input label="Course code" hint="Generated from the title when blank" value={form.courseCode} onChange={set('courseCode')} />
            <Input label="Subject" placeholder="Mathematics" value={form.subject} onChange={set('subject')} />
            <Select label="Grade" value={form.gradeLevel} onChange={set('gradeLevel')}>
              <option value="">Not set</option>
              {GRADE_LEVELS.map((g) => (
                <option key={g} value={g}>
                  {g === 'K' ? 'Kindergarten' : `Grade ${g}`}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Input label="Credit hours" type="number" step="0.5" min="0" value={form.creditHours} onChange={set('creditHours')} />
            <Input label="Estimated hours" type="number" min="0" value={form.estimatedHours} onChange={set('estimatedHours')} />
          </div>
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">Description</span>
            <textarea className="block w-full rounded-md border-0 px-3 py-2 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500 sm:text-sm" rows={4} value={form.description} onChange={set('description')} />
          </label>
          <Button type="submit" loading={busy}>
            Create course
          </Button>
        </form>
      </Card>
    </div>
  );
}
