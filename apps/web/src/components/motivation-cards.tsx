'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { CountUp, MotionItem, MotionList, ProgressBar, ProgressRing, SkeletonRows } from '@/components/motion';
import { Card } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n, type Translate } from '@/lib/i18n';
import type { Badge, MotivationSummary, Quest } from '@/lib/motivation';
import { en, type MessageKey } from '@/locales/en';

/** Fired after any action that may have changed XP so the header pill and cards refresh. */
export const MOTIVATION_EVENT = 'ss:motivation';
export const notifyMotivation = () => window.dispatchEvent(new Event(MOTIVATION_EVENT));

const known = (key: string, t: Translate, fallback: string) => (key in en ? t(key as MessageKey) : fallback);
export const badgeName = (b: { code: string; name: string }, t: Translate) => known(`badge.${b.code}.name`, t, b.name);
export const badgeDesc = (b: { code: string; description: string }, t: Translate) => known(`badge.${b.code}.desc`, t, b.description);
export const titleName = (code: string, t: Translate) => known(`title.${code}`, t, code);
export const reasonName = (code: string, t: Translate) => known(`reason.${code}`, t, code);
/** Auto-generated quests are rendered from their metric so families read them in their language. */
export const questTitle = (q: Quest, t: Translate) => (q.auto && `mot.quest.${q.metric}` in en ? t(`mot.quest.${q.metric}` as MessageKey, { n: q.goal }) : q.title);

/** Loads the summary for the signed-in student, or for a given student (family, teachers). */
export function useMotivation(studentId?: string) {
  const { user } = useAuth();
  const [summary, setSummary] = useState<MotivationSummary | null | undefined>(undefined);
  const path = studentId ? `/students/${studentId}/motivation` : user?.role === 'student' ? '/me/motivation' : null;
  const load = useCallback(() => {
    if (!path) {
      setSummary(null);
      return;
    }
    api<MotivationSummary>(path)
      .then(setSummary)
      .catch(() => setSummary(null));
  }, [path]);
  useEffect(() => {
    load();
    window.addEventListener(MOTIVATION_EVENT, load);
    return () => window.removeEventListener(MOTIVATION_EVENT, load);
  }, [load]);
  return { summary, reload: load };
}

/** Header pill for students: level, XP and streak, linking to the progress page. */
export function XpPill() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { summary } = useMotivation();
  if (user?.role !== 'student' || !summary || !summary.enabled) return null;
  return (
    <Link href="/motivation" className="hidden items-center gap-2 rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-800 ring-1 ring-inset ring-brand-200 hover:bg-brand-100 sm:inline-flex" aria-label={`${t('mot.level', { level: summary.level })}, ${t('mot.xp', { xp: summary.xp })}`}>
      <span>{t('mot.levelShort', { level: summary.level })}</span>
      <span className="text-brand-600">·</span>
      <span>{t('mot.xp', { xp: summary.xp })}</span>
      {summary.streak.days > 0 && (
        <span aria-label={t('mot.streak')} className="text-amber-700">
          🔥 {summary.streak.days}
        </span>
      )}
    </Link>
  );
}

export function LevelRing({ summary, size = 96 }: { summary: MotivationSummary; size?: number }) {
  const { t } = useI18n();
  const span = Math.max(1, summary.nextLevelXp - summary.levelStartXp);
  return <ProgressRing value={summary.xp - summary.levelStartXp} max={span} size={size} stroke={10} suffix="" label={t('mot.level', { level: summary.level })} tone="brand" />;
}

export function StreakBlock({ summary }: { summary: MotivationSummary }) {
  const { t, n } = useI18n();
  const s = summary.streak;
  return (
    <div className="text-sm text-slate-700">
      <p className="text-xs uppercase tracking-wide text-slate-500">{t('mot.streak')}</p>
      <p className="text-2xl font-semibold text-slate-900">
        {s.days > 0 ? '🔥 ' : ''}
        <CountUp value={s.days} />
      </p>
      <p>{s.days > 0 ? n('mot.streakDays', s.days) : s.longest > 0 ? t('mot.streakLost') : t('mot.streakNone')}</p>
      <p className="text-xs text-slate-500">
        {t('mot.longest', { n: s.longest })}
        {s.freezeTokens > 0 ? ` · ❄️ ${n('mot.freezes', s.freezeTokens)}` : ''}
      </p>
    </div>
  );
}

