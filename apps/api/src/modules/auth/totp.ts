import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * RFC 6238 time-based one-time passwords on node:crypto (HMAC-SHA1, 30-second steps,
 * six digits), compatible with Google Authenticator, Authy, 1Password and Microsoft Authenticator.
 * Kept in-house so the API has no ESM-only dependency chain to fight in Jest or the CJS build.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[=\s-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error('Invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A fresh 160-bit secret, base32 encoded for authenticator apps. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(
  secret: Buffer,
  counter: number,
  digits = TOTP_DIGITS,
): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(msg).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const code =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return (code % 10 ** digits).toString().padStart(digits, '0');
}

export function totpStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

export function totp(
  base32Secret: string,
  nowMs = Date.now(),
  digits = TOTP_DIGITS,
): string {
  return hotp(base32Decode(base32Secret), totpStep(nowMs), digits);
}

/**
 * Returns the time step the code matches within `window` steps either side of now, or null.
 * Callers persist the accepted step and refuse anything at or below it (replay protection).
 */
export function matchTotpStep(
  base32Secret: string,
  code: string,
  window = 1,
  nowMs = Date.now(),
): number | null {
  const token = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(token)) return null;
  const secret = base32Decode(base32Secret);
  const counter = totpStep(nowMs);
  const expected = Buffer.from(token);
  let matched: number | null = null;
  for (let i = -window; i <= window; i++) {
    const candidate = Buffer.from(hotp(secret, counter + i));
    if (
      candidate.length === expected.length &&
      timingSafeEqual(candidate, expected)
    )
      matched = counter + i;
  }
  return matched;
}

/** Verifies a code against the current step and `window` steps either side (drift tolerance). */
export function verifyTotp(
  base32Secret: string,
  code: string,
  window = 1,
  nowMs = Date.now(),
): boolean {
  return matchTotpStep(base32Secret, code, window, nowMs) !== null;
}

export function otpauthUri(
  issuer: string,
  account: string,
  base32Secret: string,
): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
