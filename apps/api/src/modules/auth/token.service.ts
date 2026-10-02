import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Role } from '../../generated/prisma/client';
import { randomUUID } from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';
import type { AccessTokenClaims } from './auth.types';

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  accessTtlMinutes(rememberMe: boolean): number {
    return rememberMe
      ? this.config.get('JWT_REMEMBER_ME_TTL_DAYS') * 24 * 60
      : this.config.get('JWT_ACCESS_TTL_MINUTES');
  }

  signAccessToken(input: {
    userId: string;
    email: string;
    role: Role;
    organizationId: string | null;
    sessionId: string;
    rememberMe: boolean;
  }): {
    token: string;
    expiresAt: Date;
  } {
    const ttlMinutes = this.accessTtlMinutes(input.rememberMe);
    const expiresAt = new Date(Date.now() + ttlMinutes * 60_000);
    const claims: AccessTokenClaims = {
      sub: input.userId,
      email: input.email,
      role: input.role,
      org: input.organizationId,
      sid: input.sessionId,
      jti: randomUUID(),
    };
    const token = this.jwt.sign(claims, {
      secret: this.config.get('JWT_SECRET'),
      issuer: this.config.get('JWT_ISSUER'),
      audience: this.config.get('JWT_AUDIENCE'),
      expiresIn: `${ttlMinutes}m`,
      algorithm: 'HS256',
    });
    return { token, expiresAt };
  }

  /** Short-lived token that proves the password step passed and a second factor is pending. */
  signMfaToken(userId: string): string {
    return this.jwt.sign(
      { sub: userId, purpose: 'mfa' },
      {
        secret: this.config.get('JWT_SECRET'),
        issuer: this.config.get('JWT_ISSUER'),
        audience: 'mfa',
        expiresIn: '5m',
        algorithm: 'HS256',
      },
    );
  }

  /** Claims of a valid access token, or null; the caller still checks the session row. */
  verifyAccessToken(token: string): AccessTokenClaims | null {
    try {
      return this.jwt.verify<AccessTokenClaims>(token, {
        secret: this.config.get('JWT_SECRET'),
        issuer: this.config.get('JWT_ISSUER'),
        audience: this.config.get('JWT_AUDIENCE'),
        algorithms: ['HS256'],
      });
    } catch {
      return null;
    }
  }

  verifyMfaToken(token: string): string | null {
    try {
      const payload = this.jwt.verify<{ sub: string; purpose: string }>(token, {
        secret: this.config.get('JWT_SECRET'),
        issuer: this.config.get('JWT_ISSUER'),
        audience: 'mfa',
      });
      return payload.purpose === 'mfa' ? payload.sub : null;
    } catch {
      return null;
    }
  }
}
