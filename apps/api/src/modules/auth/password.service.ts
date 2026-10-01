import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';
import { COMMON_PASSWORD_BASES } from './common-passwords';

export type VerifyResult =
  { valid: false } | { valid: true; needsRehash: boolean };

export interface PasswordContext {
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}

/**
 * Password hashing and policy (ADR-011, docs/11 section 3). New hashes: argon2id.
 * Imported ASP.NET Identity v3 hashes (base64, first byte 0x01) are verified and
 * upgraded on the next successful login.
 */
@Injectable()
export class PasswordService {
  static readonly POLICY =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\da-zA-Z]).{12,128}$/;

  hash(password: string): Promise<string> {
    return argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
  }

  async verify(hash: string, password: string): Promise<VerifyResult> {
    if (hash.startsWith('$argon2')) {
      const ok = await argon2.verify(hash, password).catch(() => false);
      return ok ? { valid: true, needsRehash: false } : { valid: false };
    }
    return verifyAspNetIdentityV3(hash, password)
      ? { valid: true, needsRehash: true }
      : { valid: false };
  }

  meetsPolicy(password: string): boolean {
    return PasswordService.POLICY.test(password);
  }

  /**
   * Returns null when the password is acceptable, otherwise a message for the user.
   * Checks: character-class policy, common-password denylist, personal information.
   */
  validateNewPassword(
    password: string,
    context: PasswordContext = {},
  ): string | null {
    if (!this.meetsPolicy(password)) {
      return 'Password must be 12 to 128 characters with upper and lower case letters, a digit and a symbol.';
    }
    if (isCommonPassword(password))
      return 'That password is too common. Choose something harder to guess.';
    const personal = personalTokens(context).find((t) =>
      password.toLowerCase().includes(t),
    );
    if (personal)
      return 'Password must not contain your name or email address.';
    if (/(.)\1{3,}/.test(password))
      return 'Password must not repeat the same character four or more times in a row.';
    return null;
  }
}

/** "Password2026!" -> "password"; "P@ssw0rd!!2026" -> "password"; "Welcome-123456" -> "welcome". */
export function isCommonPassword(password: string): boolean {
  const symbolLeet = password
    .toLowerCase()
    .replace(/@/g, 'a')
    .replace(/\$/g, 's');
  const alnum = symbolLeet.replace(/[^a-z0-9]/g, '');
  const bases = new Set<string>([
    alnum,
    alnum.replace(/\d+$/, ''),
    alnum.replace(/^\d+/, ''),
    alnum.replace(/^\d+|\d+$/g, ''),
  ]);
  for (const base of bases) {
    if (!base) continue;
    if (COMMON_PASSWORD_BASES.has(base)) return true;
    const leet = base
      .replace(/0/g, 'o')
      .replace(/1/g, 'l')
      .replace(/3/g, 'e')
      .replace(/4/g, 'a')
      .replace(/5/g, 's')
      .replace(/7/g, 't');
    if (COMMON_PASSWORD_BASES.has(leet)) return true;
  }
  return false;
}
function personalTokens(context: PasswordContext): string[] {
  const tokens: string[] = [];
  const local = context.email?.split('@')[0]?.toLowerCase() ?? '';
  if (local.length >= 4) tokens.push(local);
  for (const part of local.split(/[._\-+]/))
    if (part.length >= 4) tokens.push(part);
  for (const name of [context.firstName, context.lastName]) {
    const n = name?.trim().toLowerCase() ?? '';
    if (n.length >= 3) tokens.push(n);
  }
  return tokens;
}

/**
 * ASP.NET Core Identity PasswordHasher V3 layout (base64):
 * 0x01 | prf (4 bytes BE) | iterations (4 bytes BE) | salt length (4 bytes BE) | salt | subkey
 * prf: 0 = HMACSHA1, 1 = HMACSHA256, 2 = HMACSHA512.
 */
export function verifyAspNetIdentityV3(
  encoded: string,
  password: string,
): boolean {
  let buf: Buffer;
  try {
    buf = Buffer.from(encoded, 'base64');
  } catch {
    return false;
  }
  if (buf.length < 13 || buf[0] !== 0x01) return false;
  const prf = buf.readUInt32BE(1);
  const iterations = buf.readUInt32BE(5);
  const saltLength = buf.readUInt32BE(9);
  if (saltLength < 8 || buf.length < 13 + saltLength + 16) return false;
  const salt = buf.subarray(13, 13 + saltLength);
  const expected = buf.subarray(13 + saltLength);
  const digest =
    prf === 0 ? 'sha1' : prf === 1 ? 'sha256' : prf === 2 ? 'sha512' : null;
  if (!digest) return false;
  const actual = pbkdf2Sync(
    password,
    salt,
    iterations,
    expected.length,
    digest,
  );
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
