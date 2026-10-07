import { ApiError, tokenStore, tryRefresh, type ProblemDetails } from './api';

/** Types and the streaming client for the AI tutor (docs/09 AI section, docs/10). */

export const TUTOR_MODES = ['explain', 'socratic', 'homework'] as const;
export type TutorMode = (typeof TUTOR_MODES)[number];

export const MODE_LABELS: Record<TutorMode, string> = { explain: 'Explain', socratic: 'Guide me', homework: 'Homework help' };
export const MODE_HINTS: Record<TutorMode, string> = {
  explain: 'Clear explanations with examples, then a check question.',
  socratic: 'The tutor asks questions so you work it out yourself.',
  homework: 'Hints and next steps, never the finished answer.',
};

export interface Conversation {
  id: string;
  mode: TutorMode;
  title: string;
  courseId: string | null;
  lessonId: string | null;
  classId: string | null;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface TutorMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: 'ok' | 'refused' | 'degraded' | 'unavailable';
  promptVersion: string | null;
  model: string | null;
  citations: Array<{ blockId: string; label: string }>;
  nextSteps: string[];
  safety: { input: string; output: string; categories: string[] } | null;
  feedback: number | null;
  createdAt: string;
}

export interface TutorStatus {
  available: boolean;
  status: string;
  models: Record<string, boolean>;
  promptVersions: string[];
}

/**
 * Sends a message and streams the reply. `onToken` receives text as it arrives; the stored
 * assistant message (with citations and status) is resolved at the end.
 */
export async function streamTutorMessage(conversationId: string, content: string, onToken: (text: string) => void, signal?: AbortSignal, clientMessageId?: string): Promise<{ user: TutorMessage; assistant: TutorMessage }> {
  if (!tokenStore.access) await tryRefresh();
  const send = () =>
    fetch(`/api/v1/ai/tutor/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream', 'x-requested-with': 'SmartSchool', authorization: `Bearer ${tokenStore.access ?? ''}` },
      body: JSON.stringify({ content, stream: true, clientMessageId }),
      credentials: 'same-origin',
      signal,
    });
  let res = await send();
  if (res.status === 401 && (await tryRefresh())) res = await send();
  if (res.ok && (res.headers.get('content-type') ?? '').includes('application/json')) {
    const replay = (await res.json()) as { userMessage: TutorMessage; assistantMessage: TutorMessage };
    return { user: replay.userMessage, assistant: replay.assistantMessage };
  }
  if (!res.ok || !res.body) {
    const problem = (await res.json().catch(() => ({}))) as Partial<ProblemDetails>;
    throw new ApiError({ type: problem.type ?? 'about:blank', title: problem.title ?? res.statusText, status: problem.status ?? res.status, detail: problem.detail ?? 'The tutor could not be reached.', code: problem.code ?? `http.${res.status}`, errors: problem.errors, traceId: problem.traceId });
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let user: TutorMessage | null = null;
  let assistant: TutorMessage | null = null;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      let event = 'message';
      const data: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
      }
      if (data.length === 0) continue;
      const payload = data.join('\n');
      if (event === 'token') onToken((JSON.parse(payload) as { t: string }).t);
      else if (event === 'user') user = JSON.parse(payload) as TutorMessage;
      else if (event === 'assistant') assistant = JSON.parse(payload) as TutorMessage;
    }
  }
  if (!user || !assistant) throw new ApiError({ type: 'about:blank', title: 'Incomplete reply', status: 502, detail: 'The tutor stopped before finishing. Try again.', code: 'ai.stream_incomplete' });
  return { user, assistant };
}
