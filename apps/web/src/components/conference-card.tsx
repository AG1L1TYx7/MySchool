'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Select } from '@/components/ui';
import { ApiError, api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { waitForJob, type ConferenceNote } from '@/lib/family';
import { useI18n } from '@/lib/i18n';

/**
 * Conference talking points for teachers and counselors (docs/13 section 7): AI drafts from the
 * student's own records only, every note is labelled as AI-generated, and it never shows to families.
 */
export function ConferenceCard({ studentId }: { studentId: string }) {
  const { can } = useAuth();
  const { t, tag } = useI18n();
  const [notes, setNotes] = useState<ConferenceNote[] | null>(null);
  const [hidden, setHidden] = useState(!can('ai.content.conference'));
  const [language, setLanguage] = useState<'en' | 'es'>('en');
  const [state, setState] = useState<{ error?: string; busy?: boolean }>({});

  const load = useCallback(async () => {
    try {
      setNotes((await api<{ data: ConferenceNote[] }>(`/students/${studentId}/conference-notes`)).data);
    } catch (err) {
      if (err instanceof ApiError && (err.problem.status === 403 || err.problem.status === 404)) setHidden(true);
      else setState({ error: errorMessage(err) });
    }
  }, [studentId]);
  useEffect(() => {
    if (!hidden) void load();
  }, [hidden, load]);
  if (hidden) return null;

  async function draft() {
    setState({ busy: true });
    try {
      const job = await api<{ id: string }>(`/students/${studentId}/conference-notes`, { method: 'POST', body: { language } });
      await waitForJob(job.id);
      await load();
      setState({});
    } catch (err) {
      setState({ error: t('conf.failed', { reason: errorMessage(err) }) });
    }
  }

  const sections: Array<[string, keyof ConferenceNote['content']]> = [
    [t('conf.strengths'), 'strengths'],
    [t('conf.concerns'), 'concerns'],
    [t('conf.talkingPoints'), 'talkingPoints'],
    [t('conf.questionsForFamily'), 'questionsForFamily'],
    [t('conf.nextSteps'), 'nextSteps'],
  ];

  return (
    <Card title={t('conf.title')} description={t('conf.desc')}>
      {state.error && <Alert>{state.error}</Alert>}
      <div className="flex flex-wrap items-end gap-2">
        <Select label={t('lang.label')} value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'es')}>
          <option value="en">{t('lang.en')}</option>
          <option value="es">{t('lang.es')}</option>
        </Select>
        <Button onClick={() => void draft()} loading={state.busy}>
          {state.busy ? t('conf.drafting') : t('conf.draft')}
        </Button>
      </div>
      {notes && notes.length === 0 && <p className="mt-3 text-sm text-slate-500">{t('conf.none')}</p>}
      <div className="mt-3 space-y-3">
        {(notes ?? []).map((note) => (
          <article key={note.id} className="rounded-md bg-slate-50 p-3 text-sm text-slate-800">
            <p className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-slate-500">
              {note.aiModel && <span className="rounded bg-brand-50 px-1.5 py-0.5 normal-case tracking-normal text-brand-800">{t('conf.aiLabel')}</span>}
              <span className="normal-case tracking-normal">{t('conf.by', { name: `${note.author.firstName} ${note.author.lastName}`, date: new Date(note.createdAt).toLocaleDateString(tag) })}</span>
              <button type="button" className="ml-auto normal-case tracking-normal text-slate-500 hover:text-red-700" onClick={() => void api(`/conference-notes/${note.id}`, { method: 'DELETE' }).then(load).catch((err) => setState({ error: errorMessage(err) }))}>
                {t('common.remove')}
              </button>
            </p>
            {note.content.opening && (
              <p className="mt-2">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{t('conf.opening')}</span>
                <br />
                {note.content.opening}
              </p>
            )}
            {sections
              .filter(([, key]) => Array.isArray(note.content[key]) && (note.content[key] as string[]).length > 0)
              .map(([heading, key]) => (
                <div key={key} className="mt-2">
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{heading}</p>
                  <ul className="list-disc pl-5">
                    {(note.content[key] as string[]).map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
          </article>
        ))}
      </div>
    </Card>
  );
}
