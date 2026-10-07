import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  Min,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paged-response.dto';
import {
  API_KEY_SCOPES,
  WEBHOOK_EVENT_TYPES,
  WEBHOOK_STATUSES,
} from '../integration-rules';

export class CreateWebhookDto {
  @ApiProperty({ example: 'SIS sync' })
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiProperty({ example: 'https://sis.district.org/hooks/smartschool' })
  @IsUrl({ require_tld: false })
  @Length(8, 500)
  url!: string;

  @ApiProperty({
    required: false,
    enum: WEBHOOK_EVENT_TYPES,
    isArray: true,
    description: 'Empty means every event; a type ending in a dot is a prefix',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  events?: string[];

  @ApiProperty({ required: false, default: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  retryLimit?: number;
}

export class UpdateWebhookDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @Length(8, 500)
  url?: string;

  @ApiProperty({ required: false, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  events?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  retryLimit?: number;
}

export class ListDeliveriesQuery extends PagedQueryDto {
  @ApiProperty({ required: false, enum: WEBHOOK_STATUSES })
  @IsOptional()
  @IsIn(WEBHOOK_STATUSES)
  status?: (typeof WEBHOOK_STATUSES)[number];
}

export class CreateApiKeyDto {
  @ApiProperty({ example: 'District data warehouse' })
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiProperty({ enum: API_KEY_SCOPES, isArray: true })
  @IsArray()
  @ArrayMaxSize(30)
  @IsIn(API_KEY_SCOPES, { each: true })
  scopes!: string[];

  @ApiProperty({
    required: false,
    default: 600,
    description: 'Requests per minute',
  })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(10_000)
  rateLimitPerMinute?: number;

  @ApiProperty({
    required: false,
    description: 'Days until the key stops working; omit for no expiry',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3650)
  expiresInDays?: number;
}

export class CreateLtiPlatformDto {
  @ApiProperty({ example: 'Canvas' })
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiProperty({ example: 'https://canvas.instructure.com' })
  @IsString()
  @Length(4, 500)
  issuer!: string;

  @ApiProperty({
    description: 'The client id the platform assigned to SmartSchool',
  })
  @IsString()
  @Length(1, 200)
  clientId!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  deploymentId?: string;

  @ApiProperty({
    example: 'https://canvas.instructure.com/api/lti/authorize_redirect',
  })
  @IsUrl({ require_tld: false })
  @Length(8, 500)
  authorizationUrl!: string;

  @ApiProperty({
    example: 'https://canvas.instructure.com/api/lti/security/jwks',
  })
  @IsUrl({ require_tld: false })
  @Length(8, 500)
  jwksUrl!: string;

  @ApiProperty({
    required: false,
    example: 'https://canvas.instructure.com/login/oauth2/token',
  })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @Length(8, 500)
  tokenUrl?: string;
}

export class UpdateLtiPlatformDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  deploymentId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @Length(8, 500)
  authorizationUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @Length(8, 500)
  jwksUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class CreateLtiToolDto {
  @ApiProperty({ example: 'Desmos' })
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiProperty({ description: 'OIDC login initiation URL of the tool' })
  @IsUrl({ require_tld: false })
  @Length(8, 500)
  loginUrl!: string;

  @ApiProperty({ description: 'Target link URI the tool launches at' })
  @IsUrl({ require_tld: false })
  @Length(8, 500)
  launchUrl!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @Length(8, 500)
  jwksUrl?: string;

  @ApiProperty({
    required: false,
    description: 'Custom parameters sent on every launch',
  })
  @IsOptional()
  @IsObject()
  customParams?: Record<string, string>;
}

export class UpdateLtiToolDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 100)
  name?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @Length(8, 500)
  loginUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsUrl({ require_tld: false })
  @Length(8, 500)
  launchUrl?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  customParams?: Record<string, string>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
