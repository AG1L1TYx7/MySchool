import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';

interface SiteVerifyResponse {
  success: boolean;
  score?: number;
  action?: string;
  'error-codes'?: string[];
}

/**
 * reCAPTCHA v3 verification for public forms (register, forgot-password). When no secret
 * is configured the check is skipped, so development works without Google credentials.
 */
@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);

  constructor(
    private readonly config: AppConfigService,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  get enabled(): boolean {
    return this.config.providers.recaptcha;
  }

  /** Throws a 400 problem when the token is missing, invalid, or scores below the threshold. */
  async assertHuman(
    token: string | undefined,
    remoteIp: string | null,
    action: string,
  ): Promise<void> {
    if (!this.enabled) return;
    if (!token)
      throw new BadRequestException({
        code: 'auth.captcha_required',
        detail: 'Complete the human check and try again.',
      });
    let result: SiteVerifyResponse;
    try {
      const body = new URLSearchParams({
        secret: this.config.get('RECAPTCHA_SECRET_KEY'),
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      });
      const res = await this.fetchImpl(
        'https://www.google.com/recaptcha/api/siteverify',
        { method: 'POST', body, signal: AbortSignal.timeout(5000) },
      );
      result = (await res.json()) as SiteVerifyResponse;
    } catch (err) {
      this.logger.error(
        `reCAPTCHA verification failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new BadRequestException({
        code: 'auth.captcha_unavailable',
        detail: 'The human check could not be completed. Try again shortly.',
      });
    }
    const minScore = this.config.get('RECAPTCHA_MIN_SCORE');
    if (
      !result.success ||
      (result.action && result.action !== action) ||
      (typeof result.score === 'number' && result.score < minScore)
    ) {
      throw new BadRequestException({
        code: 'auth.captcha_failed',
        detail: 'The human check failed. Try again.',
      });
    }
  }
}
