import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { CATEGORIES, type Category } from '../notification-rules';

export const CATEGORY_API = CATEGORIES.map((c) => c.toLowerCase());

export class ListNotificationsQuery {
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  unreadOnly?: boolean;
  @ApiProperty({ required: false, enum: CATEGORY_API })
  @IsOptional()
  @IsIn(CATEGORY_API)
  category?: string;
  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;
  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize = 20;
}

export class PreferenceDto {
  @ApiProperty({ enum: CATEGORY_API }) @IsIn(CATEGORY_API) category!: string;
  @ApiProperty() @IsBoolean() inApp!: boolean;
  @ApiProperty() @IsBoolean() email!: boolean;
}

export class SetPreferencesDto {
  @ApiProperty({ type: [PreferenceDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => PreferenceDto)
  preferences!: PreferenceDto[];
}

export function toCategory(api: string): Category {
  return api.toUpperCase() as Category;
}
