'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { H5pPlayer } from '@/components/h5p-player';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card, Input } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { CONTENT_TYPE_LABELS, isQuizDraft, type ContentJob, type FlashcardsDraft, type H5pContentDetail, type QuizDraft, type QuizQuestion } from '@/lib/h5p';

/**
 * Review screen: the teacher reads every generated item, edits text in place, drops weak items,
 * previews the real activity, asks for a regeneration with feedback, and publishes (docs/10 section 7).
 */
export default function ContentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [content, setContent] = useState<H5pContentDetail | null>(null);
  const [draft, setDraft] = useState<QuizDraft | FlashcardsDraft | null>(null);
  const [title, setTitle] = useState('');
  const [state, setState] = useState<{ error?: string; ok?: string; busy?: boolean }>({});
  const [preview, setPreview] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [job, setJob] = useState<ContentJob | null>(null);

  const load = useCallback(async () => {
    try {
      const c = await api<H5pContentDetail>(`/h5p/contents/${id}`);
      setContent(c);
      setTitle(c.title);
      setDraft(c.draft);
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!job || job.status === 'done' || job.status === 'failed') return;
    const t = setTimeout(async () => {
      try {
        const next = await api<ContentJob>(`/ai/jobs/${job.id}`);
        setJob(next);
        if (next.status === 'done' && next.contentId) router.push(`/content/${next.contentId}`);
      } catch (err) {
        setState({ error: errorMessage(err) });
        setJob(null);
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [job, router]);

  async function run(ok: string, fn: () => Promise<unknown>) {
    setState({ busy: true });
    try {
      await fn();
      setState({ ok });
      await load();
    } catch (err) {
      setState({ error: errorMessage(err) });
    }
  }

  /** Edited draft -> parameters. Builds the same H5P shapes the AI service does, so the preview is faithful. */
  async function saveDraft() {
    if (!content || !draft) return;
    const parameters = isQuizDraft(draft) ? quizParameters(draft, content.parameters) : cardParameters(draft, content.parameters);
    await run('Saved.', () => api(`/h5p/contents/${id}`, { method: 'PATCH', body: { title: title.trim(), parameters } }));
    setPreview(false);
  }

  if (!content) return state.error ? <Alert>{state.error}</Alert> : <SkeletonRows rows={4} />;
  const editable = content.status !== 'archived';

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/content" className="text-xs text-brand-700 hover:underline">
            ← Interactive content
          </Link>
          <h1 className="text-2xl font-semibold">{content.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {CONTENT_TYPE_LABELS[content.contentType] ?? content.contentType} · {content.maxScore} item{content.maxScore === 1 ? '' : 's'}
            {content.gradeLevel ? ` · grade ${content.gradeLevel}` : ''}
            {content.source === 'ai' ? ` · drafted by AI (${content.aiModel ?? 'model'}, ${content.promptVersion ?? ''})` : ''}
            {' · '}
            <span className={content.status === 'published' ? 'text-green-700' : 'text-amber-700'}>{content.status}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setPreview((p) => !p)}>
            {preview ? 'Hide preview' : 'Preview as a student'}
          </Button>
          {content.status === 'draft' ? (
            <Button loading={state.busy} disabled={!content.validation.valid} onClick={() => void run('Published. You can now attach it to an assignment.', () => api(`/h5p/contents/${id}/publish`, { method: 'POST' }))}>
              Publish
            </Button>
          ) : (
            content.status === 'published' && (
              <Button variant="secondary" loading={state.busy} onClick={() => void run('Back to draft.', () => api(`/h5p/contents/${id}/unpublish`, { method: 'POST' }))}>
                Unpublish
              </Button>
            )
          )}
        </div>
      </div>
      {state.error && <Alert>{state.error}</Alert>}
      {state.ok && <Alert kind="success">{state.ok}</Alert>}
      {!content.validation.valid && <Alert>Not playable yet: {content.validation.errors.join('; ')}</Alert>}
      {content.source === 'ai' && content.status === 'draft' && <Alert kind="info">Read every item before publishing. AI drafts can be wrong or off-level; you are the author of record.</Alert>}

      {preview && (
        <Card title="Preview" description="Plays exactly what students will get. Preview results are recorded for you but never graded.">
          <H5pPlayer contentId={id} preview />
        </Card>
      )}

      {draft && editable ? (
        <Card title="Items" description="Edit text in place, remove what you do not want, then save.">
          <div className="mb-4">
            <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          {isQuizDraft(draft) ? <QuizEditor draft={draft} onChange={setDraft} /> : <CardsEditor draft={draft} onChange={setDraft} />}
          <div className="mt-4 flex gap-2">
            <Button loading={state.busy} onClick={() => void saveDraft()}>
              Save items
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setDraft(content.draft);
                setTitle(content.title);
              }}
            >
              Discard edits
            </Button>
          </div>
        </Card>
      ) : (
        editable && (
          <Card title="Title">
            <div className="flex items-end gap-2">
              <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
              <Button loading={state.busy} onClick={() => void run('Saved.', () => api(`/h5p/contents/${id}`, { method: 'PATCH', body: { title: title.trim() } }))}>
                Save
              </Button>
            </div>
          </Card>
        )
      )}

      {content.source === 'ai' && content.draft && (
        <Card title="Ask for another draft" description="Tell the AI what to change. A new draft appears alongside this one; this one is kept.">
          <div className="space-y-3">
            <textarea className="block w-full rounded-md border-0 px-3 py-2 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500 sm:text-sm" rows={3} value={feedback} onChange={(e) => setFeedback(e.target.value)} placeholder="Make questions 2 and 4 harder, and add one word problem." />
            {job && job.status === 'failed' && <Alert>Regeneration failed: {job.error?.detail}</Alert>}
            <Button variant="secondary" loading={!!job && job.status !== 'failed' && job.status !== 'done'} disabled={feedback.trim().length < 3} onClick={() => void api<ContentJob>(`/ai/content/${id}/regenerate`, { method: 'POST', body: { feedback: feedback.trim() } }).then(setJob).catch((err) => setState({ error: errorMessage(err) }))}>
              Regenerate
            </Button>
          </div>
        </Card>
      )}

      <Card title="Use it" description={content.status === 'published' ? 'Pick this content when creating an assignment in a class; students play it there and the score posts to the gradebook.' : 'Publish first; then it can be attached to an assignment.'}>
        <p className="text-sm text-slate-600">
          Attached to {content.assignmentCount} assignment{content.assignmentCount === 1 ? '' : 's'} · {content.resultCount} result{content.resultCount === 1 ? '' : 's'} recorded.
        </p>
        {content.assignmentCount === 0 && (
          <Button variant="secondary" className="mt-3" loading={state.busy} onClick={() => void run('Deleted.', () => api(`/h5p/contents/${id}`, { method: 'DELETE' })).then(() => router.push('/content'))}>
            Delete
          </Button>
        )}
      </Card>
    </div>
  );
}

