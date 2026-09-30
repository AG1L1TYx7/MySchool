import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  hotp,
  otpauthUri,
  totp,
  verifyTotp,
} from './totp';

// RFC 6238 appendix B reference secret ("12345678901234567890") and SHA1 vectors.
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_SECRET_B32 = base32Encode(RFC_SECRET);

describe('totp', () => {
  it('round-trips base32', () => {
    expect(base32Decode(RFC_SECRET_B32).equals(RFC_SECRET)).toBe(true);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(() => base32Decode('!!!')).toThrow();
  });

  it('matches the RFC 6238 SHA1 test vectors (last six digits)', () => {
    expect(hotp(RFC_SECRET, Math.floor(59 / 30), 8)).toBe('94287082');
    expect(hotp(RFC_SECRET, Math.floor(1111111109 / 30), 8)).toBe('07081804');
    expect(hotp(RFC_SECRET, Math.floor(1234567890 / 30), 8)).toBe('89005924');
    expect(totp(RFC_SECRET_B32, 59_000)).toBe('287082');
  });

  it('verifies within a one-step window and rejects outside it', () => {
    const now = 1_234_567_890_000;
    const code = totp(RFC_SECRET_B32, now);
    expect(verifyTotp(RFC_SECRET_B32, code, 1, now)).toBe(true);
    expect(verifyTotp(RFC_SECRET_B32, code, 1, now + 30_000)).toBe(true);
    expect(verifyTotp(RFC_SECRET_B32, code, 1, now + 90_000)).toBe(false);
    expect(verifyTotp(RFC_SECRET_B32, '12 34 56', 1, now)).toBe(
      code === '123456',
    );
    expect(verifyTotp(RFC_SECRET_B32, 'abcdef', 1, now)).toBe(false);
  });

  it('generates 32-character secrets and a standard otpauth URI', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const uri = otpauthUri('SmartSchool', 'jane@school.edu', secret);
    expect(uri).toBe(
      `otpauth://totp/SmartSchool%3Ajane%40school.edu?secret=${secret}&issuer=SmartSchool&algorithm=SHA1&digits=6&period=30`,
    );
  });
});
