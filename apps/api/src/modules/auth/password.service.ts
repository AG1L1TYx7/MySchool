import { Injectable } from '@nestjs/common';
import argon2 from 'argon2';
import { pbkdf2Sync, timingSafeEqual } from 'node:crypto';

export type VerifyResult =
  { valid: false } | { valid: true; needsRehash: boolean };

/**
 * Password hashing (ADR-011). New hashes: argon2id. Imported ASP.NET Identity v3 hashes
 * (base64, first byte 0x01) are verified and upgraded on the next successful login.
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
