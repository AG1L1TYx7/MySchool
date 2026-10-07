/**
 * Offline tolerance for the tutor (docs/07 row 18): the transcript is cached per conversation and messages
 * written while offline wait in an outbox, each with a client id, and are replayed when the network returns.
 * Browser storage is a convenience only; the server copy always wins on reconnect.
 */
import type { TutorMessage } from '@/lib/tutor';

const CACHE_PREFIX = 'ss_tutor_';
const OUTBOX_KEY = 'ss_tutor_outbox';
const CACHE_LIMIT = 200;

export interface OutboxItem {
  conversationId: string;
  clientMessageId: string;
  content: string;
  queuedAt: string;
}

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: the page still works from the server */
  }
}

export function newClientId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export function isOnline(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function cachedTranscript(conversationId: string): TutorMessage[] {
  return read<TutorMessage[]>(`${CACHE_PREFIX}${conversationId}`, []);
}

export function cacheTranscript(conversationId: string, messages: TutorMessage[]): void {
  write(`${CACHE_PREFIX}${conversationId}`, messages.slice(-CACHE_LIMIT));
}

export function outbox(conversationId?: string): OutboxItem[] {
  const all = read<OutboxItem[]>(OUTBOX_KEY, []);
  return conversationId ? all.filter((o) => o.conversationId === conversationId) : all;
}

export function enqueue(item: OutboxItem): void {
  const all = outbox();
  if (all.some((o) => o.clientMessageId === item.clientMessageId)) return;
  write(OUTBOX_KEY, [...all, item]);
}

export function dequeue(clientMessageId: string): void {
  write(OUTBOX_KEY, outbox().filter((o) => o.clientMessageId !== clientMessageId));
}

/** Network failures (offline, DNS, aborted) as opposed to answers from the server. */
export function isNetworkError(err: unknown): boolean {
  if (!isOnline()) return true;
  if (err instanceof TypeError) return true;
  const code = (err as { code?: string; status?: number }).code ?? '';
  const status = (err as { status?: number }).status;
  return code === 'http.0' || status === 0 || status === 502 || status === 503 || status === 504;
}
