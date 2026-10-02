import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type {
  Conversation,
  ConversationParticipant,
  Message,
  Prisma,
  Role,
} from '../../generated/prisma/client';
import { domainEvent } from '../../common/events/domain-event';
import { newId } from '../../common/utils/ids';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ROLE_LEVEL } from '../access/roles';
import { isDistrictRole } from '../access/scope';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { canManage } from '../classes/classes.service';
import { FilesService, type PublicFile } from '../files/files.service';
import {
  AddParticipantsDto,
  CreateConversationDto,
  EditMessageDto,
  ListMessagesQuery,
  SendMessageDto,
  UpdateConversationDto,
} from './dto/messaging.dto';
import {
  canCreateGroup,
  canDeleteMessage,
  canDirectMessage,
  canEditMessage,
  displayTitle,
  isStaffRole,
  unreadCount,
} from './messaging-rules';
import { MessagingGateway } from './messaging.gateway';

export interface Person {
  id: string;
  firstName: string;
  lastName: string;
  role: string;
}

export interface PublicConversation {
  id: string;
  type: 'direct' | 'group' | 'class';
  title: string;
  classId: string | null;
  participants: Array<Person & { lastReadAt: Date | null }>;
  lastMessage: {
    id: string;
    content: string;
    senderId: string | null;
    createdAt: Date;
  } | null;
  unreadCount: number;
  muted: boolean;
  lastMessageAt: Date | null;
  createdAt: Date;
}

export interface PublicMessage {
  id: string;
  conversationId: string;
  sender: Person | null;
  content: string;
  replyTo: { id: string; content: string; senderName: string | null } | null;
  files: PublicFile[];
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
}

const personSelect = {
  id: true,
  firstName: true,
  lastName: true,
  role: true,
} as const;

type ConversationRow = Conversation & {
  participants: Array<
    ConversationParticipant & {
      user: { id: string; firstName: string; lastName: string; role: Role };
    }
  >;
  messages: Array<
    Pick<Message, 'id' | 'content' | 'senderId' | 'createdAt' | 'deletedAt'>
  >;
};

type MessageRow = Message & {
  sender: {
    id: string;
    firstName: string;
    lastName: string;
    role: Role;
  } | null;
  replyTo: {
    id: string;
    content: string;
    deletedAt: Date | null;
    sender: { firstName: string; lastName: string } | null;
  } | null;
  files: Array<{ file: Parameters<typeof FilesService.prototype.toPublic>[0] }>;
};

@Injectable()
export class MessagingService {
  private readonly conversationInclude = {
    participants: {
      where: { leftAt: null },
      include: { user: { select: personSelect } },
    },
    messages: {
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' as const },
      take: 1,
      select: {
        id: true,
        content: true,
        senderId: true,
        createdAt: true,
        deletedAt: true,
      },
    },
  } satisfies Prisma.ConversationInclude;

