import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { Namespace, Socket } from 'socket.io';
import { socketUser, WsAuthService } from '../realtime/ws-auth.service';
import type { PublicNotification } from './notifications.service';

/**
 * `/hubs/notifications` (docs/04 section 3.1). Each authenticated socket joins `user:<id>`; the API
 * pushes `NewNotification` there. The path sits under /api so the web client's same-origin proxy carries it.
 */
@WebSocketGateway({
  namespace: '/hubs/notifications',
  path: '/api/socket.io',
  addTrailingSlash: false,
  cors: { origin: true, credentials: true },
})
export class NotificationsGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer() server!: Namespace;
  private readonly logger = new Logger(NotificationsGateway.name);

  constructor(private readonly wsAuth: WsAuthService) {}

  async handleConnection(client: Socket): Promise<void> {
    try {
      const user = await this.wsAuth.authenticate(client);
      (client.data as { user: unknown }).user = user;
      await client.join(`user:${user.id}`);
      client.emit('Connected', {
        userId: user.id,
        timestamp: new Date().toISOString(),
      });
    } catch {
      client.emit('Error', {
        code: 'auth.unauthorized',
        message: 'A valid access token is required.',
      });
      client.disconnect(true);
    }
  }

  handleDisconnect(): void {
    /* rooms are cleaned up by socket.io */
  }

  @SubscribeMessage('JoinOrganizationGroup')
  async joinOrganization(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { organizationId?: string },
  ): Promise<{ ok: boolean }> {
    const user = socketUser(client);
    if (
      !user ||
      !body?.organizationId ||
      (user.organizationId !== body.organizationId &&
        user.role !== 'SUPER_ADMIN' &&
        user.role !== 'SUPERINTENDENT')
    )
      return { ok: false };
    await client.join(`organization:${body.organizationId}`);
    return { ok: true };
  }

  @SubscribeMessage('LeaveOrganizationGroup')
  async leaveOrganization(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { organizationId?: string },
  ): Promise<{ ok: boolean }> {
    if (body?.organizationId)
      await client.leave(`organization:${body.organizationId}`);
    return { ok: true };
  }

  /** Delivers to each recipient's sockets (every tab they have open). */
  push(
    recipientIds: string[],
    notification: Omit<PublicNotification, 'id'> & { id: string },
  ): void {
    if (!this.server) return;
    for (const id of recipientIds)
      this.server.to(`user:${id}`).emit('NewNotification', notification);
  }

  /** Lets open tabs refresh their unread badge after a read-all or similar. */
  summaryChanged(userId: string): void {
    this.server
      ?.to(`user:${userId}`)
      .emit('SummaryChanged', { userId, timestamp: new Date().toISOString() });
  }
}
