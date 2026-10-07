import { Body, Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { clientIp } from '../audit/audit.interceptor';
import { REFRESH_COOKIE } from '../auth/auth.controller';
import { Public } from '../auth/decorators/public.decorator';
import { LtiError, LtiService } from './lti.service';

const STATE_COOKIE = 'ss_lti';
const REFRESH_PATH = '/api/v1/auth';

/**
 * The public LTI 1.3 endpoints: our key set, the tool configuration, the OIDC login initiation and the launch
 * (SmartSchool as a tool), and the authorization endpoint tools call back (SmartSchool as a platform).
 */
@ApiTags('LTI')
@Controller('lti')
export class LtiController {
  constructor(
    private readonly lti: LtiService,
    private readonly config: AppConfigService,
  ) {}

  @Get('jwks')
  @Public()
  @ApiOperation({
    summary: 'JSON Web Key Set that verifies id_tokens SmartSchool signs',
  })
  jwks() {
    return this.lti.jwks();
  }

  @Get('config.json')
  @Public()
  @ApiOperation({
    summary:
      'Tool configuration for registering SmartSchool in Canvas (?organizationId=)',
  })
  configuration(@Query('organizationId') organizationId: string) {
    return this.lti.configuration(organizationId ?? '');
  }

  @Get('login')
  @Public()
  @ApiOperation({ summary: 'OIDC login initiation (GET form)' })
  loginGet(
    @Query() q: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    return this.login(q, res);
  }

  @Post('login')
  @Public()
  @ApiOperation({ summary: 'OIDC login initiation (POST form)' })
  loginPost(
    @Body() body: Record<string, string | undefined>,
    @Query() q: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    return this.login({ ...q, ...body }, res);
  }

  private async login(
    params: Record<string, string | undefined>,
    res: Response,
  ) {
    try {
      const { redirectUrl, state } = await this.lti.loginInit(params);
      res.cookie(STATE_COOKIE, state, {
        httpOnly: true,
        sameSite: this.config.auth.cookieSecure ? 'none' : 'lax',
        secure: this.config.auth.cookieSecure,
        path: '/api/v1/lti',
        maxAge: 10 * 60_000,
      });
      res.redirect(302, redirectUrl);
    } catch (err) {
      res.redirect(
        this.webUrl(
          `/login?error=lti_${err instanceof LtiError ? err.code : 'failed'}`,
        ),
      );
    }
  }

  @Post('launch')
  @Public()
  @ApiOperation({
    summary:
      'LTI resource link launch: verifies the id_token, signs the person in and redirects into the app',
  })
  async launch(
    @Body() body: Record<string, string | undefined>,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const cookies: Record<string, string | undefined> =
      (req as Request & { cookies?: Record<string, string> }).cookies ?? {};
    try {
      const { result, next } = await this.lti.launch(
        body.id_token,
        body.state,
        cookies[STATE_COOKIE],
        { ip: clientIp(req), userAgent: req.headers['user-agent'] ?? null },
      );
      res.clearCookie(STATE_COOKIE, { path: '/api/v1/lti' });
      if (result.mfaRequired) {
        res.redirect(
          this.webUrl(
            `/login/2fa#sso=1&mfaToken=${encodeURIComponent(result.mfaToken)}`,
          ),
        );
        return;
      }
      // Inside an LMS the app runs in an iframe, so the cookie must travel cross-site; that needs https.
      res.cookie(REFRESH_COOKIE, result.refreshToken, {
        httpOnly: true,
        sameSite: this.config.auth.cookieSecure ? 'none' : 'lax',
        secure: this.config.auth.cookieSecure,
        path: REFRESH_PATH,
        maxAge: Math.max(
          0,
          new Date(result.refreshExpiresAt).getTime() - Date.now(),
        ),
      });
      res.redirect(
        this.webUrl(
          `/sso/complete?next=${encodeURIComponent(next)}${result.mfaSetupRequired ? '&mfaSetup=1' : ''}`,
        ),
      );
    } catch (err) {
      res.redirect(
        this.webUrl(
          `/login?error=lti_${err instanceof LtiError ? err.code : 'failed'}`,
        ),
      );
    }
  }

  @Get('platform/auth')
  @Public()
  @ApiOperation({
    summary: 'Authorization endpoint for tools SmartSchool launches (GET)',
  })
  platformAuthGet(
    @Query() q: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    return this.platformAuth(q, res);
  }

  @Post('platform/auth')
  @Public()
  @ApiOperation({
    summary: 'Authorization endpoint for tools SmartSchool launches (POST)',
  })
  platformAuthPost(
    @Body() body: Record<string, string | undefined>,
    @Query() q: Record<string, string | undefined>,
    @Res() res: Response,
  ) {
    return this.platformAuth({ ...q, ...body }, res);
  }

  private async platformAuth(
    params: Record<string, string | undefined>,
    res: Response,
  ) {
    try {
      const html = await this.lti.platformAuth(params);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.send(html);
    } catch (err) {
      res.status(400).setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.send(err instanceof LtiError ? err.message : 'The launch failed.');
    }
  }

  private webUrl(path: string): string {
    return `${this.config.get('WEB_APP_URL').replace(/\/$/, '')}${path}`;
  }
}
