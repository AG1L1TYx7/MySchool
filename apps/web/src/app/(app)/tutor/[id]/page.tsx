'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Alert, Button } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { labelFor, useI18n, type Translate } from '@/lib/i18n';
import { fadeRise, spring, useMotionVariants, useReducedMotion } from '@/lib/motion';
import { streamTutorMessage, type Conversation, type TutorMessage } from '@/lib/tutor';

type Detail = Conversation & { messages: TutorMessage[] };

/**
 * The chat. Replies stream in; every assistant turn is labelled as AI, shows what it cited, and
 * can be rated. Refusals and outages are shown honestly (docs/10 section 8, docs/12 tutor row).
 */
export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useI18n().t;
  const [conversation, setConversation] = useState<Detail | null>(null);
  const [draft, setDraft] = useState('');
  const [pending, setPending] = useState<{ user: string; partial: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      setConversation(await api<Detail>(`/ai/tutor/conversations/${id}`));
    } catch (err) {
      setError(errorMessage(err));
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }, [conversation?.messages.length, pending?.partial]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text || pending || !conversation) return;
    setDraft('');
    setError(null);
    setPending({ user: text, partial: '' });
    try {
      const { user, assistant } = await streamTutorMessage(id, text, (token) => setPending((p) => (p ? { ...p, partial: p.partial + token } : p)));
      setConversation((c) => (c ? { ...c, messageCount: c.messageCount + 2, messages: [...c.messages, user, assistant] } : c));
    } catch (err) {
      setError(errorMessage(err));
      setDraft(text);
      await load();
    } finally {
      setPending(null);
      inputRef.current?.focus();
    }
  }

  async function rate(message: TutorMessage, rating: 1 | -1) {
    const next = message.feedback === rating ? null : rating;
    setConversation((c) => (c ? { ...c, messages: c.messages.map((m) => (m.id === message.id ? { ...m, feedback: next } : m)) } : c));
    if (next) await api(`/ai/tutor/messages/${message.id}/feedback`, { method: 'POST', body: { rating: next } }).catch(() => undefined);
  }

  async function remove() {
    if (!confirm(t('tutor.confirmDelete'))) return;
    await api(`/ai/tutor/conversations/${id}`, { method: 'DELETE' });
    router.push('/tutor');
  }

  if (!conversation) return error ? <Alert>{error}</Alert> : <p className="text-sm text-slate-500">{t('common.loading')}</p>;

  return (
    <div className="mx-auto flex h-[calc(100vh-7rem)] max-w-3xl flex-col">
      <header className="flex items-start justify-between gap-3 pb-3">
        <div>
          <Link href="/tutor" className="text-xs text-brand-700 hover:underline">
            {t('tutor.allConversations')}
          </Link>
          <h1 className="text-xl font-semibold">{conversation.title}</h1>
          <p className="text-xs text-slate-500">
            {labelFor('tutor.mode', conversation.mode, t)} · {labelFor('tutor.hint', conversation.mode, t)}
          </p>
        </div>
        <button className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100" onClick={() => void remove()}>
          {t('common.delete')}
        </button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4" role="log" aria-live="polite" aria-label={t('tutor.conversation')}>
        {conversation.messages.length === 0 && !pending && <Opening mode={conversation.mode} onPick={(q) => setDraft(q)} />}
        <AnimatePresence initial={false}>
          {conversation.messages.map((m) => (
            <Bubble key={m.id} message={m} onRate={rate} />
          ))}
          {pending && (
            <>
              <Bubble key="pending-user" message={{ id: 'pending-user', role: 'user', content: pending.user, status: 'ok', promptVersion: null, model: null, citations: [], nextSteps: [], safety: null, feedback: null, createdAt: '' }} />
              <Bubble key="pending-assistant" message={{ id: 'pending-assistant', role: 'assistant', content: pending.partial, status: 'ok', promptVersion: null, model: null, citations: [], nextSteps: [], safety: null, feedback: null, createdAt: '' }} streaming />
            </>
          )}
        </AnimatePresence>
        <div ref={endRef} />
      </div>

      {error && (
        <div className="pt-2">
          <Alert>{error}</Alert>
        </div>
      )}
      <form onSubmit={(e) => void send(e)} className="flex items-end gap-2 pt-3">
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder={t('tutor.placeholder')}
          className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          aria-label={t('tutor.yourMessage')}
          disabled={!!pending}
        />
        <Button type="submit" loading={!!pending} disabled={!draft.trim()}>
          {t('tutor.send')}
        </Button>
      </form>
      <p className="pt-1 text-xs text-slate-600">{t('tutor.disclaimer')}</p>
    </div>
  );
}

