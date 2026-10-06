'use client';

import { useCallback, useEffect, useState } from 'react';
import { Celebration, ProgressRing } from '@/components/motion';
import { notifyMotivation } from '@/components/motivation-cards';
import { Alert, Button, Card } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { CourseProgress, RewardOutcome } from '@/lib/motivation';
import type { Student } from '@/lib/students';

export const PROGRESS_EVENT = 'ss:progress';

/**
 * Progress map (docs/12): modules as a path whose nodes light up as lessons are finished; the next step
 * is always highlighted. Students see their own; parents see their child's.
 */
export function ProgressMap({ courseId }: { courseId: string }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [progress, setProgress] = useState<CourseProgress | null | undefined>(undefined);
  const learner = user?.role === 'student' || user?.role === 'parent';
  const load = useCallback(async () => {
    if (!learner) return;
    try {
      let query = '';
      if (user?.role === 'parent') {
        const mine = await api<{ data: Student[] }>('/students/mine');
        if (!mine.data[0]) {
          setProgress(null);
          return;
        }
        query = `?studentId=${mine.data[0].id}`;
      }
      setProgress(await api<CourseProgress>(`/courses/${courseId}/progress${query}`));
    } catch {
      setProgress(null);
    }
  }, [courseId, learner, user?.role]);
  useEffect(() => {
    void load();
    const onChange = () => void load();
    window.addEventListener(PROGRESS_EVENT, onChange);
    return () => window.removeEventListener(PROGRESS_EVENT, onChange);
  }, [load]);
  if (!learner || progress === undefined || progress === null || progress.totalLessons === 0) return null;

  return (
    <Card title={t('map.title')} description={user?.role === 'student' ? t('map.desc', { done: progress.completedLessons, total: progress.totalLessons }) : t('map.descFamily', { done: progress.completedLessons, total: progress.totalLessons })}>
      <div className="flex flex-wrap items-start gap-6">
        <ProgressRing value={progress.completedLessons} max={progress.totalLessons} size={88} stroke={9} suffix="" label={`${progress.percent}%`} tone={progress.percent === 100 ? 'green' : 'brand'} />
        <ol className="min-w-0 flex-1 space-y-3">
          {progress.modules.map((m) => (
            <li key={m.id}>
              <p className="text-sm font-medium text-slate-800">
                {m.title} <span className="text-xs font-normal text-slate-500">{m.completed}/{m.total}</span>
              </p>
              <ol className="mt-1 flex flex-wrap items-center gap-1" aria-label={m.title}>
                {m.lessons.map((l, i) => {
                  const next = l.id === progress.nextLessonId;
                  return (
                    <li key={l.id} className="flex items-center">
                      <span className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold transition-colors ${l.completed ? 'bg-green-500 text-white' : next ? 'bg-white text-brand-800 ring-2 ring-brand-500' : 'bg-slate-100 text-slate-500'}`} title={l.title} aria-label={`${l.title}: ${l.completed ? t('map.done') : next ? t('map.next') : ''}`}>
                        {l.completed ? '✓' : i + 1}
                      </span>
                      {i < m.lessons.length - 1 && <span className={`h-0.5 w-4 ${l.completed ? 'bg-green-400' : 'bg-slate-200'}`} aria-hidden />}
                    </li>
                  );
                })}
              </ol>
            </li>
          ))}
        </ol>
      </div>
    </Card>
  );
}

/** The "finished" button a student presses at the end of a lesson; XP once per lesson, with a celebration. */
export function MarkLessonDone({ lessonId }: { lessonId: string }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const [state, setState] = useState<{ busy?: boolean; done?: boolean; error?: string; celebrate?: { title: string; message?: string } }>({});
  if (user?.role !== 'student') return null;
  async function mark() {
    setState({ busy: true });
    try {
      const r = await api<{ completed: boolean; alreadyCompleted: boolean; reward: RewardOutcome | null }>(`/lessons/${lessonId}/complete`, { method: 'POST' });
      if (r.alreadyCompleted) setState({ done: true, celebrate: { title: t('map.alreadyDone') } });
      else {
        const reward = r.reward;
        const title = reward?.leveledUp ? t('map.levelUp', { level: reward.level }) : reward?.badges.length ? t('map.newBadge') : t('map.marked');
        setState({ done: true, celebrate: { title, message: reward && reward.granted > 0 ? t('map.rewardXp', { n: reward.granted }) : undefined } });
      }
      notifyMotivation();
      window.dispatchEvent(new Event(PROGRESS_EVENT));
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  return (
    <div className="mt-3">
      {state.error && <Alert>{state.error}</Alert>}
      <Celebration show={!!state.celebrate} title={state.celebrate?.title ?? ''} message={state.celebrate?.message} onDone={() => setState((s) => ({ ...s, celebrate: undefined }))} />
      <Button variant={state.done ? 'secondary' : 'primary'} loading={state.busy} disabled={state.done} onClick={() => void mark()}>
        {state.done ? `✓ ${t('map.done')}` : t('map.markDone')}
      </Button>
    </div>
  );
}
