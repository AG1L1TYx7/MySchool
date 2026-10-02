import { Injectable, Logger } from '@nestjs/common';
import type { IdentityProvider, User } from '../../generated/prisma/client';
import { newId } from '../../common/utils/ids';
import { randomToken } from '../../common/utils/tokens';
import { AppConfigService } from '../../config/app-config.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import {
  AuthService,
  type LoginResult,
  type RequestContext,
} from '../auth/auth.service';
import { credentialsFor, endpointsFor, profileFrom } from './providers';
import {
  emailAllowedFor,
  newPkce,
  parseList,
  PROVIDERS,
  safeRedirect,
  signState,
  verifyState,
  type SsoProfile,
  type SsoProvider,
  type SsoState,
} from './sso-rules';

export class SsoError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

const STATE_TTL_SECONDS = 10 * 60;

/**
 * Single sign-on with Google, Microsoft, Clever and ClassLink (docs/13 section 2, ADR-025).
 * Identity comes from the provider; permission to sign in comes from the organisation's settings; the
 * session is issued by the same code path as a password sign-in.
 */
@Injectable()
export class SsoService {
  private readonly logger = new Logger(SsoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  /** Providers with credentials configured on this deployment. */
  configured(): Array<{ id: SsoProvider; label: string }> {
    const labels: Record<SsoProvider, string> = {
      google: 'Google',
      microsoft: 'Microsoft',
      clever: 'Clever',
      classlink: 'ClassLink',
    };
    return PROVIDERS.filter((p) => credentialsFor(p)).map((p) => ({
      id: p,
      label: labels[p],
    }));
  }

  redirectUri(provider: SsoProvider): string {
    return `${this.config.get('WEB_APP_URL').replace(/\/$/, '')}/api/v1/auth/sso/${provider}/callback`;
  }

  /** Builds the authorisation URL and the signed state the controller keeps in a short-lived cookie. */
  start(
    provider: SsoProvider,
    redirectTo: string | undefined,
  ): { url: string; stateToken: string } {
    const creds = credentialsFor(provider);
    if (!creds)
      throw new SsoError(
        'not_configured',
        `${provider} sign-in is not configured on this server.`,
      );
    const endpoints = endpointsFor(provider);
    const pkce = newPkce();
    const state: SsoState = {
      provider,
      nonce: randomToken(16),
      verifier: pkce.verifier,
      redirectTo: safeRedirect(redirectTo),
      exp: Math.floor(Date.now() / 1000) + STATE_TTL_SECONDS,
    };
    const url = new URL(endpoints.authorize);
    url.searchParams.set('client_id', creds.clientId);
    url.searchParams.set('redirect_uri', this.redirectUri(provider));
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', endpoints.scope);
    url.searchParams.set('state', state.nonce);
    if (endpoints.pkce) {
      url.searchParams.set('code_challenge', pkce.challenge);
      url.searchParams.set('code_challenge_method', 'S256');
    }
    if (provider === 'google') url.searchParams.set('prompt', 'select_account');
    return {
      url: url.toString(),
      stateToken: signState(state, this.config.get('JWT_SECRET')),
    };
  }

  /** Exchanges the code, reads the profile, finds the person, and signs them in. */
  async callback(
    provider: SsoProvider,
    code: string | undefined,
    nonce: string | undefined,
    stateToken: string | undefined,
    ctx: RequestContext,
  ): Promise<{ result: LoginResult; redirectTo: string }> {
    const state = stateToken
      ? verifyState(stateToken, this.config.get('JWT_SECRET'))
      : null;
    if (
      !state ||
      state.provider !== provider ||
      !nonce ||
      state.nonce !== nonce
    )
      throw new SsoError(
        'state',
        'The sign-in request expired or did not match. Try again.',
      );
    if (!code)
      throw new SsoError(
        'denied',
        'The sign-in was cancelled or refused by the provider.',
      );
    const profile = await this.fetchProfile(provider, code, state.verifier);
    const user = await this.resolveUser(profile);
    const result = await this.auth.loginWithIdentity(user, provider, ctx);
    return { result, redirectTo: state.redirectTo };
  }

  private async fetchProfile(
    provider: SsoProvider,
    code: string,
    verifier: string,
  ): Promise<SsoProfile> {
    const creds = credentialsFor(provider);
    if (!creds)
      throw new SsoError(
        'not_configured',
        `${provider} sign-in is not configured on this server.`,
      );
    const endpoints = endpointsFor(provider);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.redirectUri(provider),
    });
    const headers: Record<string, string> = {
      'content-type': 'application/x-www-form-urlencoded',
      accept: 'application/json',
    };
    if (provider === 'clever')
      headers.authorization = `Basic ${Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString('base64')}`;
    else {
      body.set('client_id', creds.clientId);
      body.set('client_secret', creds.clientSecret);
    }
    if (endpoints.pkce) body.set('code_verifier', verifier);
    let token: { access_token?: string };
    try {
      const res = await fetch(endpoints.token, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`token endpoint ${res.status}`);
      token = (await res.json()) as { access_token?: string };
    } catch (err) {
      this.logger.warn(
        `${provider} token exchange failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new SsoError(
        'provider',
        'The sign-in provider did not accept the request. Try again.',
      );
    }
    if (!token.access_token)
      throw new SsoError('provider', 'The sign-in provider returned no token.');
    let info: Record<string, unknown>;
    try {
      const res = await fetch(endpoints.userinfo, {
        headers: {
          authorization: `Bearer ${token.access_token}`,
          accept: 'application/json',
        },
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`userinfo ${res.status}`);
      info = (await res.json()) as Record<string, unknown>;
    } catch (err) {
      this.logger.warn(
        `${provider} profile read failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new SsoError(
        'provider',
        'Could not read your profile from the sign-in provider.',
      );
    }
    const profile = profileFrom(provider, info);
    if (!profile)
      throw new SsoError(
        'provider',
        'The sign-in provider returned an incomplete profile.',
      );
    return profile;
  }

