import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';

/** Context Envelope sent to the AI service (docs/10 section 5). */
export interface ContextEnvelope {
  traceId: string;
  capability: 'tutor.chat' | 'tutor.socratic' | 'tutor.homework_help';
  promptProfile?: string;
  organizationId: string | null;
  actor: { userId: string; role: string; ageBand: string; firstName?: string };
  policy: {
    provider: 'ollama' | 'fake';
    showSolutions: boolean;
    maxOutputTokens: number;
    language: string;
  };
  context: {
    studentId?: string;
    classId?: string;
    courseId?: string;
    lessonId?: string;
    gradeLevel?: string;
    learningStyle?: string;
    accessibilityNeeds?: string;
    conversationSummary?: string;
    blocks: Array<{ id: string; label: string; text: string }>;
  };
  input: { messages: Array<{ role: 'user' | 'assistant'; content: string }> };
  options: { stream: boolean };
}

export interface ResultEnvelope {
  traceId: string;
  capability: string;
  promptVersion: string;
  model: { provider: string; name: string };
  output: {
    content: string;
    citations: Array<{ blockId: string; label: string }>;
    nextSteps: string[];
  };
  safety: { input: string; output: string; categories: string[] };
  usage: {
    promptTokens: number;
    completionTokens: number;
    latencyMs: number;
    toolCalls: number;
  };
  status: 'ok' | 'refused' | 'degraded' | 'unavailable';
}

export interface AiHealth {
  status: string;
  provider?: string;
  models?: Record<string, boolean>;
  promptVersions?: string[];
  ragChunks?: number;
}

/**
 * HTTP client for the AI service with timeouts and an honest failure mode (ADR-008):
 * when the service is down the caller gets a 503 problem `ai.unavailable`, never a canned answer.
 */
@Injectable()
export class AiClient {
  private readonly logger = new Logger(AiClient.name);
  private consecutiveFailures = 0;
  private openUntil = 0;

  constructor(private readonly config: AppConfigService) {}

  get baseUrl(): string {
    return this.config.get('AI_SERVICE_URL').replace(/\/$/, '');
  }

  private headers(): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.get('AI_SERVICE_API_KEY')}`,
      'content-type': 'application/json',
      accept: 'application/json',
    };
  }

  /** Simple circuit breaker: after three failures, fail fast for 20 seconds. */
  private assertCircuitClosed(): void {
    if (Date.now() < this.openUntil)
      throw new ServiceUnavailableException({
        code: 'ai.unavailable',
        detail:
          'The AI tutor is temporarily unavailable. Try again in a moment.',
      });
  }

  private recordFailure(err: unknown): never {
    this.consecutiveFailures += 1;
    if (this.consecutiveFailures >= 3) {
      this.openUntil = Date.now() + 20_000;
      this.consecutiveFailures = 0;
    }
    this.logger.warn(
      `AI service call failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    throw new ServiceUnavailableException({
      code: 'ai.unavailable',
      detail:
        'The AI tutor is unavailable right now. Your message was saved; try again shortly.',
    });
  }

  async health(): Promise<AiHealth | null> {
    try {
      const res = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3000),
      });
      return res.ok ? ((await res.json()) as AiHealth) : null;
    } catch {
      return null;
    }
  }

  async tutorChat(envelope: ContextEnvelope): Promise<ResultEnvelope> {
    this.assertCircuitClosed();
    try {
      const res = await fetch(`${this.baseUrl}/v1/tutor/chat`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ ...envelope, options: { stream: false } }),
        signal: AbortSignal.timeout(this.config.get('AI_SERVICE_TIMEOUT_MS')),
      });
      if (!res.ok) throw new Error(`AI service responded ${res.status}`);
      this.consecutiveFailures = 0;
      return (await res.json()) as ResultEnvelope;
    } catch (err) {
      this.recordFailure(err);
    }
  }

  /** Returns the raw SSE body; the caller forwards tokens and parses the final `result` event. */
  async tutorChatStream(
    envelope: ContextEnvelope,
  ): Promise<ReadableStream<Uint8Array>> {
    this.assertCircuitClosed();
    try {
      const res = await fetch(`${this.baseUrl}/v1/tutor/chat`, {
        method: 'POST',
        headers: { ...this.headers(), accept: 'text/event-stream' },
        body: JSON.stringify({ ...envelope, options: { stream: true } }),
        signal: AbortSignal.timeout(this.config.get('AI_SERVICE_TIMEOUT_MS')),
      });
      if (!res.ok || !res.body)
        throw new Error(`AI service responded ${res.status}`);
      this.consecutiveFailures = 0;
      return res.body;
    } catch (err) {
      this.recordFailure(err);
    }
  }

  async ragIndex(
    documents: Array<{
      docId: string;
      organizationId: string;
      courseId?: string | null;
      lessonId?: string | null;
      title: string;
      text: string;
    }>,
  ): Promise<{ documents: number; chunks: number; total: number }> {
    this.assertCircuitClosed();
    try {
      const res = await fetch(`${this.baseUrl}/v1/rag/index`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ documents }),
        signal: AbortSignal.timeout(
          this.config.get('AI_SERVICE_GENERATION_TIMEOUT_MS'),
        ),
      });
      if (!res.ok) throw new Error(`AI service responded ${res.status}`);
      this.consecutiveFailures = 0;
      return (await res.json()) as {
        documents: number;
        chunks: number;
        total: number;
      };
    } catch (err) {
      this.recordFailure(err);
    }
  }
}
