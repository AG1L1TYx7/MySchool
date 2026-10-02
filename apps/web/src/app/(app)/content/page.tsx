'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { MotionItem, MotionList, PillGroup, ProgressBar, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { Course, CourseDetail } from '@/lib/curriculum';
import { CONTENT_TYPE_LABELS, type ContentJob, type H5pContentSummary } from '@/lib/h5p';
import type { Paged } from '@/lib/students';

const KINDS = ['quiz', 'flashcards'] as const;
const DIFFICULTY = ['easy', 'medium', 'hard', 'mixed'] as const;
const STEPS = ['Queued', 'Writing the draft', 'Checking the JSON', 'Building the activity'];

/** Teacher home for interactive content: generate with AI, review drafts, publish, attach to assignments. */
export default function ContentPage() {
  const router = useRouter();
  const [rows, setRows] = useState<H5pContentSummary[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [lessons, setLessons] = useState<Array<{ id: string; title: string }>>([]);
  const [kind, setKind] = useState<(typeof KINDS)[number]>('quiz');
  const [form, setForm] = useState({ topic: '', subject: '', gradeLevel: '7', count: '8', difficulty: 'mixed' as (typeof DIFFICULTY)[number], courseId: '', lessonId: '', standard: '' });
  const [job, setJob] = useState<ContentJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'draft' | 'published'>('all');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const load = useCallback(async () => {
    try {
      setRows((await api<{ data: H5pContentSummary[] }>('/h5p/contents')).data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
    api<Paged<Course>>('/courses?pageSize=100').then((r) => setCourses(r.data)).catch(() => setCourses([]));
  }, [load]);

  useEffect(() => {
    if (!form.courseId) {
      setLessons([]);
      return;
    }
    api<CourseDetail>(`/courses/${form.courseId}`)
      .then((c) => setLessons(c.modules.flatMap((m) => m.lessons.map((l) => ({ id: l.id, title: `${m.title} · ${l.title}` })))))
      .catch(() => setLessons([]));
  }, [form.courseId]);

  // Poll the job until it is done or failed; a draft is created server-side at that point.
  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed') return;
    timer.current = setTimeout(async () => {
      try {
        const next = await api<ContentJob>(`/ai/jobs/${job.id}`);
        setJob(next);
        if (next.status === 'done') {
          await load();
          if (next.contentId) router.push(`/content/${next.contentId}`);
        }
      } catch (err) {
        setError(errorMessage(err));
        setJob(null);
      }
    }, 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [job, load, router]);

  async function generate(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body: Record<string, unknown> = { topic: form.topic.trim(), gradeLevel: form.gradeLevel || undefined, subject: form.subject || undefined, count: Number(form.count), difficulty: form.difficulty, standard: form.standard || undefined };
      if (form.lessonId) body.lessonId = form.lessonId;
      if (form.courseId) body.courseId = form.courseId;
      if (kind === 'quiz') body.questionTypes = ['multiple_choice', 'true_false', 'fill_blank'];
      setJob(await api<ContentJob>(`/ai/content/${kind === 'quiz' ? 'quizzes' : 'flashcards'}`, { method: 'POST', body }));
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const busy = !!job && job.status !== 'done' && job.status !== 'failed';
  const step = job ? (job.status === 'queued' ? 0 : job.status === 'running' ? 2 : 4) : 0;
  const visible = (rows ?? []).filter((r) => filter === 'all' || r.status === filter);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Interactive content</h1>
        <p className="mt-1 text-sm text-slate-500">Generate a quiz or flashcards from a topic or a lesson, review every item, then publish and attach to an assignment. Students never see a draft.</p>
      </div>
      {error && <Alert>{error}</Alert>}

      <Card title="Generate with AI" description="A draft for you to review; nothing is published automatically.">
        <form onSubmit={(e) => void generate(e)} className="space-y-4" noValidate>
          <PillGroup name="Content type" options={KINDS} value={kind} onChange={setKind} labels={(k) => CONTENT_TYPE_LABELS[k]} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Topic" value={form.topic} onChange={set('topic')} placeholder="Solving one-step equations" required />
            <Input label="Subject (optional)" value={form.subject} onChange={set('subject')} placeholder="Math" />
            <Input label="Grade level" value={form.gradeLevel} onChange={set('gradeLevel')} />
            <Input label={kind === 'quiz' ? 'Questions' : 'Cards'} type="number" min={3} max={30} value={form.count} onChange={set('count')} />
            <Select label="Difficulty" id="difficulty" value={form.difficulty} onChange={set('difficulty')}>
              {DIFFICULTY.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
            <Input label="Standard or objective (optional)" value={form.standard} onChange={set('standard')} placeholder="CCSS 7.EE.B.4" />
            <Select label="Course (optional)" id="course" value={form.courseId} onChange={(e) => setForm((f) => ({ ...f, courseId: e.target.value, lessonId: '' }))}>
              <option value="">None</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
            <Select label="Lesson as source material (optional)" id="lesson" value={form.lessonId} onChange={set('lessonId')} disabled={!form.courseId}>
              <option value="">None</option>
              {lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </Select>
          </div>
          {job && job.status !== 'done' && (
            <div className="rounded-lg bg-slate-50 p-3">
              {job.status === 'failed' ? (
                <Alert>
                  Generation failed: {job.error?.detail ?? 'unknown error'} {job.error?.code === 'ai.unavailable' ? '(the AI service is offline)' : ''}
                </Alert>
              ) : (
                <ProgressBar value={step + 1} max={STEPS.length + 1} label={`${STEPS[Math.min(step, STEPS.length - 1)]}… ${job.progress && job.progress !== 'Queued' ? `(${job.progress})` : ''}`} />
              )}
            </div>
          )}
          <Button type="submit" loading={busy} disabled={form.topic.trim().length < 2}>
            Generate {CONTENT_TYPE_LABELS[kind].toLowerCase()}
          </Button>
        </form>
      </Card>

      <Card
        title="Your content"
        actions={<PillGroup name="Filter" options={['all', 'draft', 'published'] as const} value={filter} onChange={setFilter} labels={(f) => (f === 'all' ? 'All' : f === 'draft' ? 'Drafts' : 'Published')} />}
      >
        {rows === null ? (
          <SkeletonRows rows={4} />
        ) : visible.length === 0 ? (
          <p className="text-sm text-slate-500">Nothing here yet. Generate something above.</p>
        ) : (
          <MotionList className="divide-y divide-slate-100">
            {visible.map((c) => (
              <MotionItem key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-2 text-sm">
                <div>
                  <Link href={`/content/${c.id}`} className="font-medium text-slate-800 hover:underline">
                    {c.title}
                  </Link>
                  <p className="text-xs text-slate-500">
                    {CONTENT_TYPE_LABELS[c.contentType] ?? c.contentType} · {c.maxScore} item{c.maxScore === 1 ? '' : 's'}
                    {c.gradeLevel ? ` · grade ${c.gradeLevel}` : ''}
                    {c.source === 'ai' ? ' · AI draft' : ''}
                    {c.assignmentCount ? ` · used in ${c.assignmentCount} assignment${c.assignmentCount === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
                <span className={`rounded-full px-2 py-0.5 text-xs ${c.status === 'published' ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>{c.status}</span>
              </MotionItem>
            ))}
          </MotionList>
        )}
      </Card>
    </div>
  );
}
