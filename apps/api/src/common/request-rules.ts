/**
 * Pure rules for how the API treats the network edge (docs/21 findings F03, F04): what "trust proxy" means
 * for a configuration string, which request URLs must be masked before they are logged, and how a rate
 * limit bucket is keyed.
 */

/**
 * The value for Express's `trust proxy` from the TRUST_PROXY setting: a hop count ("1"), a boolean word,
 * or a list of addresses and ranges ("loopback, 10.0.0.0/8"). Empty means no proxy is trusted, so the
 * client address is the socket peer and X-Forwarded-For is ignored.
 */
export function parseTrustProxy(
  value: string | undefined,
): boolean | number | string {
  const v = (value ?? '').trim();
  if (!v || v === 'false' || v === '0') return false;
  if (v === 'true') return true;
  if (/^\d+$/.test(v)) return Number(v);
  return v;
}

/** Log redaction paths for pino: credentials in headers, bodies and the cookies the API sets. */
export const LOG_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers["x-api-key"]',
  'req.headers["x-service-token"]',
  'req.headers.cookie',
  'req.body.password',
  'req.body.newPassword',
  'req.body.currentPassword',
  'req.body.refreshToken',
  'req.body.mfaToken',
  'req.body.token',
  'req.body.code',
  'req.body.backupCode',
  'req.body.secret',
  'res.headers["set-cookie"]',
  'res.headers.location',
];

/**
 * URLs whose path or query carries a secret are masked before logging: calendar feed tokens live in the
 * path, SSO and LTI callbacks carry codes and tokens in the query, and the H5P play ticket is a signed token.
 */
export function maskLoggedUrl(url: string | undefined): string {
  if (!url) return '';
  const [path, query] = url.split('?', 2);
  let masked = path
    .replace(/(\/calendar\/ical\/)[^/]+/, '$1[token]')
    .replace(/(\/h5p\/play\/)[^/]+/, '$1[ticket]');
  if (query === undefined) return masked;
  if (
    /\/(auth\/sso|lti|auth\/(verify-email|reset-password|2fa))(\/|$)/.test(path)
  )
    return `${masked}?[redacted]`;
  masked += `?${query.replace(/([?&]?)(token|code|state|access_token|mfaToken|id_token)=[^&]*/gi, '$1$2=[redacted]')}`;
  return masked;
}

/**
 * The bucket a request counts against. Sign-in style routes also key on the account named in the body,
 * so one shared address (a school behind NAT, or every browser behind the web proxy) cannot lock out a
 * whole school with five wrong passwords, while one account still cannot be hammered from many addresses.
 */
export function throttleTracker(
  ip: string | undefined,
  path: string,
  body: unknown,
): string {
  const address = ip && ip.length > 0 ? ip : 'unknown';
  if (
    /\/auth\/(login|2fa\/challenge|forgot-password|resend-verification)$/.test(
      path,
    )
  ) {
    const email =
      typeof (body as { email?: unknown } | null)?.email === 'string'
        ? (body as { email: string }).email.trim().toLowerCase()
        : '';
    return email ? `${address}|${email}` : address;
  }
  return address;
}
