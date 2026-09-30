import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { PasswordService, verifyAspNetIdentityV3 } from './password.service';

/** Builds an ASP.NET Identity V3 hash the way PasswordHasher<TUser> does, for the test only. */
function aspNetHash(password: string, iterations = 10_000): string {
  const salt = randomBytes(16);
  const subkey = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const header = Buffer.alloc(13);
  header[0] = 0x01;
  header.writeUInt32BE(1, 1); // HMACSHA256
  header.writeUInt32BE(iterations, 5);
  header.writeUInt32BE(salt.length, 9);
  return Buffer.concat([header, salt, subkey]).toString('base64');
}

describe('PasswordService', () => {
  const svc = new PasswordService();

  it('hashes with argon2id and verifies without rehash', async () => {
    const hash = await svc.hash('Correct-Horse-Battery-1!');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await svc.verify(hash, 'Correct-Horse-Battery-1!')).toEqual({
      valid: true,
      needsRehash: false,
    });
    expect(await svc.verify(hash, 'wrong')).toEqual({ valid: false });
  });

  it('verifies imported ASP.NET Identity v3 hashes and flags them for rehash', async () => {
    const legacy = aspNetHash('Teacher@123456');
    expect(await svc.verify(legacy, 'Teacher@123456')).toEqual({
      valid: true,
      needsRehash: true,
    });
    expect(await svc.verify(legacy, 'Teacher@123457')).toEqual({
      valid: false,
    });
  });

  it('rejects malformed legacy hashes safely', () => {
    expect(verifyAspNetIdentityV3('not base64!!', 'x')).toBe(false);
    expect(
      verifyAspNetIdentityV3(
        Buffer.from([0x00, 1, 2, 3]).toString('base64'),
        'x',
      ),
    ).toBe(false);
  });

  it('enforces the 12-character mixed policy', () => {
    expect(svc.meetsPolicy('Short1!')).toBe(false);
    expect(svc.meetsPolicy('alllowercase12345!')).toBe(false);
    expect(svc.meetsPolicy('Valid-Password-123')).toBe(true);
  });
});
