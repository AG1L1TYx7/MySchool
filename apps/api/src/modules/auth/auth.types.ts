import type { Role } from '@prisma/client';

/** What the JWT strategy attaches to req.user. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
  sessionId: string;
}

export interface AccessTokenClaims {
  sub: string;
  email: string;
  role: Role;
  org: string | null;
  sid: string;
  jti: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string;
}
