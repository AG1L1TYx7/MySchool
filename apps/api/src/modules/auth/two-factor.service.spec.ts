import { CryptoService } from '../../infra/crypto/crypto.service';
import type { AppConfigService } from '../../config/app-config.service';
import { PasswordService } from './password.service';
import { totp } from './totp';
import { TwoFactorService } from './two-factor.service';

const config = {
  get: (key: string) =>
    key === 'JWT_SECRET'
      ? 'unit-test-secret-that-is-at-least-32-chars-long'
      : undefined,
} as unknown as AppConfigService;

describe('TwoFactorService', () => {
  const svc = new TwoFactorService(
    new CryptoService(config),
    new PasswordService(),
  );

  it('creates a setup whose current code verifies and whose secret is encrypted', async () => {
    const setup = await svc.createSetup('jane@school.edu');
    expect(setup.otpauthUrl.startsWith('otpauth://totp/')).toBe(true);
    expect(setup.otpauthUrl).toContain('issuer=SmartSchool');
    expect(setup.qrDataUrl.startsWith('data:image/png;base64,')).toBe(true);
    expect(setup.encryptedSecret).not.toContain(setup.manualKey);
    const code = totp(setup.manualKey);
    expect(svc.verifyCode(setup.encryptedSecret, code)).toBe(true);
    expect(svc.verifyCode(setup.encryptedSecret, 'abc')).toBe(false);
  });

  it('issues ten backup codes and consumes each once', async () => {
    const { plain, hashes } = await svc.generateBackupCodes();
    expect(plain).toHaveLength(10);
    expect(new Set(plain).size).toBe(10);
    const remaining = await svc.consumeBackupCode(hashes, plain[3]);
    expect(remaining).toHaveLength(9);
    expect(await svc.consumeBackupCode(remaining ?? [], plain[3])).toBeNull();
    expect(await svc.consumeBackupCode(remaining ?? [], 'nope')).toBeNull();
  });
});
