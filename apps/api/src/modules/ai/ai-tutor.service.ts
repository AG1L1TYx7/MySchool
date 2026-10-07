import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import type { Response } from 'express';
import type {
  AiConversation,
  AiMessage,
  Prisma,
} from '../../generated/prisma/client';
import { newId } from '../../common/utils/ids';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import { AuditService } from '../audit/audit.service';
import { SupportService } from '../support/support.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ageBandFor } from './age-band';
import {
  AiClient,
  type ContextEnvelope,
  type ResultEnvelope,
} from './ai.client';
import {
  CreateConversationDto,
  FeedbackDto,
  type TutorMode,
} from './dto/ai.dto';

const CAPABILITY: Record<TutorMode, ContextEnvelope['capability']> = {
  explain: 'tutor.chat',
  socratic: 'tutor.socratic',
  homework: 'tutor.homework_help',
};
const MODE_BY_CAPABILITY: Record<string, TutorMode> = {
  'tutor.chat': 'explain',
  'tutor.socratic': 'socratic',
  'tutor.homework_help': 'homework',
};
const HISTORY_TURNS = 10;

export interface PublicConversation {
  id: string;
  mode: TutorMode;
  title: string;
  courseId: string | null;
  lessonId: string | null;
  classId: string | null;
  messageCount: number;
  lastMessageAt: Date | null;
  createdAt: Date;
}

export interface PublicMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  status: string;
  promptVersion: string | null;
  model: string | null;
  citations: Array<{ blockId: string; label: string }>;
  nextSteps: string[];
  safety: { input: string; output: string; categories: string[] } | null;
  feedback: number | null;
  createdAt: Date;
}

@Injectable()
export class AiTutorService {
  private readonly logger = new Logger(AiTutorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClient,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
    private readonly support: SupportService,
  ) {}

  // ---------------------------------------------------------------------------
  // Conversations
  // ---------------------------------------------------------------------------

  async list(actor: AuthenticatedUser): Promise<PublicConversation[]> {
    const rows = await this.prisma.aiConversation.findMany({
      where: { userId: actor.id, deletedAt: null },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      take: 50,
    });
    return rows.map(toPublicConversation);
  }

