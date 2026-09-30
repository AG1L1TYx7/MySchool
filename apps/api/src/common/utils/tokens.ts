import { createHash, randomBytes } from 'node:crypto';

/** Opaque, URL-safe random token (refresh tokens, reset tokens). Never stored in clear. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** SHA-256 hex digest used to store token lookups without keeping the token itself. */
export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}