function QuizEditor({ draft, onChange }: { draft: QuizDraft; onChange: (d: QuizDraft) => void }) {
  const update = (i: number, patch: Partial<QuizQuestion>) => onChange({ ...draft, questions: draft.questions.map((q, idx) => (idx === i ? { ...q, ...patch } : q)) });
  const remove = (i: number) => onChange({ ...draft, questions: draft.questions.filter((_, idx) => idx !== i) });
  return (
    <MotionList as="div" className="space-y-4">
      {draft.questions.map((q, i) => (
        <MotionItem as="div" key={i} className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
            <span>
              {i + 1}. {q.type.replace('_', ' ')} · {q.difficulty}
              {q.sourceIds?.length ? ' · from the lesson' : ''}
            </span>
            <button type="button" className="text-red-700 hover:underline" onClick={() => remove(i)}>
              Remove
            </button>
          </div>
          <Input label="Question" value={q.prompt} onChange={(e) => update(i, { prompt: e.target.value })} />
          {q.type === 'multiple_choice' && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {q.options.map((o, oi) => (
                <label key={oi} className="flex items-center gap-2 text-sm">
                  <input type="radio" name={`answer-${i}`} checked={o === q.answer} onChange={() => update(i, { answer: o })} aria-label="Correct answer" />
                  <input className="flex-1 rounded-md border-0 px-2 py-1 shadow-sm ring-1 ring-inset ring-slate-300 focus:ring-2 focus:ring-brand-500" value={o} onChange={(e) => update(i, { options: q.options.map((x, xi) => (xi === oi ? e.target.value : x)), answer: o === q.answer ? e.target.value : q.answer })} />
                </label>
              ))}
            </div>
          )}
          {q.type === 'true_false' && (
            <div className="mt-2 flex gap-4 text-sm">
              {['true', 'false'].map((v) => (
                <label key={v} className="flex items-center gap-1">
                  <input type="radio" name={`tf-${i}`} checked={q.answer === v} onChange={() => update(i, { answer: v })} /> {v}
                </label>
              ))}
            </div>
          )}
          {q.type === 'fill_blank' && (
            <div className="mt-2">
              <Input label="Answer" value={q.answer} onChange={(e) => update(i, { answer: e.target.value })} hint="Use ____ in the question where the blank goes." />
            </div>
          )}
          <div className="mt-2">
            <Input label="Explanation shown after answering" value={q.explanation} onChange={(e) => update(i, { explanation: e.target.value })} />
          </div>
        </MotionItem>
      ))}
    </MotionList>
  );
}

