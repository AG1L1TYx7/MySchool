'use client';

import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { BadgeTile, LevelRing, QuestList, StreakBlock, reasonName, titleName, useMotivation } from '@/components/motivation-cards';
import { NotForYou } from '@/components/not-for-you';
import { SkeletonRows } from '@/components/motion';
import { Alert, Card } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import type { Badge } from '@/lib/motivation';

export default function MotivationPage() {
  return (
    <Suspense fallback={<SkeletonRows rows={4} />}>
      <Progress />
    </Suspense>
  );
}

/** The private progress page: the student's own, or a child's / a taught student's via ?studentId. */
function Progress() {
  const { user } = useAuth();
  const { t, n, tag } = useI18n();
  const params = useSearchParams();
  const studentId = params.get('studentId') ?? undefined;
  const { summary } = useMotivation(studentId);
  const [catalogue, setCatalogue] = useState<Array<Pick<Badge, 'code' | 'name' | 'description' | 'icon' | 'category' | 'tier'>>>([]);
  useEffect(() => {
    api<{ data: typeof catalogue }>('/badges').then((r) => setCatalogue(r.data)).catch(() => setCatalogue([]));
  }, []);

  if (user && user.role !== 'student' && !studentId) return <NotForYou what={t('mot.title')} back="/dashboard" />;
  if (summary === undefined) return <SkeletonRows rows={4} />;
  if (summary === null) return <Alert>{t('nfy.title')}</Alert>;
  const owned = new Set(summary.badges.map((b) => b.code));
  const own = !studentId;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{own ? t('mot.title') : `${summary.student.firstName} ${summary.student.lastName}`}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('mot.subtitle')}</p>
      </div>
      {!summary.enabled && <Alert kind="info">{t('mot.off')}</Alert>}

      <Card>
        <div className="flex flex-wrap items-start gap-10">
          <div className="text-center">
            <LevelRing summary={summary} size={120} />
            <p className="mt-2 text-lg font-semibold text-slate-900">{titleName(summary.title, t)}</p>
            <p className="text-sm text-slate-600">{t('mot.xp', { xp: summary.xp })}</p>
            <p className="text-xs text-slate-500">{t('mot.toNext', { n: Math.max(0, summary.nextLevelXp - summary.xp), level: summary.level + 1 })}</p>
            {summary.todayXp > 0 && <p className="mt-1 text-xs font-medium text-green-700">{t('mot.today', { n: summary.todayXp })}</p>}
          </div>
          <div className="min-w-[220px]">
            <StreakBlock summary={summary} />
            <p className="mt-2 max-w-xs text-xs text-slate-500">{t('mot.freezeHint')}</p>
          </div>
        </div>
      </Card>

      <Card title={t('mot.quests')} description={t('mot.questsDesc')}>
        <QuestList quests={summary.quests} />
      </Card>

      <Card title={t('mot.badges')} description={t('mot.badgesDesc')}>
        {summary.badges.length === 0 && <p className="mb-3 text-sm text-slate-500">{t('mot.noBadges')}</p>}
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {summary.badges.map((b) => (
            <BadgeTile key={b.code} badge={b} />
          ))}
          {catalogue
            .filter((b) => !owned.has(b.code))
            .map((b) => (
              <BadgeTile key={b.code} badge={b} locked />
            ))}
        </ul>
      </Card>

      <Card title={t('mot.recent')}>
        {summary.recent.length === 0 ? (
          <p className="text-sm text-slate-500">{t('mot.noRecent')}</p>
        ) : (
          <ul className="divide-y divide-slate-100 text-sm">
            {summary.recent.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 py-2">
                <span>
                  <span className="font-medium text-slate-900">{reasonName(r.reason, t)}</span>
                  {r.note ? <span className="text-slate-500"> · {r.note}</span> : null}
                  <span className="block text-xs text-slate-500">{new Date(r.createdAt).toLocaleDateString(tag)}</span>
                </span>
                <span className="font-semibold text-green-700">+{r.amount}</span>
              </li>
            ))}
          </ul>
        )}
        {summary.streak.longest > 0 && <p className="mt-3 text-xs text-slate-500">{n('mot.streakDays', summary.streak.longest)}</p>}
      </Card>
    </div>
  );
}
