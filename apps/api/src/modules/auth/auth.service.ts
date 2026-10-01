import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  AuthTokenPurpose,
  Prisma,
  User,
} from '../../generated/prisma/client';
import { newId } from '../../common/utils/ids';
import { addMinutes, randomToken, sha256 } from '../../common/utils/tokens';
import { AppConfigService } from '../../config/app-config.service';
import { CaptchaService } from '../../infra/captcha/captcha.service';
import { MailService } from '../../infra/mail/mail.service';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { FeatureFlagService } from '../access/feature-flag.service';
import { PermissionService } from '../access/permission.service';
import {
  canAssignRole,
  ROLE_API_NAME,
  roleFromApi,
  SELF_REGISTER_ROLES,
} from '../access/roles';
import { AuditService } from '../audit/audit.service';
import type { AuthenticatedUser, TokenPair } from './auth.types';
import {
  ChangePasswordDto,
  LoginDto,
  MfaChallengeDto,
  RegisterDto,
  ResetPasswordDto,
  UpdateMeDto,
} from './dto/auth.dto';
import { PasswordService } from './password.service';
import { sessionExpiry } from './session-rules';
import { TokenService } from './token.service';
import { TwoFactorService } from './two-factor.service';

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
}

export type LoginResult =
  | { mfaRequired: true; mfaToken: string }
  | ({
      mfaRequired: false;
      user: PublicUser;
      mfaSetupRequired: boolean;
    } & TokenPair);

export interface RegisterResult {
  message: string;
  verificationRequired: boolean;
  /** Development only (no mail server): the verification code, so the flow can be completed locally. */
  devToken?: string;
}

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  organizationId: string | null;
  status: string;
  locale: string;
  timezone: string | null;
  twoFactorEnabled: boolean;
  emailVerified: boolean;
  mfaSetupRequired: boolean;
  createdAt: Date;
  lastLoginAt: Date | null;
}

