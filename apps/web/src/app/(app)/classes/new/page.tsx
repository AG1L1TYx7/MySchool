'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { ClassItem, Course } from '@/lib/curriculum';
import { useAuth } from '@/lib/auth';
import { gradeLabel, periodLabel, type SchoolStructure } from '@/lib/school';
import type { Paged } from '@/lib/students';

interface Teacher {
  id: string;
  firstName: string;
  lastName: string;
}

export default function NewClassPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [structure, setStructure] = useState<SchoolStructure | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [form, setForm] = useState({ courseId: '', name: '', section: 'A', term: '', termId: '', periodId: '', gradeLevel: '', startDate: '', endDate: '', room: '', meetingSchedule: '', maxStudents: '25', teacherId: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    void (async () => {
      try {
        const [c, t] = await Promise.all([api<Paged<Course>>('/courses?pageSize=200'), api<Paged<Teacher>>('/users?role=teacher&pageSize=200').catch(() => ({ data: [] as Teacher[] }))]);
        setCourses(c.data);
        setTeachers(t.data);
        if (user?.organizationId) {
          const st = await api<SchoolStructure>(`/organizations/${user.organizationId}/structure`).catch(() => null);
          setStructure(st);
          const current = st?.years.find((y) => y.isCurrent) ?? st?.years[0];
          const term = current?.terms[0];
          if (term) setForm((f) => ({ ...f, termId: f.termId || term.id, startDate: f.startDate || term.startDate, endDate: f.endDate || term.endDate }));
        }
      } catch (err) {
        setError(errorMessage(err));
      }
    })();
  }, [user?.organizationId]);

  useEffect(() => {
    const course = courses.find((c) => c.id === form.courseId);
    if (course && !form.name) setForm((f) => ({ ...f, name: `${course.title} - Section ${f.section || 'A'}` }));
  }, [form.courseId, form.name, courses]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, unknown> = { courseId: form.courseId, name: form.name };
      for (const k of ['section', 'term', 'termId', 'periodId', 'gradeLevel', 'startDate', 'endDate', 'room', 'meetingSchedule', 'teacherId'] as const) if (form[k]) body[k] = form[k];
      if (form.maxStudents) body.maxStudents = Number(form.maxStudents);
      const created = await api<ClassItem>('/classes', { method: 'POST', body });
      router.replace(`/classes/${created.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <h1 className="text-2xl font-semibold">New class</h1>
      <Card>
        <form onSubmit={submit} className="space-y-4" noValidate>
          {error && <Alert>{error}</Alert>}
          <Select label="Course" required value={form.courseId} onChange={set('courseId')}>
            <option value="">Choose a course</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.courseCode} · {c.title}
              </option>
            ))}
          </Select>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="md:col-span-2">
              <Input label="Class name" required value={form.name} onChange={set('name')} />
            </div>
            <Input label="Section" value={form.section} onChange={set('section')} />
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            {structure && structure.years.length > 0 ? (
              <Select label="Term" required value={form.termId} onChange={set('termId')}>
                <option value="">Choose a term</option>
                {structure.years.map((y) => (
                  <optgroup key={y.id} label={y.name}>
                    {y.terms.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </Select>
            ) : (
              <Input label="Term" required value={form.term} onChange={set('term')} />
            )}
            <Input label="Start date" type="date" value={form.startDate} onChange={set('startDate')} />
            <Input label="End date" type="date" value={form.endDate} onChange={set('endDate')} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Select label="Period" value={form.periodId} onChange={set('periodId')}>
              <option value="">No period</option>
              {(structure?.bellSchedules ?? []).map((b) => (
                <optgroup key={b.id} label={b.name}>
                  {b.periods.map((p) => (
                    <option key={p.id} value={p.id}>
                      {periodLabel(p)}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
            <Select label="Grade level" value={form.gradeLevel} onChange={set('gradeLevel')}>
              <option value="">Mixed or not set</option>
              {(structure?.gradeLevels ?? []).map((g) => (
                <option key={g} value={g}>
                  {gradeLabel(g)}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid gap-4 md:grid-cols-3">
            <Input label="Room" value={form.room} onChange={set('room')} />
            <Input label="Meeting schedule" placeholder="Mon/Wed/Fri 09:00" value={form.meetingSchedule} onChange={set('meetingSchedule')} />
            <Input label="Capacity" type="number" min="1" value={form.maxStudents} onChange={set('maxStudents')} />
          </div>
          <Select label="Primary teacher" value={form.teacherId} onChange={set('teacherId')}>
            <option value="">Assign later</option>
            {teachers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.lastName}, {t.firstName}
              </option>
            ))}
          </Select>
          <Button type="submit" loading={busy} disabled={!form.courseId || !form.name || !(form.term || form.termId)}>
            Create class
          </Button>
        </form>
      </Card>
    </div>
  );
}