  /** Identity first; otherwise a rostered account whose school accepts this provider for that email domain. */
  private async resolveUser(profile: SsoProfile): Promise<User> {
    const providerEnum = profile.provider.toUpperCase() as IdentityProvider;
    const identity = await this.prisma.userIdentity.findUnique({
      where: {
        provider_subject: { provider: providerEnum, subject: profile.subject },
      },
      include: { user: true },
    });
    if (identity) {
      if (identity.user.deletedAt || identity.user.status !== 'ACTIVE')
        throw new SsoError(
          'disabled',
          'This account is not active. Ask your school office.',
        );
      return identity.user;
    }
    if (!profile.email)
      throw new SsoError(
        'no_email',
        'The sign-in provider did not share an email address, so the account cannot be matched.',
      );
    const user = await this.prisma.user.findFirst({
      where: { email: profile.email, deletedAt: null },
      include: {
        organization: {
          select: {
            id: true,
            isActive: true,
            ssoProviders: true,
            ssoAllowedDomains: true,
          },
        },
      },
    });
    if (!user)
      throw new SsoError(
        'unknown',
        `No SmartSchool account for ${profile.email}. Ask your school to add you, then try again.`,
      );
    if (user.status !== 'ACTIVE')
      throw new SsoError(
        'disabled',
        'This account is not active. Ask your school office.',
      );
    if (user.organization) {
      const allowed =
        user.organization.isActive &&
        emailAllowedFor(profile.email, profile.provider, {
          id: user.organization.id,
          providers: parseList(user.organization.ssoProviders) as SsoProvider[],
          allowedDomains: parseList(user.organization.ssoAllowedDomains),
        });
      if (!allowed)
        throw new SsoError(
          'not_allowed',
          `Your school has not enabled ${profile.provider} sign-in for ${profile.email}.`,
        );
    }
    await this.prisma.userIdentity.create({
      data: {
        id: newId(),
        userId: user.id,
        provider: providerEnum,
        subject: profile.subject,
        email: profile.email,
      },
    });
    await this.audit.record({
      userId: user.id,
      organizationId: user.organizationId,
      action: 'auth.identity.linked',
      entityType: 'User',
      entityId: user.id,
      details: { provider: profile.provider },
    });
    return user;
  }
}