  async create(
    dto: CreateConversationDto,
    actor: AuthenticatedUser,
  ): Promise<PublicConversation> {
    await this.support.assertAiAllowedFor(actor);
    const mode = dto.mode ?? 'explain';
    let title = dto.title?.trim();
    if (dto.lessonId) {
      const lesson = await this.prisma.lesson.findFirst({
        where: { id: dto.lessonId, isPublished: true },
        include: {
          module: {
            select: {
              courseId: true,
              course: { select: { organizationId: true } },
            },
          },
        },
      });
      if (!lesson)
        throw new NotFoundException({
          code: 'resource.not_found',
          detail: 'Lesson not found.',
        });
      if (
        lesson.module.course.organizationId !== actor.organizationId &&
        ROLE_LEVEL[actor.role] < ROLE_LEVEL.SUPERINTENDENT
      )
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'That lesson belongs to another organisation.',
        });
      dto.courseId = dto.courseId ?? lesson.module.courseId;
      title = title ?? lesson.title;
    }
    const row = await this.prisma.aiConversation.create({
      data: {
        id: newId(),
        organizationId: actor.organizationId,
        userId: actor.id,
        capability: CAPABILITY[mode],
        courseId: dto.courseId ?? null,
        lessonId: dto.lessonId ?? null,
        classId: dto.classId ?? null,
        title:
          title ??
          `${mode === 'explain' ? 'Tutor' : mode === 'socratic' ? 'Socratic' : 'Homework help'} ${new Date().toLocaleDateString('en-US')}`,
      },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'ai.conversation.create',
      entityType: 'AiConversation',
      entityId: row.id,
      details: { mode },
    });
    return toPublicConversation(row);
  }

  async get(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<PublicConversation & { messages: PublicMessage[] }> {
    const row = await this.find(id, actor);
    const messages = await this.prisma.aiMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: 'asc' },
    });
    return {
      ...toPublicConversation(row),
      messages: messages.map(toPublicMessage),
    };
  }

  async remove(id: string, actor: AuthenticatedUser): Promise<void> {
    await this.find(id, actor);
    await this.prisma.aiConversation.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async feedback(
    messageId: string,
    dto: FeedbackDto,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const msg = await this.prisma.aiMessage.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });
    if (
      !msg ||
      msg.conversation.userId !== actor.id ||
      msg.conversation.deletedAt
    )
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Message not found.',
      });
    await this.prisma.aiMessage.update({
      where: { id: messageId },
      data: { feedback: dto.rating },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'ai.message.feedback',
      entityType: 'AiMessage',
      entityId: messageId,
      details: {
        rating: dto.rating,
        comment: dto.comment ?? null,
        traceId: msg.traceId,
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /** Non-streaming: persist the user turn, call the AI service, persist the assistant turn. */
  /** An offline client that replays a message with the same client id gets the stored turn back, never a second answer. */
  async replay(
    conversationId: string,
    clientMessageId: string,
    actor: AuthenticatedUser,
  ): Promise<{
    userMessage: PublicMessage;
    assistantMessage: PublicMessage;
    replayed: true;
  } | null> {
    await this.find(conversationId, actor);
    const user = await this.prisma.aiMessage.findFirst({
      where: { conversationId, clientMessageId, role: 'USER' },
    });
    if (!user) return null;
    const assistant = await this.prisma.aiMessage.findFirst({
      where: {
        conversationId,
        role: 'ASSISTANT',
        createdAt: { gte: user.createdAt },
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!assistant) return null;
    return {
      userMessage: toPublicMessage(user),
      assistantMessage: toPublicMessage(assistant),
      replayed: true,
    };
  }

  /** Messages after a time, oldest first, so a phone can fill in what it missed while offline. */
  async messagesSince(
    conversationId: string,
    since: string | undefined,
    actor: AuthenticatedUser,
  ): Promise<{ data: PublicMessage[]; serverTime: string }> {
    await this.find(conversationId, actor);
    const from = since ? new Date(since) : null;
    const rows = await this.prisma.aiMessage.findMany({
      where: {
        conversationId,
        ...(from && !Number.isNaN(from.getTime())
          ? { createdAt: { gt: from } }
          : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: 500,
    });
    return {
      data: rows.map(toPublicMessage),
      serverTime: new Date().toISOString(),
    };
  }

  async send(
    conversationId: string,
    content: string,
    actor: AuthenticatedUser,
    clientMessageId?: string,
  ): Promise<{ userMessage: PublicMessage; assistantMessage: PublicMessage }> {
    const { conversation, envelope, userMessage } = await this.prepare(
      conversationId,
      content,
      actor,
      clientMessageId,
    );
    let result: ResultEnvelope;
    try {
      result = await this.ai.tutorChat(envelope);
    } catch (err) {
      await this.persistAssistant(
        conversation,
        envelope.traceId,
        null,
        userMessage.content,
      );
      throw err;
    }
    const assistant = await this.persistAssistant(
      conversation,
      envelope.traceId,
      result,
      userMessage.content,
    );
    return {
      userMessage: toPublicMessage(userMessage),
      assistantMessage: toPublicMessage(assistant),
    };
  }

  /** Streaming: forwards the AI service's SSE to the browser and persists the final result. */
  async stream(
    conversationId: string,
    content: string,
    actor: AuthenticatedUser,
    res: Response,
    clientMessageId?: string,
  ): Promise<void> {
    const { conversation, envelope, userMessage } = await this.prepare(
      conversationId,
      content,
      actor,
      clientMessageId,
    );
    let body: ReadableStream<Uint8Array>;
    try {
      body = await this.ai.tutorChatStream(envelope);
    } catch (err) {
      await this.persistAssistant(
        conversation,
        envelope.traceId,
        null,
        userMessage.content,
      );
      throw err;
    }
    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();
    res.write(
      `event: user\ndata: ${JSON.stringify(toPublicMessage(userMessage))}\n\n`,
    );

    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: ResultEnvelope | null = null;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = parseSse(raw);
          if (!event) continue;
          if (event.event === 'result') {
            result = JSON.parse(event.data) as ResultEnvelope;
          } else {
            res.write(`event: ${event.event}\ndata: ${event.data}\n\n`);
          }
        }
      }
    } catch (err) {
      this.logger.warn(
        `AI stream interrupted: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const assistant = await this.persistAssistant(
      conversation,
      envelope.traceId,
      result,
      userMessage.content,
    );
    res.write(
      `event: assistant\ndata: ${JSON.stringify(toPublicMessage(assistant))}\n\n`,
    );
    res.end();
  }

  // ---------------------------------------------------------------------------
  // Curriculum indexing
  // ---------------------------------------------------------------------------

  async reindex(
    organizationId: string,
    actor: AuthenticatedUser | null,
  ): Promise<{ documents: number; chunks: number }> {
    const lessons = await this.prisma.lesson.findMany({
      where: {
        isPublished: true,
        lessonType: 'TEXT',
        content: { not: null },
        module: {
          isPublished: true,
          course: { organizationId, deletedAt: null, isPublished: true },
        },
      },
      include: {
        module: {
          select: {
            title: true,
            course: { select: { id: true, title: true } },
          },
        },
      },
      take: 5000,
    });
    let documents = 0;
    let chunks = 0;
    for (let i = 0; i < lessons.length; i += 50) {
      const batch = lessons.slice(i, i + 50).map((l) => ({
        docId: `lesson:${l.id}`,
        organizationId,
        courseId: l.module.course.id,
        lessonId: l.id,
        title: `${l.module.course.title} / ${l.module.title} / ${l.title}`,
        text: l.content ?? '',
      }));
      if (batch.length === 0) continue;
      const out = await this.ai.ragIndex(batch);
      documents += out.documents;
      chunks += out.chunks;
    }
    if (actor)
      await this.audit.record({
        userId: actor.id,
        organizationId,
        action: 'ai.rag.reindex',
        entityType: 'Organization',
        entityId: organizationId,
        details: { documents, chunks },
      });
    return { documents, chunks };
  }

  /** Nightly: re-index every active organisation so the tutor cites current lesson text. */
  @Cron('0 2 * * *')
  async nightlyReindex(): Promise<void> {
    if (!(await this.ai.health())) return;
    const orgs = await this.prisma.organization.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true },
    });
    for (const org of orgs) {
      try {
        await this.reindex(org.id, null);
      } catch (err) {
        this.logger.warn(
          `Nightly reindex failed for ${org.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private async find(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<AiConversation> {
    const row = await this.prisma.aiConversation.findFirst({
      where: { id, deletedAt: null },
    });
    if (!row || row.userId !== actor.id)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Conversation not found.',
      });
    return row;
  }

  private async assertQuota(actor: AuthenticatedUser): Promise<void> {
    const limit = this.config.get('AI_TUTOR_DAILY_LIMIT');
    const since = new Date(Date.now() - 86_400_000);
    const used = await this.prisma.aiMessage.count({
      where: {
        role: 'USER',
        createdAt: { gte: since },
        conversation: { userId: actor.id },
      },
    });
    if (used >= limit)
      throw new ForbiddenException({
        code: 'ai.quota_exceeded',
        detail: `You have reached today's limit of ${limit} tutor messages. It resets within 24 hours.`,
      });
  }

  private async prepare(
    conversationId: string,
    content: string,
    actor: AuthenticatedUser,
    clientMessageId?: string,
  ): Promise<{
    conversation: AiConversation;
    envelope: ContextEnvelope;
    userMessage: AiMessage;
  }> {
    const conversation = await this.find(conversationId, actor);
    await this.support.assertAiAllowedFor(actor);
    await this.assertQuota(actor);
    const text = content.trim();
    if (!text)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Write a message first.',
      });

    const [student, lesson, history] = await Promise.all([
      actor.role === 'STUDENT'
        ? this.prisma.student.findFirst({
            where: { userId: actor.id, deletedAt: null },
          })
        : Promise.resolve(null),
      conversation.lessonId
        ? this.prisma.lesson.findFirst({
            where: { id: conversation.lessonId, isPublished: true },
            include: {
              module: {
                select: { title: true, course: { select: { title: true } } },
              },
            },
          })
        : Promise.resolve(null),
      this.prisma.aiMessage.findMany({
        where: { conversationId, status: { in: ['OK', 'REFUSED'] } },
        orderBy: { createdAt: 'desc' },
        take: HISTORY_TURNS * 2,
      }),
    ]);

    const userMessage = await this.prisma.aiMessage.create({
      data: {
        id: newId(),
        conversationId,
        role: 'USER',
        content: text,
        clientMessageId: clientMessageId ?? null,
      },
    });
    const blocks: ContextEnvelope['context']['blocks'] = [];
    if (lesson?.content)
      blocks.push({
        id: 'C1',
        label: `Lesson: ${lesson.title}`,
        text: lesson.content.slice(0, 6000),
      });
    if (student) {
      const facts = [
        `Grade ${student.gradeLevel ?? 'unknown'}`,
        student.preferredLearningStyle
          ? `prefers ${student.preferredLearningStyle.toLowerCase().replace('_', '/')} explanations`
          : null,
      ]
        .filter(Boolean)
        .join('; ');
      blocks.push({
        id: `C${blocks.length + 1}`,
        label: 'About the student',
        text: facts,
      });
    }
    const ageBand = student
      ? ageBandFor(student.dateOfBirth, student.gradeLevel)
      : actor.role === 'PARENT' || ROLE_LEVEL[actor.role] >= ROLE_LEVEL.TEACHER
        ? 'adult'
        : '14-18';
    const recent = history.reverse().map((m) => ({
      role: m.role === 'USER' ? ('user' as const) : ('assistant' as const),
      content: m.content.slice(0, 4000),
    }));
    const envelope: ContextEnvelope = {
      traceId: newId(),
      capability: conversation.capability as ContextEnvelope['capability'],
      organizationId: actor.organizationId,
      actor: {
        userId: actor.id,
        role: actor.role.toLowerCase(),
        ageBand,
        firstName: student?.firstName,
      },
      policy: {
        provider: 'ollama',
        showSolutions: false,
        maxOutputTokens: 700,
        language: 'en',
      },
      context: {
        studentId: student?.id,
        classId: conversation.classId ?? undefined,
        courseId: conversation.courseId ?? undefined,
        lessonId: conversation.lessonId ?? undefined,
        gradeLevel: student?.gradeLevel ?? undefined,
        learningStyle: student?.preferredLearningStyle?.toLowerCase(),
        accessibilityNeeds: student?.accessibilityNeeds ?? undefined,
        conversationSummary: conversation.summary ?? undefined,
        blocks,
      },
      input: { messages: [...recent, { role: 'user', content: text }] },
      options: { stream: false },
    };
    return { conversation, envelope, userMessage };
  }

  private async persistAssistant(
    conversation: AiConversation,
    traceId: string,
    result: ResultEnvelope | null,
    userText = '',
  ): Promise<AiMessage> {
    const status = result
      ? (result.status.toUpperCase() as
          'OK' | 'REFUSED' | 'DEGRADED' | 'UNAVAILABLE')
      : 'UNAVAILABLE';
    const content =
      result && result.status !== 'unavailable'
        ? result.output.content
        : 'The AI tutor is unavailable right now. Your question is saved; try again in a moment.';
    const row = await this.prisma.aiMessage.create({
      data: {
        id: newId(),
        conversationId: conversation.id,
        role: 'ASSISTANT',
        content,
        status,
        promptVersion: result?.promptVersion ?? null,
        model: result ? `${result.model.provider}:${result.model.name}` : null,
        citations: result
          ? JSON.stringify({
              citations: result.output.citations,
              nextSteps: result.output.nextSteps,
            })
          : null,
        safety: result ? JSON.stringify(result.safety) : null,
        usage: result ? JSON.stringify(result.usage) : null,
        traceId,
      },
    });
    const data: Prisma.AiConversationUpdateInput = {
      messageCount: { increment: 2 },
      lastMessageAt: new Date(),
    };
    await this.prisma.aiConversation.update({
      where: { id: conversation.id },
      data,
    });
    if (
      result?.safety.input === 'escalate' ||
      result?.safety.output === 'escalate'
    ) {
      await this.audit.record({
        userId: conversation.userId,
        organizationId: conversation.organizationId,
        action: 'ai.safety.escalated',
        entityType: 'AiConversation',
        entityId: conversation.id,
        details: { traceId, categories: result.safety.categories },
      });
      await this.support.raiseAlert({
        organizationId: conversation.organizationId,
        userId: conversation.userId,
        conversationId: conversation.id,
        messageId: row.id,
        categories: result.safety.categories,
        text: userText,
      });
    }
    return row;
  }
}

function parseSse(raw: string): { event: string; data: string } | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of raw.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
  }
  return data.length ? { event, data: data.join('\n') } : null;
}

function toPublicConversation(c: AiConversation): PublicConversation {
  return {
    id: c.id,
    mode: MODE_BY_CAPABILITY[c.capability] ?? 'explain',
    title: c.title,
    courseId: c.courseId,
    lessonId: c.lessonId,
    classId: c.classId,
    messageCount: c.messageCount,
    lastMessageAt: c.lastMessageAt,
    createdAt: c.createdAt,
  };
}

function toPublicMessage(m: AiMessage): PublicMessage {
  let citations: PublicMessage['citations'] = [];
  let nextSteps: string[] = [];
  let safety: PublicMessage['safety'] = null;
  try {
    if (m.citations) {
      const parsed = JSON.parse(m.citations) as {
        citations?: PublicMessage['citations'];
        nextSteps?: string[];
      };
      citations = parsed.citations ?? [];
      nextSteps = parsed.nextSteps ?? [];
    }
    if (m.safety) safety = JSON.parse(m.safety) as PublicMessage['safety'];
  } catch {
    /* stored by us; ignore malformed */
  }
  return {
    id: m.id,
    role: m.role === 'USER' ? 'user' : 'assistant',
    content: m.content,
    status: m.status.toLowerCase(),
    promptVersion: m.promptVersion,
    model: m.model,
    citations,
    nextSteps,
    safety,
    feedback: m.feedback,
    createdAt: m.createdAt,
  };
}
