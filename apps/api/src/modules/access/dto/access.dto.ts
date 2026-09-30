import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

const FEATURE_CODE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

export class SetRoleFeaturesDto {
  @ApiProperty({
    type: [String],
    example: ['students.view', 'students.create'],
  })
  @IsArray()
  @ArrayMaxSize(500)
  @IsString({ each: true })
  @Matches(FEATURE_CODE, { each: true })
  codes!: string[];
}

export class SetUserOverrideDto {
  @ApiProperty()
  @IsBoolean()
  isGranted!: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiProperty({ required: false, type: String, format: 'date-time' })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  expiresAt?: Date;
}

export class SetFeatureFlagDto {
  @ApiProperty()
  @IsBoolean()
  isEnabled!: boolean;
}
