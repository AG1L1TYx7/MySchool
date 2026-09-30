import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { clientIp } from '../audit/audit.interceptor';
import { Audit } from '../audit/audit.decorator';
import { AuthService, type RequestContext } from './auth.service';
import type { AuthenticatedUser } from './auth.types';
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
  ResetPasswordDto,
  TwoFactorCodeDto,
  TwoFactorDisableDto,
  UpdateMeDto,
} from './dto/auth.dto';

const LOGIN_LIMIT = { default: { limit: 5, ttl: 60_000 } }; // 5 per minute per IP (docs/01 section 9)
const RESET_LIMIT = { default: { limit: 3, ttl: 60_000 } };

function ctxOf(req: Request): RequestContext {
  return { ip: clientIp(req), userAgent: req.headers['user-agent'] ?? null };
}

/** Auth and identity routes (docs/09 section 3). */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(201)
  @Throttle(LOGIN_LIMIT)
  @ApiOperation({ summary: 'Register a student, parent or teacher account' })
  register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, ctxOf(req));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle(LOGIN_LIMIT)
  @ApiOperation({
    summary:
      'Sign in; returns tokens, or an mfaToken when a second factor is required',
  })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.login(dto, ctxOf(req));
  }

  @Public()
  @Post('2fa/challenge')
  @HttpCode(200)
  @Throttle(LOGIN_LIMIT)
  @ApiOperation({
    summary: 'Complete sign-in with an authenticator or backup code',
  })
  mfaChallenge(@Body() dto: MfaChallengeDto, @Req() req: Request) {
    return this.auth.completeMfa(dto, ctxOf(req));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Rotate the refresh token and get a new access token',
  })
  refresh(@Body() dto: RefreshDto, @Req() req: Request) {
    return this.auth.refresh(dto.refreshToken, ctxOf(req));
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth('bearer')
  @Audit('auth.logout', 'AuthSession')
  @ApiOperation({
    summary: 'Revoke the current session (or the given refresh token)',
  })
  async logout(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: LogoutDto,
  ): Promise<void> {
    await this.auth.logout(user, dto?.refreshToken);
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
    const result = await this.auth.forgotPassword(dto.email, ctxOf(req));
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
      'Reset the password with the emailed code; all sessions are signed out',
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
  @ApiOperation({ summary: 'Disable two-factor with password and a code' })
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
}
