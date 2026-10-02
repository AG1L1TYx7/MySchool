import { forwardRef, Inject, Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { socketUser, WsAuthService } from '../realtime/ws-auth.service';
import {
  MessagingService,
  type PublicConversation,
  type PublicMessage,
} from './messaging.service';

/**
 * `/hubs/messaging` (docs/04 section 3.2). Sockets join `user:<id>` on connect and `conversation:<id>`
 * on request (after a participant check). Writes go through the service so REST and sockets stay identical.
 */
@WebSocketGateway({
  namespace: '/hubs/messaging',
  path: '/api/socket.io',
  addTrailingSlash: false,
  cors: { origin: true, credentials: true },
})
export class MessagingGateway implements OnGatewayConnection {
  @WebSocketServer() server!: Namespace;
  private readonly logger = new Logger(MessagingGateway.name);
  private readonly online = new Map<string, number>();

  constructor(
    private readonly wsAuth: WsAuthService,
    @Inject(forwardRef(() => MessagingService))
    private readonly messaging: MessagingService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const user = await this.wsAuth.authenticate(client);
      (client.data as { user: unknown }).user = user;
      await client.join(`user:${user.id}`);
      this.online.set(user.id, (this.online.get(user.id) ?? 0) + 1);
      client.emit('Connected', {
        userId: user.id,
        timestamp: new Date().toISOString(),
      });
      client.on('disconnect', () => {
        const left = (this.online.get(user.id) ?? 1) - 1;
        if (left <= 0) this.online.delete(user.id);
        else this.online.set(user.id, left);
      });
    } catch {
      client.emit('Error', {
        code: 'auth.unauthorized',
        message: 'A valid access token is required.',
      });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('JoinConversation')
  async join(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    const user = socketUser(client);
    if (
      !user ||
      !body?.conversationId ||
      !(await this.messaging.isParticipant(body.conversationId, user.id))
    )
      return { ok: false };
    await client.join(`conversation:${body.conversationId}`);
    return { ok: true };
  }

  @SubscribeMessage('LeaveConversation')
  async leave(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    if (body?.conversationId)
      await client.leave(`conversation:${body.conversationId}`);
    return { ok: true };
  }

  @SubscribeMessage('SendMessage')
  async sendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody()
    body: {
      conversationId?: string;
      content?: string;
      replyToMessageId?: string;
    },
  ): Promise<{ ok: boolean; message?: PublicMessage; error?: string }> {
    const user = socketUser(client);
    if (!user || !body?.conversationId || !body.content)
      return { ok: false, error: 'conversationId and content are required.' };
    try {
      const message = await this.messaging.send(
        body.conversationId,
        { content: body.content, replyToMessageId: body.replyToMessageId },
        user,
      );
      return { ok: true, message };
    } catch (err) {
      const detail =
        (err as { response?: { detail?: string }; message?: string }).response
          ?.detail ?? (err as Error).message;
      client.emit('MessageError', { error: detail });
      return { ok: false, error: detail };
    }
  }

  @SubscribeMessage('Typing')
  typing(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ): void {
    const user = socketUser(client);
    if (user && body?.conversationId)
      client.to(`conversation:${body.conversationId}`).emit('UserTyping', {
        userId: user.id,
        conversationId: body.conversationId,
      });
  }

  @SubscribeMessage('StopTyping')
  stopTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ): void {
    const user = socketUser(client);
    if (user && body?.conversationId)
      client
        .to(`conversation:${body.conversationId}`)
        .emit('UserStoppedTyping', {
          userId: user.id,
          conversationId: body.conversationId,
        });
  }

  @SubscribeMessage('MarkConversationAsRead')
  async markRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: string },
  ): Promise<{ ok: boolean }> {
    const user = socketUser(client);
    if (!user || !body?.conversationId) return { ok: false };
    try {
      await this.messaging.markRead(body.conversationId, user);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }

  @SubscribeMessage('GetOnlineUsers')
  onlineUsers(): { userIds: string[] } {
    return { userIds: [...this.online.keys()] };
  }

  // ---------------------------------------------------------------------------
  // Server -> client
  // ---------------------------------------------------------------------------

  /** A new message: to the open conversation room and to every participant's own room (list updates). */
  messageEvent(
    conversationId: string,
    participantIds: string[],
    event: string,
    payload: unknown,
  ): void {
    if (!this.server) return;
    this.server.to(`conversation:${conversationId}`).emit(event, payload);
    for (const id of participantIds)
      this.server.to(`user:${id}`).emit(`${event}:list`, payload);
  }

  toConversation(
    conversationId: string,
    event: string,
    payload: unknown,
  ): void {
    this.server?.to(`conversation:${conversationId}`).emit(event, payload);
  }

  toUsers(userIds: string[], event: string, payload: unknown): void {
    if (!this.server) return;
    for (const id of userIds) this.server.to(`user:${id}`).emit(event, payload);
  }

  conversationCreated(
    userIds: string[],
    conversation: PublicConversation,
  ): void {
    this.toUsers(userIds, 'AddedToConversation', {
      conversationId: conversation.id,
      type: conversation.type,
      title: conversation.title,
    });
  }
}