const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_MINUTES = 15;
const RESET_TTL_MINUTES = 60;
const VERIFY_TTL_MINUTES = 24 * 60;
const INVALID_CREDENTIALS = {
  code: 'auth.invalid_credentials',
  detail: 'Email or password is incorrect.',
};
const REGISTER_MESSAGE =
  'Check your email to verify your address, then sign in.';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly twoFactor: TwoFactorService,
    private readonly permissions: PermissionService,
    private readonly flags: FeatureFlagService,
    private readonly captcha: CaptchaService,
    private readonly mail: MailService,
    private readonly audit: AuditService,
    private readonly config: AppConfigService,
  ) {}

  // ---------------------------------------------------------------------------
  // Registration and email verification
  // ---------------------------------------------------------------------------

  /**
   * Self-registration for students and parents only (docs/11 section 3). Never issues tokens
   * and never reveals whether the email already exists: an existing account gets a
   * "you already have an account" email instead.
   */
  async register(
    dto: RegisterDto,
    ctx: RequestContext,
  ): Promise<RegisterResult> {
    if (!(await this.flags.isEnabled('self-registration'))) {
      throw new ForbiddenException({
        code: 'auth.registration_disabled',
        detail:
          'Self-registration is disabled. Ask your school for an invitation.',
      });
    }
    const role = roleFromApi(dto.role ?? 'student');
    if (!role || !SELF_REGISTER_ROLES.includes(role)) {
      throw new BadRequestException({
        code: 'auth.role_not_allowed',
        detail:
          'Only students and parents can self-register. Staff accounts are created by an administrator.',
      });
    }
    await this.captcha.assertHuman(dto.captchaToken, ctx.ip, 'register');
    const weakness = this.passwords.validateNewPassword(dto.password, {
      email: dto.email,
      firstName: dto.firstName,
      lastName: dto.lastName,
    });
    if (weakness)
      throw new BadRequestException({
        code: 'auth.password_weak',
        detail: weakness,
      });

    let organizationId: string | null = null;
    if (dto.joinCode) {
      const org = await this.prisma.organization.findFirst({
        where: { joinCode: dto.joinCode, deletedAt: null, isActive: true },
        select: { id: true },
      });
      if (!org)
        throw new BadRequestException({
          code: 'auth.join_code_invalid',
          detail: 'That school join code is not valid.',
        });
      organizationId = org.id;
    }

    const verificationRequired = this.config.auth.requireEmailVerification;
    const existing = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, firstName: true, organizationId: true },
    });
    if (existing) {
      await this.notify(
        dto.email,
        'You already have a SmartSchool account',
        `Hello ${existing.firstName},\n\nSomeone tried to register with this email address, but you already have an account. If this was you, sign in instead or use "Forgot password". If it was not you, no action is needed.`,
      );
      await this.audit.record({
        userId: existing.id,
        organizationId: existing.organizationId,
        action: 'auth.register_duplicate',
        entityType: 'User',
        entityId: existing.id,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });
      return { message: REGISTER_MESSAGE, verificationRequired };
    }

    const user = await this.prisma.user.create({
      data: {
        id: newId(),
        email: dto.email,
        passwordHash: await this.passwords.hash(dto.password),
        passwordChangedAt: new Date(),
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        role,
        organizationId,
      },
    });
    const token = await this.createToken(
      user.id,
      'EMAIL_VERIFY',
      VERIFY_TTL_MINUTES,
    );
    await this.notify(
      user.email,
      'Verify your SmartSchool email address',
      `Hello ${user.firstName},\n\nConfirm your email address to finish creating your account:\n\n${this.config.auth.webAppUrl}/verify-email?token=${token}\n\nThe link is valid for 24 hours.`,
    );
    await this.audit.record({
      userId: user.id,
      organizationId,
      action: 'auth.register',
      entityType: 'User',
      entityId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return {
      message: REGISTER_MESSAGE,
      verificationRequired,
      ...(this.config.isDevelopment ? { devToken: token } : {}),
    };
  }

  async verifyEmail(token: string, ctx: RequestContext): Promise<void> {
    const record = await this.consumeToken(token, ['EMAIL_VERIFY']);
    if (!record)
      throw new BadRequestException({
        code: 'auth.verify_token_invalid',
        detail:
          'The verification link is invalid or has expired. Request a new one.',
      });
    await this.prisma.user.update({
      where: { id: record.userId },
      data: { emailVerifiedAt: new Date() },
    });
    await this.audit.record({
      userId: record.userId,
      organizationId: record.user.organizationId,
      action: 'auth.email_verified',
      entityType: 'User',
      entityId: record.userId,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  /** Always resolves the same way; a new link is sent only to an unverified, active account. */
  async resendVerification(
    email: string,
    captchaToken: string | undefined,
    ctx: RequestContext,
  ): Promise<{ devToken?: string }> {
    await this.captcha.assertHuman(captchaToken, ctx.ip, 'resend_verification');
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (
      !user ||
      user.deletedAt ||
      user.status !== 'ACTIVE' ||
      user.emailVerifiedAt
    )
      return {};
    const token = await this.createToken(
      user.id,
      'EMAIL_VERIFY',
      VERIFY_TTL_MINUTES,
    );
    await this.notify(
      user.email,
      'Verify your SmartSchool email address',
      `Hello ${user.firstName},\n\nConfirm your email address:\n\n${this.config.auth.webAppUrl}/verify-email?token=${token}\n\nThe link is valid for 24 hours.`,
    );
    return this.config.isDevelopment ? { devToken: token } : {};
  }

  // ---------------------------------------------------------------------------
  // Login
  // ---------------------------------------------------------------------------

  async login(dto: LoginDto, ctx: RequestContext): Promise<LoginResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || user.deletedAt) {
      await this.passwords.hash(dto.password); // equalise timing for unknown emails
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException({
        code: 'auth.locked',
        detail: `Too many failed attempts. Try again after ${user.lockedUntil.toISOString()}.`,
      });
    }
    const verified = await this.passwords.verify(
      user.passwordHash,
      dto.password,
    );
    if (!verified.valid) {
      await this.recordFailure(user, ctx);
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: 'auth.account_inactive',
        detail: 'This account is inactive. Contact your administrator.',
      });
    }
    if (this.config.auth.requireEmailVerification && !user.emailVerifiedAt) {
      throw new ForbiddenException({
        code: 'auth.email_unverified',
        detail:
          'Verify your email address before signing in. You can request a new verification email.',
      });
    }
    if (verified.needsRehash) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await this.passwords.hash(dto.password) },
      });
    }
    if (user.twoFactorEnabled) {
      return { mfaRequired: true, mfaToken: this.tokens.signMfaToken(user.id) };
    }
    return this.completeLogin(user, dto.rememberMe ?? false, ctx);
  }

  async completeMfa(
    dto: MfaChallengeDto,
    ctx: RequestContext,
  ): Promise<LoginResult> {
    const userId = this.tokens.verifyMfaToken(dto.mfaToken);
    if (!userId)
      throw new UnauthorizedException({
        code: 'auth.mfa_token_invalid',
        detail: 'The sign-in step has expired. Sign in again.',
      });
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.twoFactorEnabled || !user.twoFactorSecret)
      throw new UnauthorizedException({
        code: 'auth.mfa_not_enabled',
        detail: 'Two-factor is not enabled.',
      });
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      throw new UnauthorizedException({
        code: 'auth.locked',
        detail: `Too many failed attempts. Try again after ${user.lockedUntil.toISOString()}.`,
      });
    }

    const step = this.twoFactor.verifyCode(
      user.twoFactorSecret,
      dto.code,
      user.lastTotpStep,
    );
    if (step !== null) {
      await this.prisma.user.update({
        where: { id: user.id },
        data: { lastTotpStep: step },
      });
    } else {
      const remaining = await this.twoFactor.consumeBackupCode(
        codesOf(user),
        dto.code,
      );
      if (!remaining) {
        await this.recordFailure(user, ctx);
        throw new UnauthorizedException({
          code: 'auth.mfa_code_invalid',
          detail: 'The code is not valid or was already used.',
        });
      }
      await this.prisma.user.update({
        where: { id: user.id },
        data: { backupCodes: JSON.stringify(remaining) },
      });
    }
    return this.completeLogin(user, dto.rememberMe ?? false, ctx);
  }

  private async completeLogin(
    user: User,
    rememberMe: boolean,
    ctx: RequestContext,
  ): Promise<LoginResult> {
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
    const pair = await this.issueSession(updated, rememberMe, ctx);
    await this.audit.record({
      userId: user.id,
      organizationId: user.organizationId,
      action: 'auth.login',
      entityType: 'User',
      entityId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return {
      mfaRequired: false,
      user: this.toPublic(updated),
      mfaSetupRequired: this.mfaSetupRequired(updated),
      ...pair,
    };
  }

  private async recordFailure(user: User, ctx: RequestContext): Promise<void> {
    const failures = user.failedLoginCount + 1;
    const lock = failures >= LOGIN_MAX_FAILURES;
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: lock ? 0 : failures,
        lockedUntil: lock ? addMinutes(new Date(), LOGIN_LOCK_MINUTES) : null,
      },
    });
    if (lock) {
      await this.audit.record({
        userId: user.id,
        organizationId: user.organizationId,
        action: 'auth.locked',
        entityType: 'User',
        entityId: user.id,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });
      await this.notify(
        user.email,
        'Your SmartSchool account was temporarily locked',
        `Hello ${user.firstName},\n\nThere were ${LOGIN_MAX_FAILURES} failed sign-in attempts on your account, so it is locked for ${LOGIN_LOCK_MINUTES} minutes. If this was not you, reset your password once the lock expires.`,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Sessions and refresh tokens (rotation with reuse detection, absolute lifetime)
  // ---------------------------------------------------------------------------

  private async issueSession(
    user: User,
    rememberMe: boolean,
    ctx: RequestContext,
    family?: { id: string; absoluteExpiresAt: Date | null },
  ): Promise<TokenPair> {
    const refreshToken = randomToken(32);
    const sessionId = newId();
    const { auth } = this.config;
    const expiry = sessionExpiry({
      now: new Date(),
      slidingDays: rememberMe
        ? auth.rememberMeAbsoluteDays
        : auth.refreshSlidingDays,
      absoluteDays: rememberMe
        ? auth.rememberMeAbsoluteDays
        : auth.sessionAbsoluteDays,
      familyAbsoluteExpiresAt: family?.absoluteExpiresAt,
    });
    await this.prisma.authSession.create({
      data: {
        id: sessionId,
        userId: user.id,
        familyId: family?.id ?? sessionId,
        refreshTokenHash: sha256(refreshToken),
        userAgent: ctx.userAgent?.slice(0, 500) ?? null,
        ipAddress: ctx.ip,
        rememberMe,
        expiresAt: expiry.expiresAt,
        absoluteExpiresAt: expiry.absoluteExpiresAt,
      },
    });
    const access = this.tokens.signAccessToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      organizationId: user.organizationId,
      sessionId,
      rememberMe,
    });
    return {
      accessToken: access.token,
      refreshToken,
      expiresAt: access.expiresAt.toISOString(),
      refreshExpiresAt: expiry.expiresAt.toISOString(),
    };
  }

  async refresh(refreshToken: string, ctx: RequestContext): Promise<TokenPair> {
    const session = await this.prisma.authSession.findUnique({
      where: { refreshTokenHash: sha256(refreshToken) },
      include: { user: true },
    });
    if (!session)
      throw new UnauthorizedException({
        code: 'auth.refresh_invalid',
        detail: 'Refresh token is not valid.',
      });

    if (session.revokedAt || session.replacedById) {
      // A rotated or revoked token was presented again: assume theft and revoke the whole family.
      await this.prisma.authSession.updateMany({
        where: { familyId: session.familyId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        userId: session.userId,
        action: 'auth.refresh_reuse_detected',
        entityType: 'AuthSession',
        entityId: session.id,
        ipAddress: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw new UnauthorizedException({
        code: 'auth.refresh_reused',
        detail: 'This session was revoked. Sign in again.',
      });
    }
    const now = new Date();
    if (
      session.expiresAt <= now ||
      (session.absoluteExpiresAt && session.absoluteExpiresAt <= now)
    ) {
      throw new UnauthorizedException({
        code: 'auth.refresh_expired',
        detail: 'Session expired. Sign in again.',
      });
    }
    if (session.user.status !== 'ACTIVE' || session.user.deletedAt)
      throw new UnauthorizedException({
        code: 'auth.account_inactive',
        detail: 'This account is inactive.',
      });

    const next = await this.issueSession(
      session.user,
      session.rememberMe,
      ctx,
      { id: session.familyId, absoluteExpiresAt: session.absoluteExpiresAt },
    );
    await this.prisma.authSession.update({
      where: { id: session.id },
      data: {
        revokedAt: now,
        replacedById: sha256(next.refreshToken).slice(0, 36),
        lastUsedAt: now,
      },
    });
    return next;
  }

  async logout(
    current: AuthenticatedUser,
    refreshToken?: string,
  ): Promise<void> {
    const where: Prisma.AuthSessionWhereInput = refreshToken
      ? { refreshTokenHash: sha256(refreshToken), userId: current.id }
      : { id: current.sessionId };
    await this.prisma.authSession.updateMany({
      where: { ...where, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async sessions(current: AuthenticatedUser) {
    const rows = await this.prisma.authSession.findMany({
      where: {
        userId: current.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { lastUsedAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
        absoluteExpiresAt: true,
        rememberMe: true,
      },
    });
    return rows.map((s) => ({ ...s, current: s.id === current.sessionId }));
  }

  async revokeSession(
    current: AuthenticatedUser,
    sessionId: string,
  ): Promise<void> {
    const result = await this.prisma.authSession.updateMany({
      where: { id: sessionId, userId: current.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (result.count === 0)
      throw new NotFoundException({
        code: 'resource.not_found',
        detail: 'Session not found.',
      });
  }

  private async revokeAllSessions(
    userId: string,
    exceptSessionId?: string,
  ): Promise<void> {
    await this.prisma.authSession.updateMany({
      where: {
        userId,
        revokedAt: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revokedAt: new Date() },
    });
  }

  // ---------------------------------------------------------------------------
  // Profile and password
  // ---------------------------------------------------------------------------

  async me(
    current: AuthenticatedUser,
  ): Promise<PublicUser & { features: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: current.id },
    });
    const features = await this.permissions.effectiveFeatures(
      user.id,
      user.role,
    );
    return { ...this.toPublic(user), features: [...features].sort() };
  }

  async updateMe(
    current: AuthenticatedUser,
    dto: UpdateMeDto,
  ): Promise<PublicUser> {
    const user = await this.prisma.user.update({
      where: { id: current.id },
      data: {
        ...dto,
        firstName: dto.firstName?.trim(),
        lastName: dto.lastName?.trim(),
      },
    });
    return this.toPublic(user);
  }

  async changePassword(
    current: AuthenticatedUser,
    dto: ChangePasswordDto,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: current.id },
    });
    const verified = await this.passwords.verify(
      user.passwordHash,
      dto.currentPassword,
    );
    if (!verified.valid)
      throw new ForbiddenException({
        code: 'auth.password_incorrect',
        detail: 'Current password is incorrect.',
      });
    if (dto.currentPassword === dto.newPassword)
      throw new BadRequestException({
        code: 'auth.password_reused',
        detail: 'Choose a different password.',
      });
    const weakness = this.passwords.validateNewPassword(dto.newPassword, user);
    if (weakness)
      throw new BadRequestException({
        code: 'auth.password_weak',
        detail: weakness,
      });
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash: await this.passwords.hash(dto.newPassword),
        passwordChangedAt: new Date(),
      },
    });
    await this.revokeAllSessions(user.id, current.sessionId);
    await this.audit.record({
      userId: user.id,
      organizationId: user.organizationId,
      action: 'auth.password_changed',
      entityType: 'User',
      entityId: user.id,
    });
    await this.notify(
      user.email,
      'Your SmartSchool password was changed',
      `Hello ${user.firstName},\n\nYour password was just changed and your other devices were signed out. If this was not you, reset your password now and contact your school.`,
    );
  }

  /** Always resolves the same way so account existence is never revealed. */
  async forgotPassword(
    email: string,
    captchaToken: string | undefined,
    ctx: RequestContext,
  ): Promise<{ delivered: boolean; devToken?: string }> {
    await this.captcha.assertHuman(captchaToken, ctx.ip, 'forgot_password');
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.deletedAt || user.status !== 'ACTIVE')
      return { delivered: false };

    const token = await this.createToken(
      user.id,
      'PASSWORD_RESET',
      RESET_TTL_MINUTES,
    );
    const delivered = await this.mail.send({
      to: user.email,
      subject: 'Reset your SmartSchool password',
      text: `Hello ${user.firstName},\n\nUse this code within ${RESET_TTL_MINUTES} minutes to reset your password:\n\n${token}\n\nOr open ${this.config.auth.webAppUrl}/reset-password?token=${token}\n\nIf you did not request this, ignore this email.`,
    });
    await this.audit.record({
      userId: user.id,
      organizationId: user.organizationId,
      action: 'auth.password_reset_requested',
      entityType: 'User',
      entityId: user.id,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
    // The token is exposed only in development so the flow can be exercised without SMTP.
    return this.config.isDevelopment
      ? { delivered, devToken: token }
      : { delivered };
  }

  /** Accepts password-reset codes and invitation codes (both prove control of the mailbox). */
  async resetPassword(
    dto: ResetPasswordDto,
    ctx: RequestContext,
  ): Promise<void> {
    const record = await this.consumeToken(dto.token, [
      'PASSWORD_RESET',
      'INVITE',
    ]);
    if (!record)
      throw new BadRequestException({
        code: 'auth.reset_token_invalid',
        detail: 'The reset code is invalid or has expired.',
      });
    const weakness = this.passwords.validateNewPassword(
      dto.newPassword,
      record.user,
    );
    if (weakness)
      throw new BadRequestException({
        code: 'auth.password_weak',
        detail: weakness,
      });
    await this.prisma.user.update({
      where: { id: record.userId },
      data: {
        passwordHash: await this.passwords.hash(dto.newPassword),
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
        emailVerifiedAt: record.user.emailVerifiedAt ?? new Date(),
      },
    });
    await this.revokeAllSessions(record.userId);
    await this.audit.record({
      userId: record.userId,
      organizationId: record.user.organizationId,
      action: 'auth.password_reset',
      entityType: 'User',
      entityId: record.userId,
      ipAddress: ctx.ip,
      userAgent: ctx.userAgent,
    });
    await this.notify(
      record.user.email,
      'Your SmartSchool password was reset',
      `Hello ${record.user.firstName},\n\nYour password was reset and all devices were signed out. If this was not you, contact your school immediately.`,
    );
  }

  // ---------------------------------------------------------------------------
  // Two-factor
  // ---------------------------------------------------------------------------

  async twoFactorSetup(current: AuthenticatedUser) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: current.id },
    });
    if (user.twoFactorEnabled)
      throw new ConflictException({
        code: 'auth.mfa_already_enabled',
        detail: 'Two-factor is already enabled.',
      });
    const setup = await this.twoFactor.createSetup(user.email);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { twoFactorSecret: setup.encryptedSecret, lastTotpStep: null },
    });
    return {
      otpauthUrl: setup.otpauthUrl,
      qrDataUrl: setup.qrDataUrl,
      manualKey: setup.manualKey,
    };
  }

  async twoFactorVerify(
    current: AuthenticatedUser,
    code: string,
  ): Promise<{ backupCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: current.id },
    });
    if (!user.twoFactorSecret)
      throw new BadRequestException({
        code: 'auth.mfa_setup_missing',
        detail: 'Start two-factor setup first.',
      });
    const step = this.twoFactor.verifyCode(
      user.twoFactorSecret,
      code,
      user.lastTotpStep,
    );
    if (step === null)
      throw new BadRequestException({
        code: 'auth.mfa_code_invalid',
        detail: 'The code is not valid.',
      });
    const backup = await this.twoFactor.generateBackupCodes();
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: true,
        backupCodes: JSON.stringify(backup.hashes),
        lastTotpStep: step,
      },
    });
    await this.audit.record({
      userId: user.id,
      organizationId: user.organizationId,
      action: 'auth.mfa_enabled',
      entityType: 'User',
      entityId: user.id,
    });
    await this.notify(
      user.email,
      'Two-factor authentication enabled',
      `Hello ${user.firstName},\n\nTwo-factor authentication is now on for your SmartSchool account. Keep your backup codes somewhere safe.`,
    );
    return { backupCodes: backup.plain };
  }

  async twoFactorDisable(
    current: AuthenticatedUser,
    password: string,
    code: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: current.id },
    });
    if (!user.twoFactorEnabled || !user.twoFactorSecret)
      throw new BadRequestException({
        code: 'auth.mfa_not_enabled',
        detail: 'Two-factor is not enabled.',
      });
    if (this.mfaSetupRequired({ ...user, twoFactorEnabled: false })) {
      throw new ForbiddenException({
        code: 'auth.mfa_required_for_role',
        detail:
          'Two-factor authentication is required for your role and cannot be turned off.',
      });
    }
    const verified = await this.passwords.verify(user.passwordHash, password);
    if (!verified.valid)
      throw new ForbiddenException({
        code: 'auth.password_incorrect',
        detail: 'Password is incorrect.',
      });
    const codeOk =
      this.twoFactor.verifyCode(
        user.twoFactorSecret,
        code,
        user.lastTotpStep,
      ) !== null ||
      (await this.twoFactor.consumeBackupCode(codesOf(user), code)) !== null;
    if (!codeOk)
      throw new BadRequestException({
        code: 'auth.mfa_code_invalid',
        detail: 'The code is not valid.',
      });
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        twoFactorEnabled: false,
        twoFactorSecret: null,
        backupCodes: null,
        lastTotpStep: null,
      },
    });
    await this.audit.record({
      userId: user.id,
      organizationId: user.organizationId,
      action: 'auth.mfa_disabled',
      entityType: 'User',
      entityId: user.id,
    });
    await this.notify(
      user.email,
      'Two-factor authentication disabled',
      `Hello ${user.firstName},\n\nTwo-factor authentication was turned off for your SmartSchool account. If this was not you, change your password now.`,
    );
  }

  async twoFactorRegenerateBackupCodes(
    current: AuthenticatedUser,
    code: string,
  ): Promise<{ backupCodes: string[] }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: current.id },
    });
    if (!user.twoFactorEnabled || !user.twoFactorSecret)
      throw new BadRequestException({
        code: 'auth.mfa_not_enabled',
        detail: 'Two-factor is not enabled.',
      });
    const step = this.twoFactor.verifyCode(
      user.twoFactorSecret,
      code,
      user.lastTotpStep,
    );
    if (step === null)
      throw new BadRequestException({
        code: 'auth.mfa_code_invalid',
        detail: 'The code is not valid.',
      });
    const backup = await this.twoFactor.generateBackupCodes();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { backupCodes: JSON.stringify(backup.hashes), lastTotpStep: step },
    });
    return { backupCodes: backup.plain };
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  /** Administrators in the configured roles must finish 2FA setup before using the rest of the API. */
  mfaSetupRequired(user: Pick<User, 'role' | 'twoFactorEnabled'>): boolean {
    return (
      this.config.auth.mfaRequiredRoles.includes(ROLE_API_NAME[user.role]) &&
      !user.twoFactorEnabled
    );
  }

  toPublic(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: ROLE_API_NAME[user.role],
      organizationId: user.organizationId,
      status: user.status.toLowerCase(),
      locale: user.locale,
      timezone: user.timezone,
      twoFactorEnabled: user.twoFactorEnabled,
      emailVerified: user.emailVerifiedAt !== null,
      mfaSetupRequired: this.mfaSetupRequired(user),
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
    };
  }

  /** Whether `actor` may create or change an account with role `target` (used by the users module). */
  assertCanAssign(actor: AuthenticatedUser, target: User['role']): void {
    if (!canAssignRole(actor.role, target)) {
      throw new ForbiddenException({
        code: 'authz.forbidden',
        detail: `Your role cannot assign the role '${ROLE_API_NAME[target]}'.`,
      });
    }
  }

  private async createToken(
    userId: string,
    purpose: AuthTokenPurpose,
    ttlMinutes: number,
  ): Promise<string> {
    const token = randomToken(32);
    await this.prisma.authToken.create({
      data: {
        id: newId(),
        userId,
        purpose,
        tokenHash: sha256(token),
        expiresAt: addMinutes(new Date(), ttlMinutes),
      },
    });
    return token;
  }

  /** Marks a single-use token as used and returns it with its user, or null when invalid, used or expired. */
  private async consumeToken(token: string, purposes: AuthTokenPurpose[]) {
    const record = await this.prisma.authToken.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (
      !record ||
      !purposes.includes(record.purpose) ||
      record.usedAt ||
      record.expiresAt <= new Date()
    )
      return null;
    const claimed = await this.prisma.authToken.updateMany({
      where: { id: record.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    return claimed.count === 1 ? record : null;
  }

  /** Security notification; delivery failures are logged, never surfaced to the caller. */
  private async notify(
    to: string,
    subject: string,
    text: string,
  ): Promise<void> {
    try {
      await this.mail.send({ to, subject, text });
    } catch (err) {
      this.logger.warn(
        `Notification "${subject}" to ${to} failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

function codesOf(user: User): string[] {
  if (!user.backupCodes) return [];
  try {
    const parsed: unknown = JSON.parse(user.backupCodes);
    return Array.isArray(parsed)
      ? parsed.filter((c): c is string => typeof c === 'string')
      : [];
  } catch {
    return [];
  }
}
