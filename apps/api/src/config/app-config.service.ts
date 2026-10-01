import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.schema';

/** Typed access to validated environment values. Prefer this over ConfigService.get with string keys. */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) {}

  get<K extends keyof Env>(key: K): Env[K] {
    return this.config.get(key, { infer: true });
  }

  get isProduction(): boolean {
    return this.get('NODE_ENV') === 'production';
  }

  get isDevelopment(): boolean {
    return this.get('NODE_ENV') === 'development';
  }

  /** Authentication policy with secure defaults in production (docs/11 section 3). */
  get auth() {
    const mfaRoles = this.get('AUTH_MFA_REQUIRED_ROLES');
    return {
      requireEmailVerification:
        this.get('AUTH_REQUIRE_EMAIL_VERIFICATION') ?? this.isProduction,
      mfaRequiredRoles: (mfaRoles === undefined
        ? this.isProduction
          ? 'super_admin,superintendent,principal'
          : ''
        : mfaRoles
      )
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      cookieSecure: this.get('AUTH_COOKIE_SECURE') ?? this.isProduction,
      sessionAbsoluteDays: this.get('AUTH_SESSION_ABSOLUTE_DAYS'),
      rememberMeAbsoluteDays: this.get('AUTH_REMEMBER_ME_ABSOLUTE_DAYS'),
      refreshSlidingDays: this.get('JWT_REFRESH_TTL_DAYS'),
      webAppUrl: this.get('WEB_APP_URL'),
    };
  }

  /** A provider is enabled when its credentials are present (see docs/04 section 8). */
  get providers() {
    return {
      smtp: !!this.get('SMTP_HOST'),
      sendgrid: !!this.get('SENDGRID_API_KEY'),
      twilio:
        !!this.get('TWILIO_ACCOUNT_SID') && !!this.get('TWILIO_AUTH_TOKEN'),
      firebase: !!this.get('FIREBASE_SERVICE_ACCOUNT_JSON'),
      stripe: !!this.get('STRIPE_SECRET_KEY'),
      recaptcha: !!this.get('RECAPTCHA_SECRET_KEY'),
      redis: !!this.get('REDIS_URL'),
    };
  }
}
