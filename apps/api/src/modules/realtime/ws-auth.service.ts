import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { Socket } from 'socket.io';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/auth.types';
import { TokenService } from '../auth/token.service';

/**
 * Authenticates a socket handshake with the same access token and session checks as HTTP
 * (docs/04 section 3): `auth.token`, an `Authorization: Bearer` header, or `access_token` in the query.
 */
@Injectable()
export class WsAuthService {
  constructor(
    private readonly tokens: TokenService,
    private readonly prisma: PrismaService,
  ) {}

  async authenticate(client: Socket): Promise<AuthenticatedUser> {
    const token = extractToken(client);
    const claims = token ? this.tokens.verifyAccessToken(token) : null;
    if (!claims)
      throw new UnauthorizedException({
        code: 'auth.unauthorized',
        detail: 'A valid access token is required.',
      });
    const now = new Date();
    const session = await this.prisma.authSession.findFirst({
      where: {
        id: claims.sid,
        userId: claims.sub,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      select: {
        id: true,
        absoluteExpiresAt: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            organizationId: true,
            status: true,
            deletedAt: true,
            organization: { select: { tenantId: true } },
          },
        },
      },
    });
    if (
      !session ||
      session.user.deletedAt ||
      session.user.status !== 'ACTIVE' ||
      (session.absoluteExpiresAt && session.absoluteExpiresAt <= now)
    ) {
      throw new UnauthorizedException({
        code: 'auth.session_invalid',
        detail: 'Session is no longer valid.',
      });
    }
    return {
      id: session.user.id,
      email: session.user.email,
      role: session.user.role,
      organizationId: session.user.organizationId,
      sessionId: session.id,
      mfaSetupRequired: false,
      tenantId: session.user.organization?.tenantId ?? null,
    };
  }
}

export function extractToken(client: Socket): string | null {
  const auth = client.handshake.auth as { token?: unknown } | undefined;
  if (typeof auth?.token === 'string' && auth.token) return auth.token;
  const header = client.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer '))
    return header.slice(7);
  const query = client.handshake.query.access_token;
  return typeof query === 'string' && query ? query : null;
}

/** The user attached to an authenticated socket. */
export function socketUser(client: Socket): AuthenticatedUser | null {
  return (client.data as { user?: AuthenticatedUser }).user ?? null;
}
