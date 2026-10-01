import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const upper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class RegisterDto {
  @ApiProperty({ example: 'emma.student@school.edu' })
  @Transform(lower)
  @IsEmail()
  @MaxLength(256)
  email!: string;

  @ApiProperty({
    minLength: 12,
    description:
      'Checked against the policy, a common-password list and your name/email',
  })
  @IsString()
  @Length(12, 128)
  password!: string;

  @ApiProperty() @IsString() @Length(1, 100) firstName!: string;
  @ApiProperty() @IsString() @Length(1, 100) lastName!: string;

  @ApiProperty({
    enum: ['student', 'parent'],
    default: 'student',
    description: 'Staff accounts are created by administrators',
  })
  @IsOptional()
  @IsIn(['student', 'parent'])
  role?: 'student' | 'parent';

  @ApiProperty({
    required: false,
    example: 'DEMO-2026',
    description: 'School join code; without it the account has no organisation',
  })
  @IsOptional()
  @Transform(upper)
  @IsString()
  @Length(4, 16)
  @Matches(/^[A-Z0-9-]+$/)
  joinCode?: string;

  @ApiProperty({
    required: false,
    description: 'reCAPTCHA v3 token, required when reCAPTCHA is configured',
  })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;
}

export class LoginDto {
  @ApiProperty() @Transform(lower) @IsEmail() @MaxLength(256) email!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) password!: string;
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class MfaChallengeDto {
  @ApiProperty() @IsString() @MaxLength(2048) mfaToken!: string;
  @ApiProperty({ description: 'Six-digit authenticator code or a backup code' })
  @IsString()
  @Length(6, 11)
  code!: string;
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  rememberMe?: boolean;
}

export class RefreshDto {
  @ApiProperty({
    required: false,
    description: 'Only for native clients; browsers send the HttpOnly cookie',
  })
  @IsOptional()
  @IsString()
  @Length(20, 200)
  refreshToken?: string;
}

export class LogoutDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(20, 200)
  refreshToken?: string;
}

export class VerifyEmailDto {
  @ApiProperty() @IsString() @Length(20, 200) token!: string;
}

export class ResendVerificationDto {
  @ApiProperty() @Transform(lower) @IsEmail() @MaxLength(256) email!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;
}

export class UpdateMeDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  firstName?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
  @ApiProperty({ required: false, example: 'en' })
  @IsOptional()
  @IsString()
  @Length(2, 16)
  locale?: string;
  @ApiProperty({ required: false, example: 'America/New_York' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;
  @ApiProperty({ minLength: 12 })
  @IsString()
  @Length(12, 128)
  newPassword!: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @Transform(lower) @IsEmail() @MaxLength(256) email!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  captchaToken?: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @Length(20, 200) token!: string;
  @ApiProperty({ minLength: 12 })
  @IsString()
  @Length(12, 128)
  newPassword!: string;
}

export class TwoFactorCodeDto {
  @ApiProperty({ description: 'Six-digit authenticator code' })
  @IsString()
  @Length(6, 8)
  code!: string;
}

export class TwoFactorDisableDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) password!: string;
  @ApiProperty({ description: 'Authenticator code or backup code' })
  @IsString()
  @Length(6, 11)
  code!: string;
}
