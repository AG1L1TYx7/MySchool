import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';

export const ROSTER_PROVIDERS = [
  'oneroster_api',
  'clever',
  'classlink',
] as const;
export const SSO_PROVIDERS_API = [
  'google',
  'microsoft',
  'clever',
  'classlink',
] as const;

export class CreateRosterSourceDto {
  @ApiProperty({ enum: ROSTER_PROVIDERS })
  @IsIn(ROSTER_PROVIDERS)
  provider!: (typeof ROSTER_PROVIDERS)[number];
  @ApiProperty() @IsString() @Length(1, 120) name!: string;
  @ApiProperty({
    description:
      'Provider settings: OneRoster and ClassLink { baseUrl, tokenUrl, clientId, clientSecret, schoolExternalId? }; Clever { districtToken, schoolExternalId? }. Secrets are stored encrypted and never returned.',
  })
  @IsObject()
  config!: Record<string, string>;
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class UpdateRosterSourceDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsObject() config?: Record<
    string,
    string
  >;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;
}

export class RunSourceDto {
  @ApiProperty({
    required: false,
    default: false,
    description: 'Compute the changes without writing them',
  })
  @IsOptional()
  @IsBoolean()
  dryRun?: boolean;
}

export class ImportCsvQuery {
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  dryRun?: boolean;
}

export class SsoSettingsDto {
  @ApiProperty({ enum: SSO_PROVIDERS_API, isArray: true })
  @IsArray()
  @ArrayMaxSize(4)
  @IsIn(SSO_PROVIDERS_API, { each: true })
  providers!: Array<(typeof SSO_PROVIDERS_API)[number]>;
  @ApiProperty({
    type: [String],
    description:
      'Email domains allowed to sign in with these providers; empty means any rostered address',
  })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  allowedDomains!: string[];
  @ApiProperty({
    description: 'Rostered accounts may sign in without a SmartSchool password',
  })
  @IsBoolean()
  passwordOptional!: boolean;
}
