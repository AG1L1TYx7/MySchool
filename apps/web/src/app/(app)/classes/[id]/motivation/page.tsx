'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { MotionItem, MotionList, ProgressBar, SkeletonRows } from '@/components/motion';
import { badgeName, questTitle, titleName } from '@/components/motivation-cards';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { QUEST_METRICS, type ClassConsole } from '@/lib/motivation';
import type { MessageKey } from '@/locales/en';

/** Teacher console (docs/12): who is close to a milestone, awards with a reason, class quests. No ranking. */
export default function ClassMotivationPage() {
  const { id } = useParams<{ id: string }>();
  const { can } = useAuth();
  const { t, n, tag } = useI18n();
  const [data, setData] = useState<ClassConsole | null>(null);
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});
  const [award, setAward] = useState({ studentId: '', kind: 'xp', amount: '10', badgeCode: 'kindness', reason: '' });
  const [quest, setQuest] = useState({ title: '', metric: 'on_time', goal: '10', rewardXp: '30' });
  const allowed = can('motivation.award');

  const load = useCallback(async () => {
    try {
      setData(await api<ClassConsole>(`/classes/${id}/motivation`));
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [id]);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  if (!allowed) return <NotForYou what={t('console.title')} back={`/classes/${id}`} />;

  async function giveAward(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api(`/students/${award.studentId}/motivation/awards`, { method: 'POST', body: award.kind === 'xp' ? { kind: 'xp', amount: Number(award.amount), reason: award.reason } : { kind: 'badge', badgeCode: award.badgeCode, reason: award.reason } });
      setState({ ok: t('console.awarded') });
      setAward((a) => ({ ...a, reason: '' }));
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function createQuest(e: FormEvent) {
    e.preventDefault();
    setState({ busy: true });
    try {
      await api(`/classes/${id}/quests`, { method: 'POST', body: { title: quest.title, metric: quest.metric, goal: Number(quest.goal), rewardXp: Number(quest.rewardXp) } });
      setState({ ok: t('console.questCreated') });
      setQuest((q) => ({ ...q, title: '' }));
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href={`/classes/${id}`} className="text-xs text-brand-700 hover:underline">
          ← {data?.class.name ?? t('common.class')}
        </Link>
        <h1 className="text-2xl font-semibold">{t('console.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('console.desc')}</p>
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      {data && !data.enabled && <Alert kind="info">{t('console.off')}</Alert>}

      <Card description={data ? t('console.streaks', { active: data.streaks.active, total: data.streaks.total }) : undefined}>
        {!data ? (
          <SkeletonRows rows={5} />
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="py-2 pr-4">{t('console.col.student')}</th>
                  <th className="py-2 pr-4">{t('console.col.level')}</th>
                  <th className="py-2 pr-4">{t('console.col.streak')}</th>
                  <th className="py-2 pr-4">{t('console.col.badges')}</th>
                  <th className="py-2 pr-4">{t('console.col.onTime')}</th>
                  <th className="py-2">{t('console.col.last')}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.students.map((s) => (
                  <tr key={s.id} className={s.nearMilestone ? 'bg-amber-50/60' : ''}>
                    <td className="py-2 pr-4 font-medium text-slate-800">
                      <Link href={`/motivation?studentId=${s.id}`} className="hover:underline">
                        {s.lastName}, {s.firstName}
                      </Link>
                      {s.nearMilestone && <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-900">{t('console.near')}</span>}
                    </td>
                    <td className="py-2 pr-4">
                      {s.level} · {titleName(s.title, t)} <span className="text-xs text-slate-500">({s.xp} XP)</span>
                    </td>
                    <td className="py-2 pr-4">{s.streakDays > 0 ? `🔥 ${s.streakDays}` : '—'}</td>
                    <td className="py-2 pr-4">{s.badges}</td>
                    <td className="py-2 pr-4">{s.onTimeSubmissions}</td>
                    <td className="py-2 text-slate-600">{s.lastActionOn ? new Date(`${s.lastActionOn}T12:00:00`).toLocaleDateString(tag) : '—'}</td>
                  </tr>
                ))}
                {data.students.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-4 text-center text-slate-500">
                      —
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title={t('console.awardTitle')} description={t('console.awardDesc')}>
          <form onSubmit={(e) => void giveAward(e)} className="space-y-3" noValidate>
            <Select label={t('console.col.student')} value={award.studentId} onChange={(e) => setAward({ ...award, studentId: e.target.value })}>
              <option value="">{t('common.choose')}</option>
              {(data?.students ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.lastName}, {s.firstName}
                </option>
              ))}
            </Select>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1">
                <input type="radio" checked={award.kind === 'xp'} onChange={() => setAward({ ...award, kind: 'xp' })} /> {t('console.awardXp')}
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={award.kind === 'badge'} onChange={() => setAward({ ...award, kind: 'badge' })} /> {t('console.awardBadge')}
              </label>
            </div>
            {award.kind === 'xp' ? (
              <Input label={t('console.amount')} type="number" min="1" max="100" value={award.amount} onChange={(e) => setAward({ ...award, amount: e.target.value })} />
            ) : (
              <Select label={t('console.awardBadge')} value={award.badgeCode} onChange={(e) => setAward({ ...award, badgeCode: e.target.value })}>
                {(data?.badges ?? []).map((b) => (
                  <option key={b.code} value={b.code}>
                    {b.icon} {badgeName(b, t)}
                  </option>
                ))}
              </Select>
            )}
            <Input label={t('console.reason')} value={award.reason} onChange={(e) => setAward({ ...award, reason: e.target.value })} required />
            <Button type="submit" loading={state.busy} disabled={!award.studentId || award.reason.trim().length < 2}>
              {t('console.award')}
            </Button>
          </form>
        </Card>

        <Card title={t('console.quests')} description={t('console.questsDesc')}>
          {data && data.quests.length === 0 && <p className="text-sm text-slate-500">{t('console.noQuests')}</p>}
          <MotionList className="space-y-3">
            {(data?.quests ?? []).map((q) => (
              <MotionItem key={q.id} className="text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-900">{questTitle(q, t)}</span>
                  <span className="flex items-center gap-2 text-xs text-slate-500">
                    {q.status === 'completed' ? <span className="rounded-full bg-green-100 px-2 py-0.5 text-green-800">{t('mot.questDone')}</span> : null}
                    <button type="button" className="hover:text-red-700" onClick={() => void api(`/quests/${q.id}`, { method: 'DELETE' }).then(load).catch((err) => setState({ error: errorMessage(err) }))}>
                      {t('common.remove')}
                    </button>
                  </span>
                </div>
                <ProgressBar value={Math.min(q.classTotal ?? 0, q.goal)} max={q.goal} label={`${t(`metric.${q.metric}` as MessageKey)} · ${q.classTotal ?? 0} / ${q.goal} · ${n('console.participants', q.participants ?? 0)}`} tone={q.status === 'completed' ? 'green' : 'brand'} />
              </MotionItem>
            ))}
          </MotionList>
          <form onSubmit={(e) => void createQuest(e)} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-2" noValidate>
            <div className="md:col-span-2">
              <Input label={t('console.questTitle')} value={quest.title} onChange={(e) => setQuest({ ...quest, title: e.target.value })} required />
            </div>
            <Select label={t('console.questMetric')} value={quest.metric} onChange={(e) => setQuest({ ...quest, metric: e.target.value })}>
              {QUEST_METRICS.map((m) => (
                <option key={m} value={m}>
                  {t(`metric.${m}` as MessageKey)}
                </option>
              ))}
            </Select>
            <Input label={t('console.questGoal')} type="number" min="1" max="1000" value={quest.goal} onChange={(e) => setQuest({ ...quest, goal: e.target.value })} />
            <Input label={t('console.questReward')} type="number" min="0" max="200" value={quest.rewardXp} onChange={(e) => setQuest({ ...quest, rewardXp: e.target.value })} />
            <div className="flex items-end">
              <Button type="submit" variant="secondary" loading={state.busy} disabled={quest.title.trim().length < 2}>
                {t('console.questCreate')}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
