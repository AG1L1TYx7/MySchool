import { Injectable } from '@nestjs/common';
import QRCode from 'qrcode';
import { randomInt } from 'node:crypto';
import { CryptoService } from '../../infra/crypto/crypto.service';
import { PasswordService } from './password.service';
import { generateTotpSecret, matchTotpStep, otpauthUri } from './totp';

const ISSUER = 'SmartSchool';
/** Accept the previous and next 30-second step to absorb clock drift. */
const DRIFT_WINDOW_STEPS = 1;

@Injectable()
export class TwoFactorService {
  constructor(
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
  ) {}

  async createSetup(email: string): Promise<{
    encryptedSecret: string;
    otpauthUrl: string;
    qrDataUrl: string;
    manualKey: string;
  }> {
    const secret = generateTotpSecret();
    const otpauthUrl = otpauthUri(ISSUER, email, secret);
    const qrDataUrl = await QRCode.toDataURL(otpauthUrl, {
      margin: 1,
      width: 240,
    });
    return {
      encryptedSecret: this.crypto.encrypt(secret),
      otpauthUrl,
      qrDataUrl,
      manualKey: secret,
    };
  }

  /**
   * Returns the accepted time step, or null when the code is wrong or was already used.
   * `lastAcceptedStep` is the step stored after the previous successful code.
   */
  verifyCode(
    encryptedSecret: string,
    code: string,
    lastAcceptedStep: number | null,
  ): number | null {
    const step = matchTotpStep(
      this.crypto.decrypt(encryptedSecret),
      code,
      DRIFT_WINDOW_STEPS,
    );
    if (step === null) return null;
    if (lastAcceptedStep !== null && step <= lastAcceptedStep) return null;
    return step;
  }

  /** Ten single-use codes shown once; only argon2 hashes are stored. */
  async generateBackupCodes(): Promise<{ plain: string[]; hashes: string[] }> {
    const plain = Array.from(
      { length: 10 },
      () =>
        `${randomInt(0, 100_000).toString().padStart(5, '0')}-${randomInt(0, 100_000).toString().padStart(5, '0')}`,
    );
    const hashes = await Promise.all(plain.map((c) => this.passwords.hash(c)));
    return { plain, hashes };
  }

  /** Returns the remaining hashes when a backup code matches, null otherwise. */
  async consumeBackupCode(
    hashes: string[],
    code: string,
  ): Promise<string[] | null> {
    for (let i = 0; i < hashes.length; i++) {
      const result = await this.passwords.verify(hashes[i], code.trim());
      if (result.valid) return [...hashes.slice(0, i), ...hashes.slice(i + 1)];
    }
    return null;
  }
}
