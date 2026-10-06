'use client';

import { ReadAloud } from '@/components/accommodations';
import { LessonSummaries } from '@/components/lesson-summaries';
import { MarkLessonDone, ProgressMap } from '@/components/progress-map';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { LESSON_TYPES, type CourseDetail, type CourseModule, type Lesson } from '@/lib/curriculum';
import { useAuth } from '@/lib/auth';
import { label } from '@/lib/students';

export default function CoursePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [course, setCourse] = useState<CourseDetail | null>(null);
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});

  const load = useCallback(async () => {
    try {
      setCourse(await api<CourseDetail>(`/courses/${id}`));
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(label: string, fn: () => Promise<unknown>) {
    setState({ busy: true });
    try {
      await fn();
      setState({ ok: label });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }

  if (!course) return state.error ? <Alert>{state.error}</Alert> : <p className="text-sm text-slate-500">Loading…</p>;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-slate-500">{course.courseCode}</p>
          <h1 className="text-2xl font-semibold">{course.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {[course.subject, course.gradeLevel ? `Grade ${course.gradeLevel}` : null, course.instructor ? `${course.instructor.firstName} ${course.instructor.lastName}` : null].filter(Boolean).join(' · ')}
            {' · '}
            <span className={course.isPublished ? 'text-green-700' : 'text-slate-600'}>{course.isPublished ? 'Published' : label(course.status)}</span>
          </p>
        </div>
        {course.canEdit && (
          <div className="flex flex-wrap gap-2">
            {course.isPublished ? (
              <Button variant="secondary" loading={state.busy} onClick={() => void run('Course hidden from students.', () => api(`/courses/${id}/unpublish`, { method: 'POST' }))}>
                Unpublish
              </Button>
            ) : (
              <Button loading={state.busy} onClick={() => void run('Course published.', () => api(`/courses/${id}/publish`, { method: 'POST' }))}>
                Publish
              </Button>
            )}
            <Button
              variant="secondary"
              loading={state.busy}
              onClick={() =>
                void (async () => {
                  const copy = await api<{ id: string }>(`/courses/${id}/clone`, { method: 'POST' });
                  router.push(`/courses/${copy.id}`);
                })().catch((err) => setState({ error: errorMessage(err) }))
              }
            >
              Clone
            </Button>
          </div>
        )}
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      {course.description && <p className="text-sm text-slate-700">{course.description}</p>}

      {course.canEdit && <DetailsForm course={course} onSaved={load} />}
      {!course.canEdit && <ProgressMap courseId={id} />}

      <Card title="Outline" description={course.canEdit ? 'Modules group lessons. Students see published modules and lessons once the course is published.' : undefined}>
        {course.modules.length === 0 && <p className="text-sm text-slate-500">No modules yet.</p>}
        <div className="space-y-4">
          {course.modules.map((m, index) => (
            <ModuleBlock key={m.id} module={m} index={index} total={course.modules.length} courseId={id} canEdit={course.canEdit} allModuleIds={course.modules.map((x) => x.id)} onChange={load} />
          ))}
        </div>
        {course.canEdit && <AddModule courseId={id} onAdded={load} />}
      </Card>

      {course.prerequisites.length > 0 && (
        <Card title="Prerequisites">
          <ul className="text-sm text-slate-700">
            {course.prerequisites.map((p) => (
              <li key={p.id}>
                {p.courseCode} · {p.title}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function DetailsForm({ course, onSaved }: { course: CourseDetail; onSaved: () => Promise<void> }) {
  const [form, setForm] = useState({ title: course.title, courseCode: course.courseCode, subject: course.subject ?? '', gradeLevel: course.gradeLevel ?? '', description: course.description ?? '' });
  const [state, setState] = useState<{ error?: string; busy?: boolean; ok?: boolean }>({});
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function save(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api(`/courses/${course.id}`, { method: 'PATCH', body: { title: form.title, courseCode: form.courseCode, subject: form.subject || undefined, gradeLevel: form.gradeLevel || undefined, description: form.description || undefined } });
      setState({ ok: true });
      await onSaved();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  return (
    <Card title="Details">
      <form onSubmit={save} className="grid gap-3 md:grid-cols-4" noValidate>
        {state.error && (
          <div className="md:col-span-4">
            <Alert>{state.error}</Alert>
          </div>
        )}
        {state.ok && (
          <div className="md:col-span-4">
            <Alert kind="success">Saved.</Alert>
          </div>
        )}
        <Input label="Title" value={form.title} onChange={set('title')} />
        <Input label="Code" value={form.courseCode} onChange={set('courseCode')} />
        <Input label="Subject" value={form.subject} onChange={set('subject')} />
        <Input label="Grade" value={form.gradeLevel} onChange={set('gradeLevel')} />
        <div className="md:col-span-4">
          <Input label="Description" value={form.description} onChange={set('description')} />
        </div>
        <div className="md:col-span-4">
          <Button type="submit" loading={state.busy}>
            Save details
          </Button>
        </div>
      </form>
    </Card>
  );
}

function ModuleBlock({ module, index, total, courseId, canEdit, allModuleIds, onChange }: { module: CourseModule; index: number; total: number; courseId: string; canEdit: boolean; allModuleIds: string[]; onChange: () => Promise<void> }) {
  const { can } = useAuth();
  const canTutor = can('ai.tutor.chat');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  async function move(dir: -1 | 1) {
    const ids = [...allModuleIds];
    const [item] = ids.splice(index, 1);
    ids.splice(index + dir, 0, item);
    await api(`/courses/${courseId}/modules/order`, { method: 'PUT', body: { ids } });
    await onChange();
  }
  async function remove() {
    if (!confirm(`Delete module "${module.title}" and its ${module.lessons.length} lesson(s)?`)) return;
    await api(`/modules/${module.id}`, { method: 'DELETE' });
    await onChange();
  }
  async function moveLesson(lessonIndex: number, dir: -1 | 1) {
    const ids = module.lessons.map((l) => l.id);
    const [item] = ids.splice(lessonIndex, 1);
    ids.splice(lessonIndex + dir, 0, item);
    await api(`/modules/${module.id}/lessons/order`, { method: 'PUT', body: { ids } });
    await onChange();
  }
  async function removeLesson(l: Lesson) {
    if (!confirm(`Delete lesson "${l.title}"?`)) return;
    await api(`/lessons/${l.id}`, { method: 'DELETE' });
    await onChange();
  }

  return (
    <section className="rounded-lg border border-slate-200">
      <header className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-2">
        <div>
          <p className="font-medium text-slate-900">
            {index + 1}. {module.title}
            {!module.isPublished && <span className="ml-2 rounded-full bg-slate-200 px-2 py-0.5 text-xs text-slate-600">hidden</span>}
          </p>
          {module.description && <p className="text-xs text-slate-500">{module.description}</p>}
        </div>
        {canEdit && (
          <span className="flex gap-1 text-xs">
            <button className="rounded px-2 py-1 hover:bg-slate-200 disabled:opacity-30" disabled={index === 0} onClick={() => void move(-1)} aria-label="Move module up">
              ↑
            </button>
            <button className="rounded px-2 py-1 hover:bg-slate-200 disabled:opacity-30" disabled={index === total - 1} onClick={() => void move(1)} aria-label="Move module down">
              ↓
            </button>
            <button className="rounded px-2 py-1 text-red-700 hover:bg-red-50" onClick={() => void remove()}>
              Delete
            </button>
          </span>
        )}
      </header>
      <ul className="divide-y divide-slate-100">
        {module.lessons.map((l, li) => (
          <li key={l.id} className="px-4 py-2 text-sm">
            <div className="flex items-center justify-between gap-3">
              <button className="text-left font-medium text-slate-800 hover:underline" onClick={() => setOpen(open === l.id ? null : l.id)}>
                {index + 1}.{li + 1} {l.title}
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {label(l.lessonType)}
                  {l.durationMinutes ? ` · ${l.durationMinutes} min` : ''}
                  {!l.isPublished ? ' · hidden' : ''}
                </span>
              </button>
              {!canEdit && canTutor && l.isPublished && (
                <Link href={`/tutor?lessonId=${l.id}`} className="shrink-0 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-100">
                  Ask the tutor
                </Link>
              )}
              {canEdit && (
                <span className="flex gap-1 text-xs">
                  <button className="rounded px-2 py-1 hover:bg-slate-100 disabled:opacity-30" disabled={li === 0} onClick={() => void moveLesson(li, -1)} aria-label="Move lesson up">
                    ↑
                  </button>
                  <button className="rounded px-2 py-1 hover:bg-slate-100 disabled:opacity-30" disabled={li === module.lessons.length - 1} onClick={() => void moveLesson(li, 1)} aria-label="Move lesson down">
                    ↓
                  </button>
                  <button className="rounded px-2 py-1 text-red-700 hover:bg-red-50" onClick={() => void removeLesson(l)}>
                    Delete
                  </button>
                </span>
              )}
            </div>
            {open === l.id && (
              <div className="mt-2 rounded-md bg-slate-50 p-3 text-slate-700">
                {l.description && <p className="mb-2 text-slate-600">{l.description}</p>}
                {l.contentUrl && (
                  <a href={l.contentUrl} target="_blank" rel="noreferrer" className="break-all text-brand-700 underline">
                    {l.contentUrl}
                  </a>
                )}
                {l.content && (
                  <div className="mt-2">
                    <ReadAloud text={`${l.title}. ${l.content}`} />
                    <pre className="whitespace-pre-wrap font-sans text-sm">{l.content}</pre>
                  </div>
                )}
                {!l.content && !l.contentUrl && <p className="text-slate-500">No content yet.</p>}
                {(l.isPublished || canEdit) && <LessonSummaries lessonId={l.id} />}
                {!canEdit && l.isPublished && <MarkLessonDone lessonId={l.id} />}
              </div>
            )}
          </li>
        ))}
        {module.lessons.length === 0 && <li className="px-4 py-2 text-sm text-slate-500">No lessons yet.</li>}
      </ul>
      {canEdit && (
        <div className="border-t border-slate-100 px-4 py-2">
          {adding ? <AddLesson moduleId={module.id} onDone={async () => (setAdding(false), onChange())} /> : <button className="text-sm font-medium text-brand-700 hover:underline" onClick={() => setAdding(true)}>+ Add lesson</button>}
        </div>
      )}
    </section>
  );
}

function AddModule({ courseId, onAdded }: { courseId: string; onAdded: () => Promise<void> }) {
  const [title, setTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/courses/${courseId}/modules`, { method: 'POST', body: { title } });
      setTitle('');
      setError(null);
      await onAdded();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <form onSubmit={submit} className="mt-4 flex items-end gap-2" noValidate>
      <div className="flex-1">
        <Input label="New module" placeholder="Module title" value={title} onChange={(e) => setTitle(e.target.value)} error={error ?? undefined} />
      </div>
      <Button type="submit" disabled={!title.trim()}>
        Add module
      </Button>
    </form>
  );
}

function AddLesson({ moduleId, onDone }: { moduleId: string; onDone: () => Promise<void> }) {
  const [form, setForm] = useState({ title: '', lessonType: 'text', content: '', contentUrl: '', durationMinutes: '' });
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api(`/modules/${moduleId}/lessons`, {
        method: 'POST',
        body: { title: form.title, lessonType: form.lessonType, content: form.content || undefined, contentUrl: form.contentUrl || undefined, durationMinutes: form.durationMinutes ? Number(form.durationMinutes) : undefined },
      });
      await onDone();
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      {error && <Alert>{error}</Alert>}
      <div className="grid gap-3 md:grid-cols-3">
        <Input label="Lesson title" value={form.title} onChange={set('title')} />
        <Select label="Type" value={form.lessonType} onChange={set('lessonType')}>
          {LESSON_TYPES.map((t) => (
            <option key={t} value={t}>
              {label(t)}
            </option>
          ))}
        </Select>
        <Input label="Duration (minutes)" type="number" min="0" value={form.durationMinutes} onChange={set('durationMinutes')} />
      </div>
      {form.lessonType === 'text' ? (
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-slate-700">Content (Markdown)</span>
          <textarea className="block w-full rounded-md border-0 px-3 py-2 font-mono text-xs shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500" rows={6} value={form.content} onChange={set('content')} />
        </label>
      ) : (
        <Input label="URL" placeholder="https://" value={form.contentUrl} onChange={set('contentUrl')} />
      )}
      <div className="flex gap-2">
        <Button type="submit" disabled={!form.title.trim()}>
          Add lesson
        </Button>
        <Button type="button" variant="ghost" onClick={() => void onDone()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
