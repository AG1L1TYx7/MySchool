import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AppConfigService } from '../../../config/app-config.service';
import { PrismaService } from '../../../infra/prisma/prisma.service';
import { ROLE_API_NAME } from '../../access/roles';
import type { AccessTokenClaims, AuthenticatedUser } from '../auth.types';

/**
 * Validates the bearer token and confirms the session it names is still live, so that a
 * logout or an administrator's deactivation takes effect before the access token expires.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly config: AppConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        ExtractJwt.fromAuthHeaderAsBearerToken(),
        ExtractJwt.fromUrlQueryParameter('access_token'), // socket handshakes
      ]),
      secretOrKey: config.get('JWT_SECRET'),
      issuer: config.get('JWT_ISSUER'),
      audience: config.get('JWT_AUDIENCE'),
      algorithms: ['HS256'],
      ignoreExpiration: false,
    });
  }

  async validate(claims: AccessTokenClaims): Promise<AuthenticatedUser> {
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
            twoFactorEnabled: true,
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
      mfaSetupRequired:
        this.config.auth.mfaRequiredRoles.includes(
          ROLE_API_NAME[session.user.role],
        ) && !session.user.twoFactorEnabled,
    };
  }
}
