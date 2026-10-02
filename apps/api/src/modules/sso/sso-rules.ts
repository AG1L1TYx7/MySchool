import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

/** Pure rules for single sign-on: the signed state, PKCE, and who an identity may sign in as. */

export const PROVIDERS = [
  'google',
  'microsoft',
  'clever',
  'classlink',
] as const;
export type SsoProvider = (typeof PROVIDERS)[number];

export interface SsoState {
  provider: SsoProvider;
  nonce: string;
  verifier: string;
  redirectTo: string;
  exp: number;
}

const b64 = (s: string | Buffer) => Buffer.from(s).toString('base64url');

export function newPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function signState(state: SsoState, secret: string): string {
  const payload = b64(JSON.stringify(state));
  const sig = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

export function verifyState(
  token: string,
  secret: string,
  now = Date.now(),
): SsoState | null {
  const [payload, sig] = token.split('.');
  if (!payload || !sig || token.length > 2000) return null;
  const expected = createHmac('sha256', secret)
    .update(payload)
    .digest('base64url');
  if (
    expected.length !== sig.length ||
    !timingSafeEqual(Buffer.from(expected), Buffer.from(sig))
  )
    return null;
  try {
    const s = JSON.parse(
      Buffer.from(payload, 'base64url').toString(),
    ) as SsoState;
    if (
      !PROVIDERS.includes(s.provider) ||
      typeof s.nonce !== 'string' ||
      typeof s.verifier !== 'string' ||
      typeof s.exp !== 'number'
    )
      return null;
    if (s.exp * 1000 < now) return null;
    return s;
  } catch {
    return null;
  }
}

/** Only paths inside the web app are honoured as a post-login destination. */
export function safeRedirect(raw: string | undefined | null): string {
  if (
    !raw ||
    !raw.startsWith('/') ||
    raw.startsWith('//') ||
    raw.includes('\\')
  )
    return '/dashboard';
  return raw.length > 300 ? '/dashboard' : raw;
}

export interface SsoProfile {
  provider: SsoProvider;
  subject: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
}

export interface OrganizationSso {
  id: string;
  providers: SsoProvider[];
  allowedDomains: string[];
}

/** An email may sign in to an organisation when the provider is enabled there and the domain is allowed (or no domain list is set). */
export function emailAllowedFor(
  email: string,
  provider: SsoProvider,
  org: OrganizationSso,
): boolean {
  if (!org.providers.includes(provider)) return false;
  if (org.allowedDomains.length === 0) return true;
  const domain = email.split('@')[1]?.toLowerCase() ?? '';
  return org.allowedDomains.some((d) => d.toLowerCase() === domain);
}

export function parseList(raw: string | null | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}
