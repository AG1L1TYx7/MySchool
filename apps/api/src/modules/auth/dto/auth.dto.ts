import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { PasswordService } from '../password.service';

const PASSWORD_MESSAGE =
  'Password must be 12 to 128 characters with upper and lower case letters, a digit and a symbol.';
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RegisterDto {
  @ApiProperty({ example: 'jane.teacher@school.edu' })
  @Transform(lower)
  @IsEmail()
  @MaxLength(256)
  email!: string;

  @ApiProperty({ minLength: 12 })
  @IsString()
  @Matches(PasswordService.POLICY, { message: PASSWORD_MESSAGE })
  password!: string;

  @ApiProperty() @IsString() @Length(1, 100) firstName!: string;
  @ApiProperty() @IsString() @Length(1, 100) lastName!: string;

  @ApiProperty({ enum: ['student', 'parent', 'teacher'], default: 'student' })
  @IsOptional()
  @IsIn(['student', 'parent', 'teacher'])
  role?: 'student' | 'parent' | 'teacher';

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

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
  @ApiProperty() @IsString() @Length(20, 200) refreshToken!: string;
}

export class LogoutDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(20, 200)
  refreshToken?: string;
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
  @Matches(PasswordService.POLICY, { message: PASSWORD_MESSAGE })
  newPassword!: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @Transform(lower) @IsEmail() @MaxLength(256) email!: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @Length(20, 200) token!: string;
  @ApiProperty({ minLength: 12 })
  @IsString()
  @Matches(PasswordService.POLICY, { message: PASSWORD_MESSAGE })
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