export function QuestList({ quests, compact }: { quests: Quest[]; compact?: boolean }) {
  const { t, tag } = useI18n();
  if (quests.length === 0) return <p className="text-sm text-slate-500">{t('mot.noQuests')}</p>;
  return (
    <MotionList className="space-y-3">
      {quests.map((q) => {
        const value = q.kind === 'class' ? (q.classTotal ?? 0) : q.progress;
        const done = q.status === 'completed' || value >= q.goal;
        return (
          <MotionItem key={q.id} className="text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-medium text-slate-900">
                {questTitle(q, t)}
                {done && <span className="ml-2 rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-800">{t('mot.questDone')}</span>}
              </span>
              <span className="text-xs text-slate-500">
                {t('mot.questReward', { xp: q.rewardXp })}
                {!compact && !done ? ` · ${t('mot.questEnds', { date: new Date(q.endsAt).toLocaleDateString(tag, { month: 'short', day: 'numeric' }) })}` : ''}
              </span>
            </div>
            {q.kind === 'class' && <p className="text-xs text-slate-500">{t('mot.questClass', { className: q.className ?? '' })}</p>}
            <ProgressBar value={Math.min(value, q.goal)} max={q.goal} label={q.kind === 'class' ? `${t('mot.questClassTotal', { total: value, goal: q.goal })} · ${t('mot.questYou', { n: q.progress })}` : `${Math.min(value, q.goal)} / ${q.goal}`} tone={done ? 'green' : 'brand'} />
          </MotionItem>
        );
      })}
    </MotionList>
  );
}

export function BadgeTile({ badge, locked }: { badge: Pick<Badge, 'code' | 'name' | 'description' | 'icon'> & Partial<Badge>; locked?: boolean }) {
  const { t, tag } = useI18n();
  return (
    <li className={`rounded-lg p-3 text-center ring-1 ${locked ? 'bg-slate-50 text-slate-600 ring-slate-200' : 'bg-white text-slate-800 ring-brand-200'}`} title={badgeDesc(badge, t)}>
      <p className={`text-2xl ${locked ? 'grayscale opacity-50' : ''}`} aria-hidden>
        {badge.icon}
      </p>
      <p className="mt-1 text-sm font-medium">{badgeName(badge, t)}</p>
      <p className="text-xs">{locked ? t('mot.locked') : badge.earnedAt ? t('mot.earned', { date: new Date(badge.earnedAt).toLocaleDateString(tag) }) : badgeDesc(badge, t)}</p>
      {!locked && badge.awardedBy && badge.reason && <p className="mt-1 text-xs text-slate-500">{t('mot.awardedBy', { name: `${badge.awardedBy.firstName} ${badge.awardedBy.lastName}`, reason: badge.reason })}</p>}
    </li>
  );
}

/** Dashboard card for students: level, streak, this week's quests and the latest badges. */
export function ProgressCard() {
  const { user } = useAuth();
  const { t } = useI18n();
  const { summary } = useMotivation();
  if (user?.role !== 'student') return null;
  if (summary === undefined)
    return (
      <Card title={t('dash.progress')}>
        <SkeletonRows rows={2} />
      </Card>
    );
  if (!summary || !summary.enabled) return null;
  return (
    <Card title={t('dash.progress')} description={t('dash.progressDesc')} actions={<Link href="/motivation" className="text-sm text-brand-700 hover:underline">{t('dash.seeProgress')}</Link>}>
      <div className="flex flex-wrap items-start gap-8">
        <div className="text-center">
          <LevelRing summary={summary} />
          <p className="mt-1 text-xs text-slate-500">{t('mot.toNext', { n: Math.max(0, summary.nextLevelXp - summary.xp), level: summary.level + 1 })}</p>
        </div>
        <StreakBlock summary={summary} />
        <div className="min-w-[240px] flex-1">
          <p className="mb-2 text-xs uppercase tracking-wide text-slate-500">{t('mot.quests')}</p>
          <QuestList quests={summary.quests.filter((q) => q.status === 'active').slice(0, 3)} compact />
        </div>
      </div>
      {summary.badges.length > 0 && (
        <ul className="mt-4 flex flex-wrap gap-2">
          {summary.badges.slice(0, 4).map((b) => (
            <li key={b.code} className="rounded-full bg-brand-50 px-2.5 py-1 text-xs text-brand-800" title={badgeDesc(b, t)}>
              {b.icon} {badgeName(b, t)}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Family view of one child: level, streak and the latest badges, with plain-language explanations. */
export function FamilyMotivationCard({ studentId, firstName }: { studentId: string; firstName: string }) {
  const { t, n } = useI18n();
  const { summary } = useMotivation(studentId);
  if (summary === undefined) return null;
  if (!summary || !summary.enabled) return null;
  return (
    <Card title={t('fam.motivation')} description={t('fam.motivationDesc', { name: firstName })} actions={<Link href={`/motivation?studentId=${studentId}`} className="text-sm text-brand-700 hover:underline">{t('fam.seeAll')}</Link>}>
      <div className="flex flex-wrap items-start gap-8">
        <div className="text-center">
          <LevelRing summary={summary} size={88} />
          <p className="mt-1 text-xs text-slate-500">{titleName(summary.title, t)}</p>
        </div>
        <StreakBlock summary={summary} />
        <div className="min-w-[200px] flex-1 text-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">{t('fam.latestBadges')}</p>
          {summary.badges.length === 0 ? (
            <p className="text-slate-500">{t('mot.noBadges')}</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {summary.badges.slice(0, 3).map((b) => (
                <li key={b.code}>
                  <span aria-hidden>{b.icon}</span> <span className="font-medium text-slate-900">{badgeName(b, t)}</span> <span className="text-slate-500">· {badgeDesc(b, t)}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-slate-500">{n('mot.streakDays', summary.streak.days)}</p>
        </div>
      </div>
    </Card>
  );
}
