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
  ValidateNested,
} from 'class-validator';
import { TENANT_STATUSES } from '../tenant-rules';

export class BrandingDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 80)
  displayName?: string;
  @ApiProperty({
    required: false,
    description: 'Hex colour, for example #1e40af',
  })
  @IsOptional()
  @IsString()
  @Length(0, 7)
  primaryColor?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  logoUrl?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 120)
  supportEmail?: string;
}

export class CreateTenantDto {
  @ApiProperty() @IsString() @Length(2, 200) name!: string;
  @ApiProperty({
    required: false,
    description: 'Subdomain label; made from the name when absent',
  })
  @IsOptional()
  @IsString()
  @Length(3, 63)
  slug?: string;
  @ApiProperty({ required: false, enum: TENANT_STATUSES })
  @IsOptional()
  @IsIn(TENANT_STATUSES)
  status?: (typeof TENANT_STATUSES)[number];
  @ApiProperty({ required: false, type: BrandingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandingDto)
  branding?: BrandingDto;
}

export class UpdateTenantDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(3, 63)
  slug?: string;
  @ApiProperty({ required: false, enum: TENANT_STATUSES })
  @IsOptional()
  @IsIn(TENANT_STATUSES)
  status?: (typeof TENANT_STATUSES)[number];
  @ApiProperty({
    required: false,
    description: 'Empty string removes the domain',
  })
  @IsOptional()
  @IsString()
  @Length(0, 253)
  customDomain?: string;
  @ApiProperty({ required: false, type: BrandingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandingDto)
  branding?: BrandingDto;
}

export class UpdatePoliciesDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  aiDisabledSchools?: string[];
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  studentMessagingAllowed?: boolean;
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @IsString({ each: true })
  disabledFeatures?: string[];
  @ApiProperty({
    required: false,
    description:
      'Retention days by switch; applied to schools without their own setting',
  })
  @IsOptional()
  @IsObject()
  retention?: Record<string, number>;
}
