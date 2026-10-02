import type { SsoProfile, SsoProvider } from './sso-rules';

/**
 * Provider endpoints and profile readers. Base URLs can be overridden through the environment
 * (SSO_<PROVIDER>_BASE_URL) so tests run against a local stub; clients are configured per deployment.
 */
export interface ProviderEndpoints {
  authorize: string;
  token: string;
  userinfo: string;
  scope: string;
  /** Whether the provider accepts PKCE (all do; Clever ignores it harmlessly). */
  pkce: boolean;
}

export interface ProviderCredentials {
  clientId: string;
  clientSecret: string;
}

export function endpointsFor(
  provider: SsoProvider,
  env: NodeJS.ProcessEnv = process.env,
): ProviderEndpoints {
  const base = (key: string, fallback: string) =>
    (env[key] ?? fallback).replace(/\/$/, '');
  switch (provider) {
    case 'google': {
      const auth = base('SSO_GOOGLE_BASE_URL', 'https://accounts.google.com');
      const api = env.SSO_GOOGLE_BASE_URL
        ? auth
        : 'https://oauth2.googleapis.com';
      const info = env.SSO_GOOGLE_BASE_URL
        ? auth
        : 'https://openidconnect.googleapis.com';
      return {
        authorize: `${auth}/o/oauth2/v2/auth`,
        token: `${api}/token`,
        userinfo: `${info}/v1/userinfo`,
        scope: 'openid email profile',
        pkce: true,
      };
    }
    case 'microsoft': {
      const tenant = env.SSO_MICROSOFT_TENANT ?? 'common';
      const auth = base(
        'SSO_MICROSOFT_BASE_URL',
        `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`,
      );
      const info = env.SSO_MICROSOFT_BASE_URL
        ? auth
        : 'https://graph.microsoft.com/oidc';
      return {
        authorize: `${auth}/authorize`,
        token: `${auth}/token`,
        userinfo: `${info}/userinfo`,
        scope: 'openid email profile',
        pkce: true,
      };
    }
    case 'clever': {
      const auth = base('SSO_CLEVER_BASE_URL', 'https://clever.com');
      const api = env.SSO_CLEVER_BASE_URL ? auth : 'https://api.clever.com';
      return {
        authorize: `${auth}/oauth/authorize`,
        token: `${api}/oauth/tokens`,
        userinfo: `${api}/v3.0/me`,
        scope: 'read:user_id read:users',
        pkce: false,
      };
    }
    case 'classlink': {
      const auth = base(
        'SSO_CLASSLINK_BASE_URL',
        'https://launchpad.classlink.com',
      );
      const api = env.SSO_CLASSLINK_BASE_URL
        ? auth
        : 'https://nodeapi.classlink.com';
      return {
        authorize: `${auth}/oauth2/v2/auth`,
        token: `${auth}/oauth2/v2/token`,
        userinfo: `${api}/v2/my/info`,
        scope: 'profile oneroster',
        pkce: true,
      };
    }
  }
}

export function credentialsFor(
  provider: SsoProvider,
  env: NodeJS.ProcessEnv = process.env,
): ProviderCredentials | null {
  const key = provider.toUpperCase();
  const clientId = env[`SSO_${key}_CLIENT_ID`];
  const clientSecret = env[`SSO_${key}_CLIENT_SECRET`];
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Normalises each provider's user-info shape into one profile. */
export function profileFrom(
  provider: SsoProvider,
  info: Record<string, unknown>,
): SsoProfile | null {
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim()
      ? v.trim()
      : typeof v === 'number'
        ? String(v)
        : null;
  const email = (v: unknown) => str(v)?.toLowerCase() ?? null;
  switch (provider) {
    case 'google':
    case 'microsoft': {
      const subject = str(info.sub);
      if (!subject) return null;
      return {
        provider,
        subject,
        email: email(info.email) ?? email(info.preferred_username),
        firstName: str(info.given_name),
        lastName: str(info.family_name),
      };
    }
    case 'clever': {
      const data = (info.data ?? info) as Record<string, unknown>;
      const subject = str(data.id);
      if (!subject) return null;
      const name = (data.name ?? {}) as Record<string, unknown>;
      return {
        provider,
        subject,
        email: email(data.email),
        firstName: str(name.first),
        lastName: str(name.last),
      };
    }
    case 'classlink': {
      const subject =
        str(info.UserId) ?? str(info.userId) ?? str(info.SourcedId);
      if (!subject) return null;
      return {
        provider,
        subject,
        email: email(info.Email) ?? email(info.email),
        firstName: str(info.FirstName) ?? str(info.firstName),
        lastName: str(info.LastName) ?? str(info.lastName),
      };
    }
  }
}
