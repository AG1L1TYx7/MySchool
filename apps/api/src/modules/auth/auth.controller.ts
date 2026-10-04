import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AppConfigService } from '../../config/app-config.service';
import { clientIp } from '../audit/audit.interceptor';
import { Audit } from '../audit/audit.decorator';
import {
  AuthService,
  type LoginResult,
  type RequestContext,
} from './auth.service';
import type { AuthenticatedUser, TokenPair } from './auth.types';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import {
  ChangePasswordDto,
  ForgotPasswordDto,
  LoginDto,
  LogoutDto,
  MfaChallengeDto,
  RefreshDto,
  RegisterDto,
  ResendVerificationDto,
  ResetPasswordDto,
  TwoFactorCodeDto,
  TwoFactorDisableDto,
  UpdateMeDto,
  VerifyEmailDto,
} from './dto/auth.dto';
import { cookieMaxAgeMs } from './session-rules';

// 5 per minute per IP (docs/01 section 9); the e2e suite raises it through the environment.
const LOGIN_LIMIT = {
  default: {
    limit: Number(process.env.LOGIN_RATE_LIMIT_PER_MINUTE ?? 5),
    ttl: 60_000,
  },
};
const RESET_LIMIT = { default: { limit: 3, ttl: 60_000 } };
// Sign-up forms are retried after validation errors; the captcha covers abuse in production.
const REGISTER_LIMIT = { default: { limit: 10, ttl: 60_000 } };

/** Browsers keep the refresh token in this HttpOnly cookie; native clients receive it in the body. */
export const REFRESH_COOKIE = 'ss_refresh';
const COOKIE_PATH = '/api/v1/auth';
const NATIVE_CLIENT_HEADER = 'x-smartschool-client';
const CSRF_HEADER = 'x-requested-with';

type ReqWithCookies = Request & {
  cookies?: Record<string, string | undefined>;
};

function ctxOf(req: Request): RequestContext {
  return { ip: clientIp(req), userAgent: req.headers['user-agent'] ?? null };
}

function cookieFrom(req: Request): string | undefined {
  const cookies = (req as { cookies?: unknown }).cookies as
    Record<string, string | undefined> | undefined;
  return cookies?.[REFRESH_COOKIE];
}

function isNativeClient(req: Request): boolean {
  return (req.headers[NATIVE_CLIENT_HEADER] ?? '') === 'native';
}

