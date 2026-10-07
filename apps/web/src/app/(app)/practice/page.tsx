'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CurveChart, StandardRow, useCurve, useMastery } from '@/components/learning-cards';
import { notifyMotivation } from '@/components/motivation-cards';
import { Celebration, CountUp, MotionItem, MotionList, PillGroup, ProgressBar, SkeletonRows } from '@/components/motion';
import { NotForYou } from '@/components/not-for-you';
import { Alert, Button, Card, Input, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { QUALITIES, type CardStatus, type PracticeCard, type PracticeQueue, type PracticeStats, type ReviewOutcome } from '@/lib/learning';

interface FlashcardSet {
  id: string;
  title: string;
  library: string;
  contentType?: string;
}

/** Daily practice (docs/02 section 25): a short review queue, one card at a time, rated 0 to 5. Private to the student. */
export default function PracticePage() {
  const { user } = useAuth();
  const { t, n } = useI18n();
  const [queue, setQueue] = useState<PracticeQueue | null>(null);
  const [stats, setStats] = useState<PracticeStats | null>(null);
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState(false);
  const [startedAt, setStartedAt] = useState(Date.now());
  const [last, setLast] = useState<ReviewOutcome | null>(null);
  const [celebrate, setCelebrate] = useState(false);
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});
  const [tab, setTab] = useState<'review' | 'cards' | 'progress'>('review');
  const allowed = user?.role === 'student';

  const load = useCallback(async () => {
    try {
      const [q, s] = await Promise.all([api<PracticeQueue>('/practice/queue'), api<PracticeStats>('/me/practice')]);
      setQueue(q);
      setStats(s);
      setIndex(0);
      setShown(false);
      setStartedAt(Date.now());
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, []);
  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  if (user && !allowed) return <NotForYou what={t('learn.practice.title')} back="/dashboard" />;

  const card = queue?.data[index];

  async function rate(quality: number) {
    if (!card) return;
    setState({ busy: true });
    try {
      const out = await api<ReviewOutcome>(`/practice/cards/${card.id}/review`, { method: 'POST', body: { quality, durationMs: Math.min(3_600_000, Date.now() - startedAt) } });
      setLast(out);
      if (out.reward && out.reward.granted > 0) {
        setCelebrate(true);
        notifyMotivation();
      }
      setStats((s) => (s ? { ...s, reviewedToday: out.reviewedToday } : s));
      if (queue && index + 1 < queue.data.length) {
        setIndex(index + 1);
        setShown(false);
        setStartedAt(Date.now());
        setState({});
      } else {
        await load();
        setState({});
      }
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{t('learn.practice.title')}</h1>
        <p className="mt-1 text-sm text-slate-500">{t('learn.practice.subtitle')}</p>
      </div>
      <Celebration show={celebrate} title={t('learn.practice.goalDone')} message={last?.reward ? `+${last.reward.granted} XP` : undefined} onDone={() => setCelebrate(false)} />
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}

      <PillGroup name="practice-tab" options={['review', 'cards', 'progress'] as const} value={tab} onChange={setTab} labels={(v) => t(`learn.tab.${v}`)} />

      {tab === 'review' && (
        <>
          {stats && (
            <Card>
              <div className="flex flex-wrap items-center gap-8 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">{t('learn.practice.due')}</p>
                  <p className="text-2xl font-semibold text-slate-900">
                    <CountUp value={stats.dueToday} />
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500">{t('learn.practice.new')}</p>
                  <p className="text-2xl font-semibold text-slate-900">
                    <CountUp value={queue?.newCards ?? 0} />
                  </p>
                </div>
                <div className="min-w-[220px] flex-1">
                  <ProgressBar value={Math.min(stats.reviewedToday, stats.sessionGoal)} max={stats.sessionGoal} label={t('learn.practice.goal', { n: stats.reviewedToday, goal: stats.sessionGoal })} tone={stats.reviewedToday >= stats.sessionGoal ? 'green' : 'brand'} />
                </div>
              </div>
            </Card>
          )}
          {!queue ? (
            <SkeletonRows rows={3} />
          ) : !card ? (
            <Card>
              <p className="text-sm text-slate-700">{t('learn.practice.empty')}</p>
            </Card>
          ) : (
            <Card>
              <p className="text-xs uppercase tracking-wide text-slate-500">
                {t('learn.practice.cardOf', { n: index + 1, total: queue.data.length })} · {t(`learn.status.${card.status}`)}
              </p>
              <div className="mt-3 rounded-xl bg-slate-50 p-6 ring-1 ring-slate-200">
                <p className="text-lg font-medium text-slate-900">{card.front}</p>
                {card.hint && !shown && (
                  <details className="mt-2 text-sm text-slate-600">
                    <summary className="cursor-pointer">{t('learn.practice.hint')}</summary>
                    <p className="mt-1">{card.hint}</p>
                  </details>
                )}
                {shown && (
                  <div className="mt-4 border-t border-slate-200 pt-4">
                    <p className="text-xs uppercase tracking-wide text-slate-500">{t('learn.practice.back')}</p>
                    <p className="text-base text-slate-900">{card.back}</p>
                  </div>
                )}
              </div>
              {!shown ? (
                <div className="mt-4">
                  <Button onClick={() => setShown(true)}>{t('learn.practice.show')}</Button>
                </div>
              ) : (
                <fieldset className="mt-4">
                  <legend className="text-sm font-medium text-slate-900">{t('learn.practice.rate')}</legend>
                  <div className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
                    {QUALITIES.map((q) => (
                      <Button key={q} variant={q >= 3 ? 'primary' : 'secondary'} loading={state.busy} onClick={() => void rate(q)}>
                        {t(`learn.practice.q${q}`)}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{t('learn.practice.rateHint')}</p>
                </fieldset>
              )}
              {last && <p className="mt-3 text-xs text-slate-600">{n('learn.practice.nextDays', last.card.intervalDays)}</p>}
            </Card>
          )}
        </>
      )}

      {tab === 'cards' && <CardsTab onChanged={load} setState={setState} />}
      {tab === 'progress' && <ProgressTab stats={stats} />}
    </div>
  );
}

function CardsTab({ onChanged, setState }: { onChanged: () => Promise<void>; setState: (s: { error?: string; ok?: string; busy?: boolean }) => void }) {
  const { t, n } = useI18n();
  const [cards, setCards] = useState<PracticeCard[] | null>(null);
  const [filter, setFilter] = useState<'all' | CardStatus>('all');
  const [form, setForm] = useState({ front: '', back: '', hint: '' });
  const [sets, setSets] = useState<FlashcardSet[]>([]);
  const [setId, setSetId] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mine, library] = await Promise.all([api<{ data: PracticeCard[] }>('/practice/cards'), api<{ data: FlashcardSet[] }>('/h5p/contents?limit=100')]);
      setCards(mine.data);
      setSets(library.data.filter((c) => c.library.startsWith('H5P.Dialogcards')));
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [setState]);
  useEffect(() => {
    void load();
  }, [load]);

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/practice/cards', { method: 'POST', body: { front: form.front, back: form.back, hint: form.hint || undefined } });
      setForm({ front: '', back: '', hint: '' });
      setState({ ok: t('common.saved') });
      await load();
      await onChanged();
    } catch (err) {
      setState({ error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  async function importSet() {
    if (!setId) return;
    setBusy(true);
    try {
      const out = await api<{ created: number; skipped: number }>(`/practice/cards/from-content/${setId}`, { method: 'POST' });
      setState({ ok: t('learn.practice.added', { n: out.created, skipped: out.skipped }) });
      await load();
      await onChanged();
    } catch (err) {
      setState({ error: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  }
  async function toggle(c: PracticeCard) {
    try {
      await api(`/practice/cards/${c.id}/suspend`, { method: 'POST', body: { suspended: !c.suspended } });
      await load();
      await onChanged();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }
  async function remove(c: PracticeCard) {
    try {
      await api(`/practice/cards/${c.id}`, { method: 'DELETE' });
      await load();
      await onChanged();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }

  const visible = (cards ?? []).filter((c) => filter === 'all' || c.status === filter);
  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-2">
        <Card title={t('learn.practice.fromSet')} description={t('learn.practice.fromSetDesc')}>
          {sets.length === 0 ? (
            <p className="text-sm text-slate-500">{t('learn.practice.noSets')}</p>
          ) : (
            <div className="flex flex-wrap items-end gap-2">
              <Select label={t('learn.practice.set')} value={setId} onChange={(e) => setSetId(e.target.value)}>
                <option value="">{t('common.choose')}</option>
                {sets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </Select>
              <Button variant="secondary" loading={busy} onClick={() => void importSet()} disabled={!setId}>
                {t('learn.practice.import')}
              </Button>
            </div>
          )}
        </Card>
        <Card title={t('learn.practice.add')}>
          <form onSubmit={(e) => void add(e)} className="space-y-3">
            <Input label={t('learn.practice.front')} value={form.front} onChange={(e) => setForm({ ...form, front: e.target.value })} required maxLength={2000} />
            <Input label={t('learn.practice.back')} value={form.back} onChange={(e) => setForm({ ...form, back: e.target.value })} required maxLength={4000} />
            <Input label={t('learn.practice.hintLabel')} value={form.hint} onChange={(e) => setForm({ ...form, hint: e.target.value })} maxLength={500} />
            <Button type="submit" loading={busy}>
              {t('common.save')}
            </Button>
          </form>
        </Card>
      </div>
      <Card title={t('learn.practice.myCards')} actions={<PillGroup name="card-filter" options={['all', 'new', 'learning', 'mastered', 'struggling'] as const} value={filter} onChange={setFilter} labels={(v) => (v === 'all' ? t('common.all') : t(`learn.status.${v}`))} />}>
        {cards === null ? (
          <SkeletonRows rows={3} />
        ) : visible.length === 0 ? (
          <p className="text-sm text-slate-500">{t('learn.practice.noCards')}</p>
        ) : (
          <MotionList className="divide-y divide-slate-100">
            {visible.map((c) => (
              <MotionItem key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className={`font-medium ${c.suspended ? 'text-slate-500 line-through' : 'text-slate-900'}`}>{c.front}</p>
                  <p className="text-xs text-slate-600">
                    {c.back} · {t(`learn.status.${c.status}`)} · {n('learn.practice.dueIn', Math.max(0, Math.round((new Date(`${c.dueOn}T00:00:00`).getTime() - Date.now()) / 86_400_000)))}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => void toggle(c)}>
                    {c.suspended ? t('learn.practice.resume') : t('learn.practice.pause')}
                  </Button>
                  <Button variant="secondary" onClick={() => void remove(c)}>
                    {t('common.delete')}
                  </Button>
                </div>
              </MotionItem>
            ))}
          </MotionList>
        )}
      </Card>
    </div>
  );
}

function ProgressTab({ stats }: { stats: PracticeStats | null }) {
  const { t, n } = useI18n();
  const { data: mastery } = useMastery();
  const { data: curve } = useCurve();
  return (
    <div className="space-y-6">
      {stats && (
        <Card title={t('learn.stats.title')}>
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
            {[
              [t('learn.stats.total'), stats.total],
              [t('learn.stats.mastered'), stats.mastered],
              [t('learn.stats.struggling'), stats.struggling],
              [t('learn.stats.days'), stats.practiceDaysLast60],
            ].map(([k, v]) => (
              <div key={String(k)}>
                <dt className="text-xs uppercase tracking-wide text-slate-500">{k}</dt>
                <dd className="text-2xl font-semibold text-slate-900">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-sm text-slate-700">{stats.retentionLast30Days === null ? t('learn.stats.noRetention') : t('learn.stats.retention', { n: stats.retentionLast30Days })}</p>
        </Card>
      )}
      <Card title={t('learn.curve.title')} description={t('learn.curve.desc')}>
        {curve ? <CurveChart curve={curve} /> : <SkeletonRows rows={2} />}
      </Card>
      <Card title={t('learn.mastery.title')} description={t('learn.mastery.desc')}>
        {mastery === undefined ? (
          <SkeletonRows rows={2} />
        ) : !mastery || mastery.standards.length === 0 ? (
          <p className="text-sm text-slate-500">{t('learn.mastery.empty')}</p>
        ) : (
          <>
            <p className="text-sm text-slate-700">{n('learn.mastery.count', mastery.standards.length)}</p>
            <MotionList className="mt-2 divide-y divide-slate-100">
              {mastery.standards.map((s) => (
                <StandardRow key={s.standardId} s={s} />
              ))}
            </MotionList>
          </>
        )}
      </Card>
    </div>
  );
}
