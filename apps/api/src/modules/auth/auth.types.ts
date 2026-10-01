import type { Role } from '../../generated/prisma/client';

/** What the JWT strategy attaches to req.user. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
  organizationId: string | null;
  sessionId: string;
  /** Privileged role without 2FA: only the auth routes are allowed until setup completes. */
  mfaSetupRequired: boolean;
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
