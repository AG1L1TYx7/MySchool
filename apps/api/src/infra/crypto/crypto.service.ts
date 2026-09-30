import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from 'node:crypto';
import { AppConfigService } from '../../config/app-config.service';

/**
 * AES-256-GCM for secrets at rest (TOTP secrets). The key is ENCRYPTION_KEY when set,
 * otherwise derived from JWT_SECRET with HKDF so a single secret still gives a distinct key.
 * Ciphertext format: base64url(iv) . base64url(tag) . base64url(data)
 */
@Injectable()
export class CryptoService {
  private readonly key: Buffer;

  constructor(config: AppConfigService) {
    const explicit = config.get('ENCRYPTION_KEY');
    this.key = explicit
      ? Buffer.from(explicit, 'base64')
      : Buffer.from(
          hkdfSync(
            'sha256',
            config.get('JWT_SECRET'),
            'smartschool',
            'field-encryption',
            32,
          ),
        );
    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
    }
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return [iv, tag, data].map((b) => b.toString('base64url')).join('.');
  }

  decrypt(ciphertext: string): string {
    const [iv, tag, data] = ciphertext
      .split('.')
      .map((s) => Buffer.from(s, 'base64url'));
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  }
}
