'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CountUp, MotionItem, MotionList, ProgressRing, SkeletonRows } from '@/components/motion';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n, type Translate } from '@/lib/i18n';
import { bandClass, bandTone, percent, type CourseMastery, type LearningCurve, type MasteryBand, type MasteryStandard, type MasterySummary, type PracticeStats, type Trend } from '@/lib/learning';

export const bandName = (band: MasteryBand | null, t: Translate) => (band ? t(`learn.band.${band}`) : t('learn.course.unmeasured'));
export const trendName = (trend: Trend, t: Translate) => t(`learn.trend.${trend}`);
const trendMark = (trend: Trend) => (trend === 'up' ? '↗' : trend === 'down' ? '↘' : '→');

function useLoad<T>(path: string | null) {
  const [data, setData] = useState<T | null | undefined>(undefined);
  const load = useCallback(() => {
    if (!path) {
      setData(null);
      return;
    }
    api<T>(path)
      .then(setData)
      .catch(() => setData(null));
  }, [path]);
  useEffect(() => {
    load();
    window.addEventListener('ss:motivation', load);
    return () => window.removeEventListener('ss:motivation', load);
  }, [load]);
  return { data, reload: load };
}

/** Mastery for the signed-in student, or for a given student (family, teachers). */
export function useMastery(studentId?: string) {
  const { user } = useAuth();
  return useLoad<MasterySummary>(studentId ? `/students/${studentId}/mastery` : user?.role === 'student' ? '/me/mastery' : null);
}
export function useCurve(studentId?: string) {
  const { user } = useAuth();
  return useLoad<LearningCurve>(studentId ? `/students/${studentId}/learning/curve` : user?.role === 'student' ? '/me/learning/curve' : null);
}
export function usePracticeStats(studentId?: string) {
  const { user } = useAuth();
  return useLoad<PracticeStats>(studentId ? `/students/${studentId}/practice` : user?.role === 'student' ? '/me/practice' : null);
}