function CardsEditor({ draft, onChange }: { draft: FlashcardsDraft; onChange: (d: FlashcardsDraft) => void }) {
  const update = (i: number, patch: Partial<FlashcardsDraft['cards'][number]>) => onChange({ ...draft, cards: draft.cards.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  return (
    <MotionList as="div" className="space-y-3">
      {draft.cards.map((c, i) => (
        <MotionItem as="div" key={i} className="grid gap-2 rounded-lg border border-slate-200 p-3 sm:grid-cols-[1fr_1fr_auto]">
          <Input label={`Front ${i + 1}`} value={c.front} onChange={(e) => update(i, { front: e.target.value })} />
          <Input label="Back" value={c.back} onChange={(e) => update(i, { back: e.target.value })} />
          <button type="button" className="self-end pb-2 text-xs text-red-700 hover:underline" onClick={() => onChange({ ...draft, cards: draft.cards.filter((_, idx) => idx !== i) })}>
            Remove
          </button>
        </MotionItem>
      ))}
    </MotionList>
  );
}

// ---------------------------------------------------------------------------
// Draft -> H5P parameters (same shapes as apps/ai/app/h5p.py; the API validates before saving)
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const p = (s: string) => `<p>${esc(s.trim())}</p>`;
const behaviour = { enableRetry: true, enableSolutionsButton: true, enableCheckButton: true, confirmCheckDialog: false, confirmRetryDialog: false, autoCheck: false };

function quizParameters(draft: QuizDraft, previous: Record<string, unknown>): Record<string, unknown> {
  const questions = draft.questions.map((q, i) => {
    const sub = { subContentId: `${Date.now()}-${i}`, metadata: { license: 'U', title: q.prompt.slice(0, 120) } };
    if (q.type === 'multiple_choice') {
      return { ...sub, library: 'H5P.MultiChoice 1.16', metadata: { ...sub.metadata, contentType: 'Multiple Choice' }, params: { question: p(q.prompt), answers: q.options.map((o) => ({ text: `<div>${esc(o)}</div>`, correct: o === q.answer, tipsAndFeedback: { tip: '', chosenFeedback: o === q.answer && q.explanation ? `<div>${esc(q.explanation)}</div>` : '', notChosenFeedback: '' } })), behaviour: { ...behaviour, type: 'auto', singlePoint: true, randomAnswers: true, showSolutionsRequiresInput: true, passPercentage: 100, showScorePoints: true }, overallFeedback: [{ from: 0, to: 100 }] } };
    }
    if (q.type === 'true_false') {
      return { ...sub, library: 'H5P.TrueFalse 1.8', metadata: { ...sub.metadata, contentType: 'True/False Question' }, params: { question: p(q.prompt), correct: q.answer === 'true' ? 'true' : 'false', behaviour: { ...behaviour, feedbackOnCorrect: q.explanation, feedbackOnWrong: q.explanation } } };
    }
    const answer = q.answer.replace(/\*/g, '');
    const text = /_{2,}/.test(q.prompt) ? q.prompt.replace(/_{2,}/, `*${answer}*`) : `${q.prompt.trim()} *${answer}*`;
    return { ...sub, library: 'H5P.Blanks 1.14', metadata: { ...sub.metadata, contentType: 'Fill in the Blanks' }, params: { text: q.explanation ? p(q.explanation) : '', questions: [`<p>${esc(text)}</p>`], behaviour: { ...behaviour, caseSensitive: false, showSolutionsRequiresInput: true, separateLines: false, acceptSpellingErrors: true }, overallFeedback: [{ from: 0, to: 100 }] } };
  });
  return { ...previous, questions };
}

function cardParameters(draft: FlashcardsDraft, previous: Record<string, unknown>): Record<string, unknown> {
  return { ...previous, title: p(draft.title), dialogs: draft.cards.map((c) => ({ text: p(c.front), answer: p(c.back), tips: { front: esc(c.hint ?? ''), back: '' } })) };
}
