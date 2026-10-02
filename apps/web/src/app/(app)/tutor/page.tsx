'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { MotionItem, MotionList, PillGroup, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import type { Course, CourseDetail } from '@/lib/curriculum';
import type { Paged } from '@/lib/students';
import { MODE_HINTS, MODE_LABELS, TUTOR_MODES, type Conversation, type TutorMode, type TutorStatus } from '@/lib/tutor';

export default function TutorPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={3} />}>
      <TutorHome />
    </Suspense>
  );
}

/**
 * Tutor home: availability, start a conversation (mode + optional lesson), and recent chats.
 * Opening /tutor?lessonId=…&mode=… starts a conversation on that lesson straight away.
 */
function TutorHome() {
  const router = useRouter();
  const params = useSearchParams();
  const [status, setStatus] = useState<TutorStatus | null>(null);
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);
  const [lessons, setLessons] = useState<Array<{ id: string; title: string }>>([]);
  const [mode, setMode] = useState<TutorMode>((params.get('mode') as TutorMode | null) ?? 'explain');
  const [courseId, setCourseId] = useState('');
  const [lessonId, setLessonId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<TutorStatus>('/ai/tutor/status').then(setStatus).catch(() => setStatus({ available: false, status: 'unreachable', models: {}, promptVersions: [] }));
    api<{ data: Conversation[] }>('/ai/tutor/conversations').then((r) => setConversations(r.data)).catch((err) => setError(errorMessage(err)));
    api<Paged<Course>>('/courses?pageSize=100').then((r) => setCourses(r.data)).catch(() => setCourses([]));
  }, []);

  useEffect(() => {
    if (!courseId) {
      setLessons([]);
      return;
    }
    api<CourseDetail>(`/courses/${courseId}`)
      .then((c) => setLessons(c.modules.flatMap((m) => m.lessons.map((l) => ({ id: l.id, title: `${m.title} · ${l.title}` })))))
      .catch(() => setLessons([]));
  }, [courseId]);

  // Deep link from a lesson: create and open immediately.
  const linkedLesson = params.get('lessonId');
  useEffect(() => {
    if (!linkedLesson) return;
    const linkedMode = (params.get('mode') as TutorMode | null) ?? 'explain';
    api<Conversation>('/ai/tutor/conversations', { method: 'POST', body: { mode: linkedMode, lessonId: linkedLesson } })
      .then((c) => router.replace(`/tutor/${c.id}`))
      .catch((err) => setError(errorMessage(err)));
  }, [linkedLesson, params, router]);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const body: Record<string, string> = { mode };
      if (courseId) body.courseId = courseId;
      if (lessonId) body.lessonId = lessonId;
      const c = await api<Conversation>('/ai/tutor/conversations', { method: 'POST', body });
      router.push(`/tutor/${c.id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">AI tutor</h1>
          <p className="mt-1 text-sm text-slate-500">A patient tutor that explains, asks and hints. It never does your work for you, and it tells you when it is unsure.</p>
        </div>
        <Availability status={status} />
      </div>
      {error && <Alert>{error}</Alert>}

      <Card title="Start a conversation" description="Pick how you want help. Choosing a lesson lets the tutor cite it.">
        <div className="space-y-4">
          <div>
            <PillGroup name="Tutor mode" options={TUTOR_MODES} value={mode} onChange={setMode} labels={(m) => MODE_LABELS[m]} />
            <p className="mt-2 text-xs text-slate-500">{MODE_HINTS[mode]}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Select label="Course (optional)" id="course" value={courseId} onChange={(e) => (setCourseId(e.target.value), setLessonId(''))}>
              <option value="">Any topic</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </Select>
            <Select label="Lesson (optional)" id="lesson" value={lessonId} onChange={(e) => setLessonId(e.target.value)} disabled={!courseId}>
              <option value="">Whole course</option>
              {lessons.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.title}
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={() => void start()} loading={busy} disabled={status?.available === false}>
            Start chatting
          </Button>
        </div>
      </Card>

      <Card title="Recent conversations">
        {conversations === null ? (
          <SkeletonRows rows={3} />
        ) : conversations.length === 0 ? (
          <p className="text-sm text-slate-500">No conversations yet. Your first question starts one.</p>
        ) : (
          <MotionList className="divide-y divide-slate-100">
            {conversations.map((c) => (
              <MotionItem key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <Link href={`/tutor/${c.id}`} className="font-medium text-slate-800 hover:underline">
                  {c.title}
                </Link>
                <span className="text-xs text-slate-500">
                  {MODE_LABELS[c.mode]} · {c.messageCount} message{c.messageCount === 1 ? '' : 's'}
                  {c.lastMessageAt ? ` · ${new Date(c.lastMessageAt).toLocaleDateString()}` : ''}
                </span>
              </MotionItem>
            ))}
          </MotionList>
        )}
      </Card>
    </div>
  );
}

function Availability({ status }: { status: TutorStatus | null }) {
  if (!status) return <span className="text-xs text-slate-600">Checking tutor…</span>;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${status.available ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status.available ? 'bg-green-600' : 'bg-amber-500'}`} aria-hidden />
      {status.available ? 'Tutor online' : 'Tutor offline right now'}
    </span>
  );
}
