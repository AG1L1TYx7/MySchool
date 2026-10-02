import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { clientIp } from '../audit/audit.interceptor';
import { REFRESH_COOKIE } from '../auth/auth.controller';
import { Public } from '../auth/decorators/public.decorator';
import { PROVIDERS, type SsoProvider } from './sso-rules';
import { SsoError, SsoService } from './sso.service';

const STATE_COOKIE = 'ss_sso';
const STATE_PATH = '/api/v1/auth/sso';
const REFRESH_PATH = '/api/v1/auth';

/**
 * Browser-facing sign-in flow: /auth/sso/{provider}/start redirects to the provider; the provider
 * returns to /auth/sso/{provider}/callback, which sets the refresh cookie and sends the browser to the
 * web app. Both routes are reached through the web app's proxy, so cookies belong to the web origin.
 */
@ApiTags('Auth')
@Public()
@Controller('auth/sso')
export class SsoController {
  constructor(
    private readonly sso: SsoService,
    private readonly config: AppConfigService,
  ) {}

  @Get('providers')
  @ApiOperation({ summary: 'Sign-in providers configured on this server' })
  providers() {
    return { data: this.sso.configured() };
  }

  @Get(':provider/start')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Begin sign-in with a provider (redirects)' })
  start(
    @Param('provider') providerParam: string,
    @Query('redirect') redirect: string | undefined,
    @Res() res: Response,
  ): void {
    const provider = this.parse(providerParam);
    if (!provider) {
      res.redirect(this.webUrl('/login?error=sso_unknown_provider'));
      return;
    }
    try {
      const { url, stateToken } = this.sso.start(provider, redirect);
      res.cookie(STATE_COOKIE, stateToken, {
        httpOnly: true,
        sameSite: 'lax',
        secure: this.config.auth.cookieSecure,
        path: STATE_PATH,
        maxAge: 10 * 60_000,
      });
      res.redirect(url);
    } catch (err) {
      res.redirect(
        this.webUrl(
          `/login?error=sso_${err instanceof SsoError ? err.code : 'failed'}`,
        ),
      );
    }
  }

  @Get(':provider/callback')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({
    summary:
      'Provider return URL; sets the session cookie and redirects into the app',
  })
  async callback(
    @Param('provider') providerParam: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const provider = this.parse(providerParam);
    const cookies =
      (req as { cookies?: Record<string, string | undefined> }).cookies ?? {};
    res.clearCookie(STATE_COOKIE, { path: STATE_PATH });
    if (!provider) {
      res.redirect(this.webUrl('/login?error=sso_unknown_provider'));
      return;
    }
    try {
      const { result, redirectTo } = await this.sso.callback(
        provider,
        code,
        state,
        cookies[STATE_COOKIE],
        { ip: clientIp(req), userAgent: req.headers['user-agent'] ?? null },
      );
      if (result.mfaRequired) {
        res.redirect(
          this.webUrl(
            `/login/2fa#sso=1&mfaToken=${encodeURIComponent(result.mfaToken)}`,
          ),
        );
        return;
      }
      res.cookie(REFRESH_COOKIE, result.refreshToken, {
        httpOnly: true,
        sameSite: 'strict',
        secure: this.config.auth.cookieSecure,
        path: REFRESH_PATH,
        maxAge: Math.max(
          0,
          new Date(result.refreshExpiresAt).getTime() - Date.now(),
        ),
      });
      res.redirect(
        this.webUrl(
          `/sso/complete?next=${encodeURIComponent(redirectTo)}${result.mfaSetupRequired ? '&mfaSetup=1' : ''}`,
        ),
      );
    } catch (err) {
      const code = err instanceof SsoError ? err.code : 'failed';
      res.redirect(this.webUrl(`/login?error=sso_${code}`));
    }
  }

  private parse(raw: string): SsoProvider | null {
    const p = raw.toLowerCase();
    return (PROVIDERS as readonly string[]).includes(p)
      ? (p as SsoProvider)
      : null;
  }

  private webUrl(path: string): string {
    return `${this.config.get('WEB_APP_URL').replace(/\/$/, '')}${path}`;
  }
}