/** Auth and identity routes (docs/09 section 3, docs/11 section 3). */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(202)
  @Throttle(REGISTER_LIMIT)
  @ApiOperation({
    summary:
      'Register a student or parent account; a verification email is sent. Never reveals whether the email exists.',
  })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, ctxOf(req));
  }

  @Public()
  @Post('verify-email')
  @HttpCode(204)
  @Throttle(RESET_LIMIT)
  @ApiOperation({ summary: 'Confirm an email address with the emailed token' })
  async verifyEmail(
    @Body() dto: VerifyEmailDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.verifyEmail(dto.token, ctxOf(req));
  }

  @Public()
  @Post('resend-verification')
  @HttpCode(202)
  @Throttle(RESET_LIMIT)
  @ApiOperation({ summary: 'Send a new verification email (always 202)' })
  async resendVerification(
    @Body() dto: ResendVerificationDto,
    @Req() req: Request,
  ) {
    const result = await this.auth.resendVerification(
      dto.email,
      dto.captchaToken,
      ctxOf(req),
    );
    return {
      message:
        'If the address is registered and unverified, a new verification email has been sent.',
      ...(result.devToken ? { devToken: result.devToken } : {}),
    };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle(LOGIN_LIMIT)
  @ApiHeader({
    name: NATIVE_CLIENT_HEADER,
    required: false,
    description:
      "Set to 'native' to receive the refresh token in the body instead of a cookie",
  })
  @ApiOperation({
    summary:
      'Sign in; returns an access token (refresh token in an HttpOnly cookie), or an mfaToken when a second factor is required',
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(await this.auth.login(dto, ctxOf(req)), req, res);
  }

  @Public()
  @Post('2fa/challenge')
  @HttpCode(200)
  @Throttle(LOGIN_LIMIT)
  @ApiOperation({
    summary: 'Complete sign-in with an authenticator or backup code',
  })
  async mfaChallenge(
    @Body() dto: MfaChallengeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.respond(await this.auth.completeMfa(dto, ctxOf(req)), req, res);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiHeader({
    name: CSRF_HEADER,
    required: false,
    description:
      "Browsers must send 'SmartSchool' when refreshing with the cookie",
  })
  @ApiOperation({
    summary:
      'Rotate the refresh token (cookie or body) and get a new access token',
  })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: ReqWithCookies,
    @Res({ passthrough: true }) res: Response,
  ) {
    let token = dto?.refreshToken;
    if (!token) {
      token = cookieFrom(req);
      if (!token)
        throw new UnauthorizedException({
          code: 'auth.refresh_missing',
          detail: 'No refresh token was provided.',
        });
      // Defence in depth against CSRF: a custom header cannot be sent by a cross-site form post.
      if ((req.headers[CSRF_HEADER] ?? '') !== 'SmartSchool') {
        throw new ForbiddenException({
          code: 'auth.csrf',
          detail: 'Missing X-Requested-With header.',
        });
      }
    }
    const pair = await this.auth.refresh(token, ctxOf(req));
    return this.tokenBody(pair, req, res);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth('bearer')
  @Audit('auth.logout', 'AuthSession')
  @ApiOperation({
    summary: 'Revoke the current session and clear the refresh cookie',
  })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LogoutDto,
    @Req() req: ReqWithCookies,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(user, dto?.refreshToken ?? cookieFrom(req));
    res.clearCookie(REFRESH_COOKIE, { path: COOKIE_PATH });
  }

  @Get('me')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Current user with effective feature codes' })
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.me(user);
  }

  @Patch('me')
  @ApiBearerAuth('bearer')
  @Audit('auth.profile_updated', 'User')
  @ApiOperation({ summary: 'Update own profile' })
  updateMe(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpdateMeDto) {
    return this.auth.updateMe(user, dto);
  }

  @Post('change-password')
  @HttpCode(204)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Change password; other sessions are signed out' })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    await this.auth.changePassword(user, dto);
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @Throttle(RESET_LIMIT)
  @ApiOperation({
    summary: 'Request a password reset code by email (always 202)',
  })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    const result = await this.auth.forgotPassword(
      dto.email,
      dto.captchaToken,
      ctxOf(req),
    );
    return {
      message: 'If the email is registered, a reset code has been sent.',
      ...(result.devToken ? { devToken: result.devToken } : {}),
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(204)
  @Throttle(RESET_LIMIT)
  @ApiOperation({
    summary:
      'Reset the password with the emailed code (or an invitation code); all sessions are signed out',
  })
  async resetPassword(
    @Body() dto: ResetPasswordDto,
    @Req() req: Request,
  ): Promise<void> {
    await this.auth.resetPassword(dto, ctxOf(req));
  }

  @Post('2fa/setup')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Start two-factor setup; returns the otpauth URL and a QR code',
  })
  twoFactorSetup(@CurrentUser() user: AuthenticatedUser) {
    return this.auth.twoFactorSetup(user);
  }

  @Post('2fa/verify')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary:
      'Confirm the authenticator code; enables 2FA and returns backup codes once',
  })
  twoFactorVerify(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TwoFactorCodeDto,
  ) {
    return this.auth.twoFactorVerify(user, dto.code);
  }

  @Post('2fa/disable')
  @HttpCode(204)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary:
      'Disable two-factor with password and a code (not allowed for roles that require it)',
  })
  async twoFactorDisable(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TwoFactorDisableDto,
  ): Promise<void> {
    await this.auth.twoFactorDisable(user, dto.password, dto.code);
  }

  @Post('2fa/backup-codes')
  @HttpCode(200)
  @ApiBearerAuth('bearer')
  @ApiOperation({
    summary: 'Regenerate backup codes (invalidates the old ones)',
  })
  twoFactorBackupCodes(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: TwoFactorCodeDto,
  ) {
    return this.auth.twoFactorRegenerateBackupCodes(user, dto.code);
  }

  @Get('sessions')
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Active sessions for the current user' })
  async sessions(@CurrentUser() user: AuthenticatedUser) {
    return { data: await this.auth.sessions(user) };
  }

  @Delete('sessions/:id')
  @HttpCode(204)
  @ApiBearerAuth('bearer')
  @Audit('auth.session_revoked', 'AuthSession')
  @ApiOperation({ summary: 'Revoke one session' })
  async revokeSession(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.auth.revokeSession(user, id);
  }

  // ---------------------------------------------------------------------------

  private respond(result: LoginResult, req: Request, res: Response) {
    if (result.mfaRequired) return result;
    const { refreshToken, refreshExpiresAt, ...rest } = result;
    const body = this.tokenBody(
      {
        refreshToken,
        refreshExpiresAt,
        accessToken: rest.accessToken,
        expiresAt: rest.expiresAt,
      },
      req,
      res,
    );
    return { ...rest, ...body };
  }

  /** Sets the HttpOnly refresh cookie for browsers; native clients get the token in the body. */
  private tokenBody(
    pair: TokenPair,
    req: Request,
    res: Response,
  ): Omit<TokenPair, 'refreshToken'> & { refreshToken?: string } {
    if (isNativeClient(req)) return pair;
    res.cookie(REFRESH_COOKIE, pair.refreshToken, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.auth.cookieSecure,
      path: COOKIE_PATH,
      maxAge: cookieMaxAgeMs(new Date(pair.refreshExpiresAt)),
    });
    const { refreshToken: _omitted, ...rest } = pair;
    void _omitted;
    return rest;
  }
}