  private readonly messageInclude = {
    sender: { select: personSelect },
    replyTo: {
      select: {
        id: true,
        content: true,
        deletedAt: true,
        sender: { select: { firstName: true, lastName: true } },
      },
    },
    files: { include: { file: true } },
  } satisfies Prisma.MessageInclude;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly events: EventEmitter2,
    private readonly files: FilesService,
    private readonly gateway: MessagingGateway,
  ) {}

  // ---------------------------------------------------------------------------
  // Contacts and conversations
  // ---------------------------------------------------------------------------

  /** People this user may start a direct conversation with. */
  async contacts(actor: AuthenticatedUser, search?: string): Promise<Person[]> {
    const where: Prisma.UserWhereInput = {
      status: 'ACTIVE',
      deletedAt: null,
      id: { not: actor.id },
    };
    if (!isDistrictRole(actor))
      where.organizationId = actor.organizationId ?? '__none__';
    if (!isStaffRole(actor.role))
      where.role = { in: ['TEACHER', 'ASSISTANT', 'PRINCIPAL'] };
    if (search)
      where.OR = [
        { firstName: { contains: search } },
        { lastName: { contains: search } },
        { email: { contains: search } },
      ];
    const rows = await this.prisma.user.findMany({
      where,
      select: personSelect,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 200,
    });
    return rows.map(toPerson);
  }

  async list(actor: AuthenticatedUser): Promise<PublicConversation[]> {
    const rows = await this.prisma.conversation.findMany({
      where: { participants: { some: { userId: actor.id, leftAt: null } } },
      include: this.conversationInclude,
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
    });
    return Promise.all(rows.map((r) => this.toPublicConversation(r, actor)));
  }

  async get(id: string, actor: AuthenticatedUser): Promise<PublicConversation> {
    const row = await this.findConversation(id, actor);
    return this.toPublicConversation(row, actor);
  }

  async create(
    dto: CreateConversationDto,
    actor: AuthenticatedUser,
  ): Promise<PublicConversation> {
    const type = (dto.type ?? 'direct').toUpperCase() as Conversation['type'];
    if (type === 'CLASS') return this.createClassConversation(dto, actor);
    const others = [
      ...new Set((dto.participantIds ?? []).filter((id) => id !== actor.id)),
    ];
    if (type === 'DIRECT' && others.length !== 1)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'A direct conversation has exactly one other participant.',
      });
    if (type === 'GROUP' && !canCreateGroup(actor.role))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only staff start group conversations.',
      });
    if (others.length === 0)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Add at least one participant.',
      });
    const people = await this.loadReachable(others, actor);

    if (type === 'DIRECT') {
      const existing = await this.prisma.conversation.findFirst({
        where: {
          type: 'DIRECT',
          AND: [
            { participants: { some: { userId: actor.id, leftAt: null } } },
            { participants: { some: { userId: others[0], leftAt: null } } },
          ],
        },
        include: this.conversationInclude,
      });
      if (existing && existing.participants.length === 2)
        return this.toPublicConversation(existing, actor);
    }
    const row = await this.prisma.conversation.create({
      data: {
        id: newId(),
        organizationId:
          actor.organizationId ?? people[0]?.organizationId ?? null,
        type,
        title: type === 'GROUP' ? (dto.title?.trim() ?? null) : null,
        createdById: actor.id,
        participants: {
          create: [actor.id, ...others].map((userId) => ({
            id: newId(),
            userId,
          })),
        },
      },
      include: this.conversationInclude,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: row.organizationId,
      action: 'conversations.create',
      entityType: 'Conversation',
      entityId: row.id,
      details: { type, participants: others.length + 1 },
    });
    const pub = await this.toPublicConversation(row, actor);
    this.gateway.conversationCreated(others, pub);
    return pub;
  }

  private async createClassConversation(
    dto: CreateConversationDto,
    actor: AuthenticatedUser,
  ): Promise<PublicConversation> {
    if (!dto.classId)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'classId is required for a class conversation.',
      });
    const klass = await this.prisma.class.findFirst({
      where: { id: dto.classId, deletedAt: null },
      select: {
        id: true,
        name: true,
        organizationId: true,
        teachers: { select: { teacherId: true } },
        enrollments: {
          where: { status: 'ENROLLED' },
          select: { student: { select: { userId: true } } },
        },
      },
    });
    if (!klass)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Class not found.',
      });
    if (!canManage(klass, actor))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail:
          'Only a teacher of the class or an administrator can open its conversation.',
      });
    const existing = await this.prisma.conversation.findFirst({
      where: { type: 'CLASS', classId: klass.id },
      include: this.conversationInclude,
    });
    if (existing) {
      await this.ensureParticipant(existing.id, actor.id);
      return this.toPublicConversation(
        await this.findConversation(existing.id, actor),
        actor,
      );
    }
    const members = new Set<string>([
      actor.id,
      ...klass.teachers.map((t) => t.teacherId),
      ...klass.enrollments
        .map((e) => e.student.userId)
        .filter((id): id is string => !!id),
    ]);
    const row = await this.prisma.conversation.create({
      data: {
        id: newId(),
        organizationId: klass.organizationId,
        type: 'CLASS',
        classId: klass.id,
        title: dto.title?.trim() || klass.name,
        createdById: actor.id,
        participants: {
          create: [...members].map((userId) => ({ id: newId(), userId })),
        },
      },
      include: this.conversationInclude,
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: klass.organizationId,
      action: 'conversations.create',
      entityType: 'Conversation',
      entityId: row.id,
      details: { type: 'CLASS', classId: klass.id, participants: members.size },
    });
    const pub = await this.toPublicConversation(row, actor);
    this.gateway.conversationCreated(
      [...members].filter((id) => id !== actor.id),
      pub,
    );
    return pub;
  }

  async update(
    id: string,
    dto: UpdateConversationDto,
    actor: AuthenticatedUser,
  ): Promise<PublicConversation> {
    const row = await this.findConversation(id, actor);
    if (dto.title !== undefined) {
      if (row.type === 'DIRECT')
        throw new BadRequestException({
          code: 'request.invalid',
          detail:
            'Direct conversations take their name from the people in them.',
        });
      if (row.createdById !== actor.id && !isStaffRole(actor.role))
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'Only the creator or staff rename a conversation.',
        });
      await this.prisma.conversation.update({
        where: { id },
        data: { title: dto.title.trim() },
      });
    }
    if (dto.muted !== undefined)
      await this.prisma.conversationParticipant.updateMany({
        where: { conversationId: id, userId: actor.id },
        data: { muted: dto.muted },
      });
    return this.toPublicConversation(
      await this.findConversation(id, actor),
      actor,
    );
  }

  async addParticipants(
    id: string,
    dto: AddParticipantsDto,
    actor: AuthenticatedUser,
  ): Promise<PublicConversation> {
    const row = await this.findConversation(id, actor);
    if (row.type === 'DIRECT')
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Start a group conversation to add more people.',
      });
    if (!isStaffRole(actor.role))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only staff add participants.',
      });
    const ids = [...new Set(dto.userIds)].filter(
      (u) => !row.participants.some((p) => p.userId === u),
    );
    await this.loadReachable(ids, actor);
    for (const userId of ids) await this.ensureParticipant(id, userId);
    const fresh = await this.findConversation(id, actor);
    const pub = await this.toPublicConversation(fresh, actor);
    this.gateway.conversationCreated(ids, pub);
    this.gateway.toConversation(id, 'ParticipantAdded', {
      conversationId: id,
      userIds: ids,
    });
    return pub;
  }

  async removeParticipant(
    id: string,
    userId: string,
    actor: AuthenticatedUser,
  ): Promise<void> {
    const row = await this.findConversation(id, actor);
    const self = userId === actor.id;
    if (!self && !isStaffRole(actor.role))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'Only staff remove participants.',
      });
    if (row.type === 'DIRECT' && !self)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Leave the conversation instead.',
      });
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId: id, userId, leftAt: null },
      data: { leftAt: new Date() },
    });
    this.gateway.toConversation(id, 'ParticipantRemoved', {
      conversationId: id,
      userId,
    });
    this.gateway.toUsers([userId], 'RemovedFromConversation', {
      conversationId: id,
    });
  }

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  async messages(
    id: string,
    q: ListMessagesQuery,
    actor: AuthenticatedUser,
  ): Promise<PublicMessage[]> {
    await this.findConversation(id, actor);
    const where: Prisma.MessageWhereInput = { conversationId: id };
    if (q.before) {
      const anchor = await this.prisma.message.findFirst({
        where: { id: q.before, conversationId: id },
        select: { createdAt: true },
      });
      if (anchor) where.createdAt = { lt: anchor.createdAt };
    }
    const rows = await this.prisma.message.findMany({
      where,
      include: this.messageInclude,
      orderBy: { createdAt: 'desc' },
      take: q.limit,
    });
    return rows.reverse().map((m) => this.toPublicMessage(m));
  }

  async send(
    id: string,
    dto: SendMessageDto,
    actor: AuthenticatedUser,
  ): Promise<PublicMessage> {
    const row = await this.findConversation(id, actor);
    const content = dto.content.trim();
    if (!content)
      throw new BadRequestException({
        code: 'request.invalid',
        detail: 'Write a message first.',
      });
    const fileIds = [...new Set(dto.fileIds ?? [])];
    await this.files.assertOwnedFiles(fileIds, actor);
    if (dto.replyToMessageId) {
      const target = await this.prisma.message.findFirst({
        where: { id: dto.replyToMessageId, conversationId: id },
      });
      if (!target)
        throw new BadRequestException({
          code: 'request.invalid',
          detail:
            'The message you are replying to is not in this conversation.',
        });
    }
    const now = new Date();
    const message = await this.prisma.message.create({
      data: {
        id: newId(),
        conversationId: id,
        senderId: actor.id,
        content,
        replyToMessageId: dto.replyToMessageId ?? null,
        createdAt: now,
        files: { create: fileIds.map((fileId) => ({ id: newId(), fileId })) },
      },
      include: this.messageInclude,
    });
    await Promise.all([
      this.prisma.conversation.update({
        where: { id },
        data: { lastMessageAt: now },
      }),
      this.prisma.conversationParticipant.updateMany({
        where: { conversationId: id, userId: actor.id },
        data: { lastReadAt: now },
      }),
    ]);
    const pub = this.toPublicMessage(message);
    const participants = row.participants.map((p) => p.userId);
    this.gateway.messageEvent(id, participants, 'ReceiveMessage', pub);
    const recipients = row.participants
      .filter((p) => p.userId !== actor.id && !p.muted)
      .map((p) => p.userId);
    const sender = row.participants.find((p) => p.userId === actor.id)?.user;
    this.events.emit(
      'message.sent',
      domainEvent({
        eventType: 'message.sent',
        entityType: 'Message',
        entityId: message.id,
        organizationId: row.organizationId,
        actorId: actor.id,
        data: {
          conversationId: id,
          messageId: message.id,
          recipientIds: recipients,
          senderName: sender
            ? `${sender.firstName} ${sender.lastName}`
            : 'Someone',
          content,
          conversationTitle: row.type === 'DIRECT' ? null : (row.title ?? null),
        },
      }),
    );
    return pub;
  }

  async edit(
    messageId: string,
    dto: EditMessageDto,
    actor: AuthenticatedUser,
  ): Promise<PublicMessage> {
    const message = await this.findMessage(messageId, actor);
    if (!canEditMessage(message, actor.id))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'You can edit your own messages for an hour after sending.',
      });
    const updated = await this.prisma.message.update({
      where: { id: messageId },
      data: { content: dto.content.trim(), editedAt: new Date() },
      include: this.messageInclude,
    });
    const pub = this.toPublicMessage(updated);
    this.gateway.toConversation(message.conversationId, 'MessageEdited', {
      messageId,
      conversationId: message.conversationId,
      newContent: pub.content,
      editedAt: pub.editedAt,
    });
    return pub;
  }

  async remove(messageId: string, actor: AuthenticatedUser): Promise<void> {
    const message = await this.findMessage(messageId, actor);
    const canModerate =
      isStaffRole(actor.role) &&
      (await this.hasFeature(actor, 'messages.delete'));
    if (!canDeleteMessage(message, { id: actor.id, canModerate }))
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: 'You can delete your own messages; staff can moderate.',
      });
    await this.prisma.message.update({
      where: { id: messageId },
      data: { deletedAt: new Date(), content: '' },
    });
    await this.audit.record({
      userId: actor.id,
      organizationId: actor.organizationId,
      action: 'messages.delete',
      entityType: 'Message',
      entityId: messageId,
      details: { moderated: message.senderId !== actor.id },
    });
    this.gateway.toConversation(message.conversationId, 'MessageDeleted', {
      messageId,
      conversationId: message.conversationId,
    });
  }

  async markRead(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<{ readAt: Date }> {
    await this.findConversation(id, actor);
    const readAt = new Date();
    await this.prisma.conversationParticipant.updateMany({
      where: { conversationId: id, userId: actor.id },
      data: { lastReadAt: readAt },
    });
    this.gateway.toConversation(id, 'ConversationRead', {
      conversationId: id,
      userId: actor.id,
      readAt,
    });
    return { readAt };
  }

  /** For the gateway: is this user in the conversation? */
  async isParticipant(id: string, userId: string): Promise<boolean> {
    return (
      (await this.prisma.conversationParticipant.count({
        where: { conversationId: id, userId, leftAt: null },
      })) > 0
    );
  }

  // ---------------------------------------------------------------------------

  private async loadReachable(ids: string[], actor: AuthenticatedUser) {
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids }, status: 'ACTIVE', deletedAt: null },
      select: { id: true, role: true, organizationId: true },
    });
    if (users.length !== ids.length)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'One or more people were not found.',
      });
    for (const u of users) {
      if (!isDistrictRole(actor) && u.organizationId !== actor.organizationId)
        throw new ForbiddenException({
          code: 'authz.forbidden',
          detail: 'You can only message people in your school.',
        });
      if (!canDirectMessage(actor.role, u.role))
        throw new ForbiddenException({
          code: 'messaging.not_allowed',
          detail:
            'Students and parents can message school staff; classmates talk in class conversations a teacher opens.',
        });
    }
    return users;
  }

  private async ensureParticipant(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const existing = await this.prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    if (!existing)
      await this.prisma.conversationParticipant.create({
        data: { id: newId(), conversationId, userId },
      });
    else if (existing.leftAt)
      await this.prisma.conversationParticipant.update({
        where: { id: existing.id },
        data: { leftAt: null, joinedAt: new Date() },
      });
  }

  private async findConversation(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<ConversationRow> {
    const row = await this.prisma.conversation.findFirst({
      where: { id, participants: { some: { userId: actor.id, leftAt: null } } },
      include: this.conversationInclude,
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Conversation not found.',
      });
    return row;
  }

  private async findMessage(
    id: string,
    actor: AuthenticatedUser,
  ): Promise<Message> {
    const row = await this.prisma.message.findFirst({
      where: {
        id,
        conversation: {
          participants: { some: { userId: actor.id, leftAt: null } },
        },
      },
    });
    if (!row)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Message not found.',
      });
    return row;
  }

  private async hasFeature(
    actor: AuthenticatedUser,
    code: string,
  ): Promise<boolean> {
    if (ROLE_LEVEL[actor.role] >= ROLE_LEVEL.PRINCIPAL) return true;
    return (
      (await this.prisma.roleFeature.count({
        where: { role: actor.role, feature: { code, isActive: true } },
      })) > 0
    );
  }

  private async toPublicConversation(
    r: ConversationRow,
    actor: AuthenticatedUser,
  ): Promise<PublicConversation> {
    const me = r.participants.find((p) => p.userId === actor.id);
    const recent = await this.prisma.message.findMany({
      where: {
        conversationId: r.id,
        createdAt: me?.lastReadAt ? { gt: me.lastReadAt } : undefined,
      },
      select: { senderId: true, createdAt: true, deletedAt: true },
      take: 500,
    });
    const participants = r.participants.map((p) => ({
      ...toPerson(p.user),
      lastReadAt: p.lastReadAt,
    }));
    const last = r.messages[0];
    return {
      id: r.id,
      type: r.type.toLowerCase() as PublicConversation['type'],
      title: displayTitle({
        type: r.type,
        title: r.title,
        viewerId: actor.id,
        participants,
      }),
      classId: r.classId,
      participants,
      lastMessage: last
        ? {
            id: last.id,
            content: last.content.slice(0, 160),
            senderId: last.senderId,
            createdAt: last.createdAt,
          }
        : null,
      unreadCount: unreadCount(recent, actor.id, me?.lastReadAt ?? null),
      muted: me?.muted ?? false,
      lastMessageAt: r.lastMessageAt,
      createdAt: r.createdAt,
    };
  }

  private toPublicMessage(m: MessageRow): PublicMessage {
    return {
      id: m.id,
      conversationId: m.conversationId,
      sender: m.sender ? toPerson(m.sender) : null,
      content: m.deletedAt ? '' : m.content,
      replyTo: m.replyTo
        ? {
            id: m.replyTo.id,
            content: m.replyTo.deletedAt ? '' : m.replyTo.content.slice(0, 120),
            senderName: m.replyTo.sender
              ? `${m.replyTo.sender.firstName} ${m.replyTo.sender.lastName}`
              : null,
          }
        : null,
      files: m.deletedAt ? [] : m.files.map((f) => this.files.toPublic(f.file)),
      editedAt: m.editedAt,
      deletedAt: m.deletedAt,
      createdAt: m.createdAt,
    };
  }
}

function toPerson(u: {
  id: string;
  firstName: string;
  lastName: string;
  role: Role;
}): Person {
  return {
    id: u.id,
    firstName: u.firstName,
    lastName: u.lastName,
    role: u.role.toLowerCase(),
  };
}
