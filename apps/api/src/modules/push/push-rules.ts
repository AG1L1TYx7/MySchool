/**
 * Push rules (docs/02 section 11): what gets pushed, to which devices, and how a Firebase message is shaped.
 * Pure; the service does the network.
 */

export const PLATFORMS = ['ios', 'android', 'web'] as const;
export type Platform = (typeof PLATFORMS)[number];

/** A device that has not checked in for this long is switched off; the app re-registers on its next start. */
export const STALE_DAYS = 90;

export interface PushPayload {
  title: string;
  body?: string | null;
  link?: string | null;
  category?: string | null;
  notificationId?: string | null;
}

export function isStaleDevice(lastSeenAt: Date, now = new Date()): boolean {
  return now.getTime() - lastSeenAt.getTime() > STALE_DAYS * 86_400_000;
}

/** Tokens are opaque; trim, and reject anything that is not plausibly a token. */
export function normalizeToken(token: string): string | null {
  const t = token.trim();
  if (t.length < 20 || t.length > 512 || /\s/.test(t)) return null;
  return t;
}

/** The push switch per category plus the in-app switch: nothing is pushed that the user turned off in app. */
export function shouldPush(
  pref: { inApp: boolean; push: boolean } | null,
  force = false,
): boolean {
  if (force) return true;
  if (!pref) return true;
  return pref.inApp && pref.push;
}

/** A Firebase Cloud Messaging v1 message: notification block for the tray, data block for the app's deep link. */
export function fcmMessage(
  token: string,
  payload: PushPayload,
  webAppUrl: string,
): Record<string, unknown> {
  const title = payload.title.slice(0, 200);
  const body = (payload.body ?? '').slice(0, 500);
  const link = payload.link
    ? payload.link.startsWith('http')
      ? payload.link
      : `${webAppUrl.replace(/\/$/, '')}${payload.link}`
    : null;
  const data: Record<string, string> = {};
  if (link) data.link = link;
  if (payload.category) data.category = payload.category;
  if (payload.notificationId) data.notificationId = payload.notificationId;
  return {
    token,
    notification: body ? { title, body } : { title },
    data,
    android: {
      priority: 'high',
      notification: { channel_id: payload.category ?? 'general' },
    },
    apns: { payload: { aps: { sound: 'default', 'mutable-content': 1 } } },
    webpush: link ? { fcm_options: { link } } : {},
  };
}

export interface ServiceAccount {
  projectId: string;
  clientEmail: string;
  privateKey: string;
}

/** Reads the Firebase service account JSON from the environment; null when absent or malformed. */
export function serviceAccountFrom(
  json: string | null | undefined,
): ServiceAccount | null {
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as {
      project_id?: string;
      client_email?: string;
      private_key?: string;
    };
    if (!parsed.project_id || !parsed.client_email || !parsed.private_key)
      return null;
    return {
      projectId: parsed.project_id,
      clientEmail: parsed.client_email,
      privateKey: parsed.private_key.replace(/\\n/g, '\n'),
    };
  } catch {
    return null;
  }
}

/** The claims of the one-hour JWT exchanged for a Google access token with the messaging scope. */
export function jwtClaims(
  account: ServiceAccount,
  nowSeconds: number,
): Record<string, string | number> {
  return {
    iss: account.clientEmail,
    scope: 'https://www.googleapis.com/auth/firebase.messaging',
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSeconds,
    exp: nowSeconds + 3600,
  };
}

/** Firebase error codes that mean the token is dead and the device should be switched off. */
export function isDeadTokenError(code: string | null | undefined): boolean {
  return (
    code === 'UNREGISTERED' ||
    code === 'INVALID_ARGUMENT' ||
    code === 'NOT_FOUND'
  );
}

export function base64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}