function openingPrompts(mode: Conversation['mode'], t: Translate): string[] {
  const base = mode === 'homework' ? 'homework' : mode === 'socratic' ? 'socratic' : 'explain';
  return [t(`tutor.prompt.${base}1`), t(`tutor.prompt.${base}2`), t(`tutor.prompt.${base}3`)];
}

function Opening({ mode, onPick }: { mode: Conversation['mode']; onPick: (q: string) => void }) {
  const t = useI18n().t;
  return (
    <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
      <p className="font-medium text-slate-800">{t('tutor.hi')}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {openingPrompts(mode, t).map((p) => (
          <button key={p} type="button" className="rounded-full bg-white px-3 py-1 text-xs ring-1 ring-slate-200 hover:bg-brand-50" onClick={() => onPick(p)}>
            {p.trim()}
          </button>
        ))}
      </div>
    </div>
  );
}

function Bubble({ message, streaming, onRate }: { message: TutorMessage; streaming?: boolean; onRate?: (m: TutorMessage, r: 1 | -1) => Promise<void> }) {
  const t = useI18n().t;
  const variants = useMotionVariants(fadeRise);
  const prefersReduced = useReducedMotion();
  const mine = message.role === 'user';
  const tone = message.status === 'refused' ? 'border-amber-200 bg-amber-50' : message.status === 'unavailable' ? 'border-slate-200 bg-slate-50 text-slate-500' : 'border-slate-200 bg-slate-50';
  return (
    <motion.div layout={!prefersReduced} variants={variants} initial="hidden" animate="visible" exit="exit" className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${mine ? 'rounded-br-sm bg-brand-600 text-white' : `rounded-bl-sm border ${tone}`}`}>
        {!mine && (
          <p className="mb-1 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            {t('tutor.aiTutor')}
            {message.status === 'refused' && <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium normal-case tracking-normal text-amber-800">{t('tutor.refused')}</span>}
            {message.status === 'degraded' && <span className="rounded bg-slate-200 px-1.5 py-0.5 font-medium normal-case tracking-normal text-slate-700">{t('tutor.partial')}</span>}
          </p>
        )}
        <div className="whitespace-pre-wrap leading-relaxed">
          {message.content}
          {streaming && (
            <span className="ml-1 inline-flex gap-0.5 align-middle" aria-label={t('tutor.typing')}>
              {[0, 1, 2].map((i) => (
                <motion.span key={i} className="block h-1.5 w-1.5 rounded-full bg-slate-400" animate={prefersReduced ? { opacity: 1 } : { opacity: [0.3, 1, 0.3] }} transition={{ repeat: Infinity, duration: 1, delay: i * 0.15 }} />
              ))}
            </span>
          )}
        </div>
        {!mine && !streaming && (message.citations.length > 0 || onRate) && (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/70 pt-2 text-[11px] text-slate-500">
            <span>{message.citations.length > 0 ? t('tutor.basedOn', { sources: message.citations.map((c) => c.label).join(', ') }) : message.status === 'ok' ? t('tutor.general') : ''}</span>
            {onRate && message.status === 'ok' && (
              <span className="flex gap-1">
                {([1, -1] as const).map((r) => (
                  <motion.button
                    key={r}
                    type="button"
                    whileTap={prefersReduced ? undefined : { scale: 0.85 }}
                    transition={spring.soft}
                    aria-pressed={message.feedback === r}
                    aria-label={r === 1 ? t('tutor.helpful') : t('tutor.notHelpful')}
                    className={`rounded px-1.5 py-0.5 ${message.feedback === r ? 'bg-brand-100 text-brand-800' : 'hover:bg-slate-200'}`}
                    onClick={() => void onRate(message, r)}
                  >
                    {r === 1 ? '👍' : '👎'}
                  </motion.button>
                ))}
              </span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}
