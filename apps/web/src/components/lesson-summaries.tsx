'use client';

import { useCallback, useEffect, useState } from 'react';
import { ReadAloud } from '@/components/accommodations';
import { Alert, Button, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { LANGUAGE_NAMES, waitForJob, type LessonSummary } from '@/lib/family';
import { useI18n } from '@/lib/i18n';

/**
 * Family-language lesson summaries (docs/13 section 7). Teachers ask the AI for a draft per language,
 * edit it and release it; families only ever see released summaries, labelled as AI-generated and reviewed.
 */
export function LessonSummaries({ lessonId }: { lessonId: string }) {
  const { can } = useAuth();
  const { t, locale, tag } = useI18n();
  const staff = can('ai.content.summary');
  const [rows, setRows] = useState<LessonSummary[] | null>(null);
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: string }>({});

  const load = useCallback(async () => {
    try {
      setRows((await api<{ data: LessonSummary[] }>(`/lessons/${lessonId}/summaries`)).data);
    } catch (err) {
      setState({ error: errorMessage(err) });
      setRows([]);
    }
  }, [lessonId]);
  useEffect(() => {
    void load();
  }, [load]);

  async function draft(language: 'en' | 'es') {
    setState({ busy: language });
    try {
      const job = await api<{ id: string }>(`/lessons/${lessonId}/summaries`, { method: 'POST', body: { language } });
      await waitForJob(job.id);
      await load();
      setState({});
    } catch (err) {
      setState({ error: t('sum.failed', { reason: errorMessage(err) }) });
    }
  }

  if (rows === null) return <p className="mt-3 text-xs text-slate-500">{t('common.loading')}</p>;
  // Families see their own language first.
  const ordered = [...rows].sort((a, b) => (a.language === locale ? -1 : b.language === locale ? 1 : 0));

  return (
    <section className="mt-3 rounded-lg border border-slate-200 bg-white p-3" aria-label={t('sum.title')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-900">{t('sum.title')}</h4>
          <p className="text-xs text-slate-500">{staff ? t('sum.descStaff') : t('sum.descFamily')}</p>
        </div>
        {staff && (
          <div className="flex gap-2">
            <Button variant="secondary" loading={state.busy === 'es'} disabled={!!state.busy} onClick={() => void draft('es')}>
              {state.busy === 'es' ? t('sum.drafting') : t('sum.draftEs')}
            </Button>
            <Button variant="secondary" loading={state.busy === 'en'} disabled={!!state.busy} onClick={() => void draft('en')}>
              {state.busy === 'en' ? t('sum.drafting') : t('sum.draftEn')}
            </Button>
          </div>
        )}
      </div>
      {state.error && (
        <div className="mt-2">
          <Alert>{state.error}</Alert>
        </div>
      )}
      {state.ok && (
        <div className="mt-2">
          <Alert kind="success">{state.ok}</Alert>
        </div>
      )}
      {ordered.length === 0 && <p className="mt-2 text-sm text-slate-500">{staff ? t('sum.none') : t('sum.noneFamily')}</p>}
      <div className="mt-2 space-y-3">
        {ordered.map((s) => (staff ? <Editor key={s.id} summary={s} onChanged={load} onMessage={(m) => setState(m)} /> : <Reader key={s.id} summary={s} />))}
      </div>
    </section>
  );

  function Reader({ summary }: { summary: LessonSummary }) {
    const text = [summary.title, summary.summary, ...summary.keyIdeas, ...summary.questions, ...summary.tryAtHome].join('. ');
    return (
      <article className="rounded-md bg-slate-50 p-3 text-sm text-slate-800">
        <p className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500">
          <span>{t('sum.inLanguage', { language: LANGUAGE_NAMES[summary.language]?.[locale] ?? summary.language })}</span>
          {summary.aiGenerated && <span className="rounded bg-brand-50 px-1.5 py-0.5 normal-case tracking-normal text-brand-800">{t('common.aiGenerated')}</span>}
          {summary.reviewedBy && <span className="normal-case tracking-normal">{t('sum.reviewed', { name: `${summary.reviewedBy.firstName} ${summary.reviewedBy.lastName}` })}</span>}
        </p>
        <h5 className="mt-1 font-semibold">{summary.title}</h5>
        <ReadAloud text={text} />
        <p className="mt-1 whitespace-pre-wrap">{summary.summary}</p>
        <Lists summary={summary} />
      </article>
    );
  }

  function Lists({ summary }: { summary: LessonSummary }) {
    const blocks: Array<[string, string[]]> = [
      [t('sum.keyIdeas'), summary.keyIdeas],
      [t('sum.questions'), summary.questions],
      [t('sum.tryAtHome'), summary.tryAtHome],
    ];
    return (
      <>
        {blocks
          .filter(([, items]) => items.length > 0)
          .map(([heading, items]) => (
            <div key={heading} className="mt-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{heading}</p>
              <ul className="list-disc pl-5">
                {items.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ))}
      </>
    );
  }

  function Editor({ summary, onChanged, onMessage }: { summary: LessonSummary; onChanged: () => Promise<void>; onMessage: (m: { error?: string; ok?: string }) => void }) {
    const [form, setForm] = useState({ title: summary.title, summary: summary.summary, keyIdeas: summary.keyIdeas.join('\n'), questions: summary.questions.join('\n'), tryAtHome: summary.tryAtHome.join('\n') });
    const [busy, setBusy] = useState(false);
    const lines = (v: string) => v.split('\n').map((x) => x.trim()).filter(Boolean);
    const body = () => ({ title: form.title.trim(), summary: form.summary.trim(), keyIdeas: lines(form.keyIdeas), questions: lines(form.questions), tryAtHome: lines(form.tryAtHome) });
    async function save(release: boolean) {
      setBusy(true);
      try {
        await api(`/lesson-summaries/${summary.id}`, { method: 'PATCH', body: release ? { ...body(), status: 'released' } : body() });
        onMessage({ ok: release ? t('sum.released') : t('sum.saved') });
        await onChanged();
      } catch (err) {
        onMessage({ error: errorMessage(err) });
      } finally {
        setBusy(false);
      }
    }
    async function remove() {
      setBusy(true);
      try {
        await api(`/lesson-summaries/${summary.id}`, { method: 'DELETE' });
        onMessage({ ok: t('sum.deleted') });
        await onChanged();
      } catch (err) {
        onMessage({ error: errorMessage(err) });
        setBusy(false);
      }
    }
    const released = summary.status === 'released';
    const area = 'block w-full rounded-md border-0 px-3 py-2 text-sm shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500';
    return (
      <article className={`rounded-md p-3 text-sm ${released ? 'bg-green-50/60 ring-1 ring-green-200' : 'bg-slate-50'}`}>
        <p className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500">
          <span>{t('sum.inLanguage', { language: LANGUAGE_NAMES[summary.language]?.[locale] ?? summary.language })}</span>
          <span className={`rounded px-1.5 py-0.5 normal-case tracking-normal ${released ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-900'}`}>{released ? t('sum.statusReleased') : t('sum.statusDraft')}</span>
          {summary.aiGenerated && <span className="normal-case tracking-normal">{t('sum.aiLabel')}</span>}
          {summary.releasedAt && <span className="normal-case tracking-normal">{new Date(summary.releasedAt).toLocaleDateString(tag)}</span>}
        </p>
        <div className="mt-2 grid gap-2">
          <Input label={t('common.title')} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-slate-700">{t('sum.summary')}</span>
            <textarea className={area} rows={4} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} />
          </label>
          <div className="grid gap-2 md:grid-cols-3">
            {(['keyIdeas', 'questions', 'tryAtHome'] as const).map((k) => (
              <label key={k} className="block">
                <span className="mb-1 block text-sm font-medium text-slate-700">
                  {k === 'keyIdeas' ? t('sum.keyIdeas') : k === 'questions' ? t('sum.questions') : t('sum.tryAtHome')} <span className="font-normal text-slate-500">({t('sum.oneLine')})</span>
                </span>
                <textarea className={area} rows={4} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
              </label>
            ))}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" loading={busy} onClick={() => void save(false)} disabled={!form.title.trim() || !form.summary.trim()}>
            {t('common.save')}
          </Button>
          {!released && (
            <Button loading={busy} onClick={() => void save(true)} disabled={!form.title.trim() || !form.summary.trim()}>
              {t('sum.release')}
            </Button>
          )}
          <Button variant="ghost" disabled={busy} onClick={() => void remove()}>
            {t('common.delete')}
          </Button>
        </div>
      </article>
    );
  }
}
