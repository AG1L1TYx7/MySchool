'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { MotionItem, MotionList, SkeletonRows } from '@/components/motion';
import { Alert, Button, Card, Select } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { timeAgo, type Conversation, type Message, type Person } from '@/lib/communication';
import type { ClassItem } from '@/lib/curriculum';
import { fadeRise, spring, useMotionVariants, useReducedMotion } from '@/lib/motion';
import { connectHub } from '@/lib/realtime';

/**
 * Messaging: conversation list on the left, thread on the right, live over /hubs/messaging
 * (new messages slide in, typing indicator, read marks). Students and parents can only start
 * conversations with staff; teachers can open a class conversation.
 */
export function MessagesView({ selectedId }: { selectedId?: string }) {
  const { user, can } = useAuth();
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);

  const load = useCallback(async () => {
    try {
      setConversations((await api<{ data: Conversation[] }>('/conversations')).data);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const socket = connectHub('/hubs/messaging');
    const bump = (m: Message) =>
      setConversations((list) => {
        if (!list) return list;
        const idx = list.findIndex((c) => c.id === m.conversationId);
        if (idx < 0) {
          void load();
          return list;
        }
        const c = list[idx];
        const mine = m.sender?.id === user?.id;
        const updated: Conversation = { ...c, lastMessage: { id: m.id, content: m.content, senderId: m.sender?.id ?? null, createdAt: m.createdAt }, lastMessageAt: m.createdAt, unreadCount: mine || m.conversationId === selectedId ? c.unreadCount : c.unreadCount + 1 };
        return [updated, ...list.filter((x) => x.id !== c.id)];
      });
    const added = () => void load();
    socket.on('ReceiveMessage:list', bump);
    socket.on('AddedToConversation', added);
    socket.on('connect', load);
    return () => {
      socket.off('ReceiveMessage:list', bump);
      socket.off('AddedToConversation', added);
      socket.off('connect', load);
    };
  }, [load, selectedId, user?.id]);

  // Stable callback: the thread's effects depend on it, so it must not change on every render.
  const markReadLocally = useCallback((id: string) => setConversations((l) => (l && l.some((c) => c.id === id && c.unreadCount > 0) ? l.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)) : l)), []);
  const selected = conversations?.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="mx-auto grid h-[calc(100vh-7rem)] max-w-6xl grid-cols-1 gap-4 md:grid-cols-[300px_1fr]">
      <aside className="flex min-h-0 flex-col rounded-xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
          <h1 className="text-base font-semibold">Messages</h1>
          {can('messages.send') && (
            <Button variant="secondary" onClick={() => setComposing(true)}>
              New
            </Button>
          )}
        </div>
        {error && (
          <div className="p-2">
            <Alert>{error}</Alert>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {conversations === null ? (
            <div className="p-3">
              <SkeletonRows rows={5} />
            </div>
          ) : conversations.length === 0 ? (
            <p className="p-4 text-sm text-slate-500">No conversations yet. Start one with a teacher.</p>
          ) : (
            <MotionList className="divide-y divide-slate-100">
              {conversations.map((c) => (
                <MotionItem key={c.id}>
                  <Link href={`/messages/${c.id}`} className={`block px-3 py-2 hover:bg-slate-50 ${c.id === selectedId ? 'bg-brand-50' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`truncate text-sm ${c.unreadCount ? 'font-semibold text-slate-900' : 'text-slate-800'}`}>{c.title}</span>
                      {c.unreadCount > 0 && <span className="rounded-full bg-brand-600 px-1.5 text-[11px] font-semibold leading-5 text-white">{c.unreadCount}</span>}
                    </div>
                    <p className="truncate text-xs text-slate-500">
                      {c.type !== 'direct' ? `${c.type} · ` : ''}
                      {c.lastMessage ? c.lastMessage.content || '(deleted)' : 'No messages yet'}
                      {c.lastMessageAt ? ` · ${timeAgo(c.lastMessageAt)}` : ''}
                    </p>
                  </Link>
                </MotionItem>
              ))}
            </MotionList>
          )}
        </div>
      </aside>
      <section className="min-h-0">
        {composing ? (
          <Compose
            onCancel={() => setComposing(false)}
            onCreated={(c) => {
              setComposing(false);
              void load().then(() => router.push(`/messages/${c.id}`));
            }}
          />
        ) : selected ? (
          <Thread key={selected.id} conversation={selected} onRead={markReadLocally} />
        ) : (
          <Card>
            <p className="text-sm text-slate-500">Pick a conversation, or start a new one.</p>
          </Card>
        )}
      </section>
    </div>
  );
}

function Compose({ onCancel, onCreated }: { onCancel: () => void; onCreated: (c: Conversation) => void }) {
  const { user } = useAuth();
  const staff = user?.role === 'teacher' || user?.role === 'principal' || user?.role === 'assistant' || user?.role === 'superintendent' || user?.role === 'super_admin';
  const [contacts, setContacts] = useState<Person[]>([]);
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [mode, setMode] = useState<'direct' | 'class'>('direct');
  const [userId, setUserId] = useState('');
  const [classId, setClassId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{ data: Person[] }>('/conversations/contacts').then((r) => setContacts(r.data)).catch((err) => setError(errorMessage(err)));
    if (staff) api<{ data: ClassItem[] }>('/classes/mine').then((r) => setClasses(r.data)).catch(() => setClasses([]));
  }, [staff]);
  async function start(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body = mode === 'class' ? { type: 'class', classId } : { type: 'direct', participantIds: [userId] };
      onCreated(await api<Conversation>('/conversations', { method: 'POST', body }));
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }
  return (
    <Card title="New conversation" description={staff ? 'Message a person, or open a conversation for a whole class.' : 'You can message your teachers and school staff.'}>
      <form onSubmit={(e) => void start(e)} className="space-y-3" noValidate>
        {error && <Alert>{error}</Alert>}
        {staff && (
          <div className="flex gap-4 text-sm">
            <label className="flex items-center gap-1">
              <input type="radio" checked={mode === 'direct'} onChange={() => setMode('direct')} /> Person
            </label>
            <label className="flex items-center gap-1">
              <input type="radio" checked={mode === 'class'} onChange={() => setMode('class')} /> Class
            </label>
          </div>
        )}
        {mode === 'direct' ? (
          <Select label="To" id="to" value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">Choose a person</option>
            {contacts.map((p) => (
              <option key={p.id} value={p.id}>
                {p.firstName} {p.lastName} ({p.role})
              </option>
            ))}
          </Select>
        ) : (
          <Select label="Class" id="class" value={classId} onChange={(e) => setClassId(e.target.value)}>
            <option value="">Choose a class</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        )}
        <div className="flex gap-2">
          <Button type="submit" loading={busy} disabled={mode === 'direct' ? !userId : !classId}>
            Start
          </Button>
          <Button type="button" variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}

function Thread({ conversation, onRead }: { conversation: Conversation; onRead: (id: string) => void }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<Message | null>(null);
  const [typing, setTyping] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefersReduced = useReducedMotion();
  const variants = useMotionVariants(fadeRise);
  const names = new Map(conversation.participants.map((p) => [p.id, `${p.firstName} ${p.lastName}`]));

  useEffect(() => {
    api<{ data: Message[] }>(`/conversations/${conversation.id}/messages`).then((r) => setMessages(r.data)).catch((err) => setError(errorMessage(err)));
    const conversationId = conversation.id;
    void api(`/conversations/${conversationId}/read`, { method: 'POST' }).then(() => onRead(conversationId)).catch(() => undefined);
    const socket = connectHub('/hubs/messaging');
    socket.emit('JoinConversation', { conversationId: conversation.id });
    const onMessage = (m: Message) => {
      if (m.conversationId !== conversation.id) return;
      setMessages((list) => (list && !list.some((x) => x.id === m.id) ? [...list, m] : list));
      if (m.sender?.id !== user?.id) void api(`/conversations/${conversationId}/read`, { method: 'POST' }).then(() => onRead(conversationId)).catch(() => undefined);
    };
    const onEdited = (e: { messageId: string; newContent: string; editedAt: string }) => setMessages((l) => l?.map((m) => (m.id === e.messageId ? { ...m, content: e.newContent, editedAt: e.editedAt } : m)) ?? l);
    const onDeleted = (e: { messageId: string }) => setMessages((l) => l?.map((m) => (m.id === e.messageId ? { ...m, content: '', deletedAt: new Date().toISOString() } : m)) ?? l);
    const onTyping = (e: { userId: string; conversationId: string }) => e.conversationId === conversation.id && e.userId !== user?.id && setTyping((t) => new Set([...t, e.userId]));
    const onStop = (e: { userId: string }) => setTyping((t) => { const n = new Set(t); n.delete(e.userId); return n; });
    socket.on('ReceiveMessage', onMessage);
    socket.on('MessageEdited', onEdited);
    socket.on('MessageDeleted', onDeleted);
    socket.on('UserTyping', onTyping);
    socket.on('UserStoppedTyping', onStop);
    return () => {
      socket.emit('LeaveConversation', { conversationId: conversation.id });
      socket.off('ReceiveMessage', onMessage);
      socket.off('MessageEdited', onEdited);
      socket.off('MessageDeleted', onDeleted);
      socket.off('UserTyping', onTyping);
      socket.off('UserStoppedTyping', onStop);
    };
  }, [conversation.id, onRead, user?.id]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: prefersReduced ? 'auto' : 'smooth' });
  }, [messages?.length, typing.size, prefersReduced]);

  function onType(value: string) {
    setDraft(value);
    const socket = connectHub('/hubs/messaging');
    socket.emit('Typing', { conversationId: conversation.id });
    if (typingTimer.current) clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => socket.emit('StopTyping', { conversationId: conversation.id }), 1500);
  }

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const content = draft.trim();
    if (!content || sending) return;
    setSending(true);
    setError(null);
    try {
      const m = await api<Message>(`/conversations/${conversation.id}/messages`, { method: 'POST', body: { content, replyToMessageId: replyTo?.id } });
      setMessages((l) => (l && !l.some((x) => x.id === m.id) ? [...l, m] : l));
      setDraft('');
      setReplyTo(null);
      connectHub('/hubs/messaging').emit('StopTyping', { conversationId: conversation.id });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSending(false);
    }
  }

  async function remove(m: Message) {
    if (!confirm('Delete this message?')) return;
    await api(`/messages/${m.id}`, { method: 'DELETE' }).catch((err) => setError(errorMessage(err)));
  }

  const typingNames = [...typing].map((id) => names.get(id) ?? 'Someone');
  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-slate-200 bg-white">
      <header className="border-b border-slate-100 px-4 py-2">
        <h2 className="text-base font-semibold text-slate-900">{conversation.title}</h2>
        <p className="text-xs text-slate-500">
          {conversation.participants.map((p) => `${p.firstName} ${p.lastName}`).join(', ')}
          {conversation.type !== 'direct' ? ` · ${conversation.participants.length} people` : ''}
        </p>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3" role="log" aria-live="polite">
        {messages === null ? (
          <SkeletonRows rows={4} />
        ) : (
          <AnimatePresence initial={false}>
            {messages.map((m) => {
              const mine = m.sender?.id === user?.id;
              return (
                <motion.div key={m.id} layout={!prefersReduced} variants={variants} initial="hidden" animate="visible" className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                  <div className={`group max-w-[78%] rounded-2xl px-3 py-2 text-sm ${mine ? 'rounded-br-sm bg-brand-600 text-white' : 'rounded-bl-sm bg-slate-100 text-slate-900'}`}>
                    {!mine && conversation.type !== 'direct' && <p className="text-[11px] font-semibold opacity-80">{m.sender ? `${m.sender.firstName} ${m.sender.lastName}` : 'Removed user'}</p>}
                    {m.replyTo && <p className={`mb-1 border-l-2 pl-2 text-xs ${mine ? 'border-white/60 text-white/80' : 'border-slate-300 text-slate-500'}`}>{m.replyTo.senderName ? `${m.replyTo.senderName}: ` : ''}{m.replyTo.content || '(deleted)'}</p>}
                    {m.deletedAt ? <p className="italic opacity-70">Message deleted</p> : <p className="whitespace-pre-wrap">{m.content}</p>}
                    {m.files.length > 0 && (
                      <ul className="mt-1 text-xs underline">
                        {m.files.map((f) => (
                          <li key={f.id}>{f.originalName}</li>
                        ))}
                      </ul>
                    )}
                    <p className={`mt-1 flex items-center gap-2 text-[10px] ${mine ? 'text-white/70' : 'text-slate-500'}`}>
                      {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      {m.editedAt && ' · edited'}
                      {!m.deletedAt && (
                        <button type="button" className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" onClick={() => setReplyTo(m)}>
                          Reply
                        </button>
                      )}
                      {!m.deletedAt && mine && (
                        <button type="button" className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" onClick={() => void remove(m)}>
                          Delete
                        </button>
                      )}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
        {typingNames.length > 0 && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={spring.soft} className="text-xs text-slate-500">
            {typingNames.join(', ')} {typingNames.length === 1 ? 'is' : 'are'} typing…
          </motion.p>
        )}
        <div ref={endRef} />
      </div>
      {error && (
        <div className="px-4">
          <Alert>{error}</Alert>
        </div>
      )}
      <form onSubmit={(e) => void send(e)} className="border-t border-slate-100 p-3">
        {replyTo && (
          <p className="mb-1 flex items-center justify-between rounded bg-slate-50 px-2 py-1 text-xs text-slate-600">
            <span className="truncate">Replying to: {replyTo.content}</span>
            <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
              ✕
            </button>
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={2}
            maxLength={4000}
            placeholder="Write a message…"
            aria-label="Message"
            className="flex-1 resize-none rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200"
          />
          <Button type="submit" loading={sending} disabled={!draft.trim()}>
            Send
          </Button>
        </div>
      </form>
    </div>
  );
}