/** Twelve weeks of scores and recall as one small chart, drawn to scale with the theme's colours. */
export function CurveChart({ curve, height = 120 }: { curve: LearningCurve; height?: number }) {
  const { t, tag } = useI18n();
  const weeks = curve.weeks;
  const width = 360;
  const pad = { left: 30, right: 8, top: 10, bottom: 22 };
  const innerW = width - pad.left - pad.right;
  const innerH = height - pad.top - pad.bottom;
  const x = (i: number) => pad.left + (weeks.length <= 1 ? innerW / 2 : (i / (weeks.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / 100) * innerH;
  const path = (pick: (p: (typeof weeks)[number]) => number | null) => {
    let d = '';
    let open = false;
    weeks.forEach((p, i) => {
      const v = pick(p);
      if (v === null) {
        open = false;
        return;
      }
      d += `${open ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      open = true;
    });
    return d.trim();
  };
  const hasAny = weeks.some((w) => w.averageScaled !== null || w.retention !== null);
  if (!hasAny) return <p className="text-sm text-slate-500">{t('learn.curve.empty')}</p>;
  const label = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(tag, { month: 'short', day: 'numeric' });
  return (
    <figure>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full max-w-xl" role="img" aria-label={t('learn.curve.aria')}>
        {[0, 50, 100].map((v) => (
          <g key={v}>
            <line x1={pad.left} x2={width - pad.right} y1={y(v)} y2={y(v)} stroke="#e2e8f0" strokeWidth="1" />
            <text x={pad.left - 4} y={y(v) + 4} textAnchor="end" fontSize="10" fill="#475569">
              {v}
            </text>
          </g>
        ))}
        <path d={path((p) => (p.averageScaled === null ? null : Math.round(p.averageScaled * 100)))} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" />
        <path d={path((p) => p.retention)} fill="none" stroke="#16a34a" strokeWidth="2" strokeDasharray="4 3" strokeLinejoin="round" />
        {weeks.map((p, i) =>
          p.averageScaled === null ? null : (
            <circle key={p.weekStart} cx={x(i)} cy={y(Math.round(p.averageScaled * 100))} r="3" fill="#2563eb">
              <title>{`${label(p.weekStart)}: ${Math.round(p.averageScaled * 100)}% · ${t('learn.curve.items', { n: p.items })}`}</title>
            </circle>
          ),
        )}
        {weeks.map((p, i) => (i % 3 === 0 || i === weeks.length - 1) && (
          <text key={`l${p.weekStart}`} x={x(i)} y={height - 6} textAnchor="middle" fontSize="10" fill="#475569">
            {label(p.weekStart)}
          </text>
        ))}
      </svg>
      <figcaption className="mt-1 flex flex-wrap gap-4 text-xs text-slate-600">
        <span>
          <span aria-hidden className="mr-1 inline-block h-2 w-4 rounded bg-blue-600 align-middle" />
          {t('learn.curve.score')}
        </span>
        <span>
          <span aria-hidden className="mr-1 inline-block h-2 w-4 rounded border-b-2 border-dashed border-green-600 align-middle" />
          {t('learn.curve.retention')}
        </span>
      </figcaption>
    </figure>
  );
}

export function StandardRow({ s }: { s: MasteryStandard }) {
  const { t, n } = useI18n();
  return (
    <MotionItem className="flex flex-col gap-2 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="w-full min-w-0 sm:flex-1">
        <p className="break-all font-medium text-slate-900">
          {s.code}
          <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${bandClass(s.band)}`}>{bandName(s.band, t)}</span>
        </p>
        <p className="truncate text-xs text-slate-600" title={s.description}>
          {s.description}
        </p>
      </div>
      <div className="w-full min-w-0 text-xs text-slate-600 sm:w-auto sm:text-right [overflow-wrap:anywhere]">
        <p className="text-base font-semibold text-slate-900">{percent(s.level)}%</p>
        <p>
          <span aria-hidden>{trendMark(s.trend)} </span>
          {trendName(s.trend, t)} · {n('learn.evidence', s.evidenceCount)}
        </p>
      </div>
    </MotionItem>
  );
}

/** Student dashboard: practice due today, this term's learning curve and the standards to keep working on. */
export function LearningCard() {
  const { user } = useAuth();
  const { t, n } = useI18n();
  const { data: stats } = usePracticeStats();
  const { data: curve } = useCurve();
  const { data: mastery } = useMastery();
  if (user?.role !== 'student') return null;
  if (stats === undefined || curve === undefined || mastery === undefined)
    return (
      <Card title={t('learn.dash.title')}>
        <SkeletonRows rows={2} />
      </Card>
    );
  if (!stats && !curve && !mastery) return null;
  return (
    <Card title={t('learn.dash.title')} description={t('learn.dash.desc')} actions={<Link href="/practice" className="text-sm text-brand-700 hover:underline">{t('learn.dash.go')}</Link>}>
      <div className="grid gap-6 md:grid-cols-3">
        {stats && (
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">{t('learn.practice.title')}</p>
            <p className="text-2xl font-semibold text-slate-900">
              <CountUp value={stats.dueToday} />
            </p>
            <p className="text-sm text-slate-700">{n('learn.dash.due', stats.dueToday)}</p>
            <p className="text-xs text-slate-500">{t('learn.practice.goal', { n: stats.reviewedToday, goal: stats.sessionGoal })}</p>
          </div>
        )}
        {curve && (
          <div className="md:col-span-2">
            <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">{t('learn.curve.title')}</p>
            <CurveChart curve={curve} height={100} />
          </div>
        )}
      </div>
      {mastery && mastery.weakest.length > 0 && (
        <div className="mt-4">
          <p className="text-xs uppercase tracking-wide text-slate-500">{t('learn.weakest')}</p>
          <MotionList className="divide-y divide-slate-100">
            {mastery.weakest.slice(0, 2).map((s) => (
              <StandardRow key={s.standardId} s={s} />
            ))}
          </MotionList>
        </div>
      )}
    </Card>
  );
}

/** Family view of one child's mastery and learning curve, in plain words. */
export function FamilyLearningCard({ studentId, firstName }: { studentId: string; firstName: string }) {
  const { t } = useI18n();
  const { data: mastery } = useMastery(studentId);
  const { data: curve } = useCurve(studentId);
  if (mastery === undefined || curve === undefined) return null;
  if (!mastery && !curve) return null;
  return (
    <Card title={t('learn.mastery.title')} description={t('learn.mastery.famDesc', { name: firstName })}>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="min-w-0">
          {mastery && mastery.standards.length > 0 ? (
            <>
              <div className="flex flex-wrap gap-2 text-xs">
                {(['advanced', 'proficient', 'developing', 'beginning'] as const).map((b) => (
                  <span key={b} className={`rounded-full px-2 py-0.5 ${bandClass(b)}`}>
                    {bandName(b, t)}: {mastery.counts[b]}
                  </span>
                ))}
              </div>
              <MotionList className="mt-2 divide-y divide-slate-100">
                {[...mastery.weakest].slice(0, 3).map((s) => (
                  <StandardRow key={s.standardId} s={s} />
                ))}
              </MotionList>
            </>
          ) : (
            <p className="text-sm text-slate-500">{t('learn.mastery.empty')}</p>
          )}
        </div>
        <div className="min-w-0">
          <p className="mb-1 text-xs uppercase tracking-wide text-slate-500">{t('learn.curve.title')}</p>
          {curve ? <CurveChart curve={curve} height={110} /> : <p className="text-sm text-slate-500">{t('learn.curve.empty')}</p>}
        </div>
      </div>
    </Card>
  );
}

/** One ring per module on a course page, for a student (their own) or a family member (?studentId). */
export function CourseMasteryRings({ courseId, studentId }: { courseId: string; studentId?: string }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const path = user?.role === 'student' ? `/courses/${courseId}/mastery` : studentId ? `/courses/${courseId}/mastery?studentId=${studentId}` : null;
  const { data } = useLoad<CourseMastery>(path);
  if (!path || data === undefined || data === null) return null;
  const measured = data.modules.filter((m) => m.standards > 0);
  if (measured.length === 0) return null;
  return (
    <Card title={t('learn.course.title')} description={t('learn.course.desc')}>
      <ul className="flex flex-wrap gap-6">
        {measured.map((m) => (
          <li key={m.id} className="w-28 text-center">
            <ProgressRing value={percent(m.level)} max={100} size={80} stroke={8} tone={bandTone(m.band)} label={m.title} suffix={m.level === null ? '' : '%'} />
            <p className="mt-1 text-xs font-medium text-slate-800">{m.title}</p>
            <p className="text-xs text-slate-600">{bandName(m.band, t)}</p>
          </li>
        ))}
      </ul>
      {data.level !== null && <p className="mt-3 text-sm text-slate-700">{t('learn.course.overall', { n: percent(data.level) })}</p>}
    </Card>
  );
}
