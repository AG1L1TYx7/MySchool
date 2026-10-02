import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ANNOUNCEMENT_TYPES, PRIORITIES } from '../announcement-rules';

export class CreateAnnouncementDto {
  @ApiProperty() @IsString() @Length(2, 200) title!: string;
  @ApiProperty() @IsString() @Length(1, 20_000) content!: string;
  @ApiProperty({
    required: false,
    enum: ANNOUNCEMENT_TYPES,
    default: 'general',
  })
  @IsOptional()
  @IsIn(ANNOUNCEMENT_TYPES)
  type?: (typeof ANNOUNCEMENT_TYPES)[number];
  @ApiProperty({ required: false, enum: PRIORITIES, default: 'normal' })
  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: (typeof PRIORITIES)[number];
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'Omit for a school-wide announcement',
  })
  @IsOptional()
  @IsUUID()
  classId?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() pinned?: boolean;
  @ApiProperty({ required: false, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;
  @ApiProperty({ required: false, description: 'Publish immediately' })
  @IsOptional()
  @IsBoolean()
  publish?: boolean;
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'District accounts choose the organisation',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class UpdateAnnouncementDto extends PartialType(CreateAnnouncementDto) {}

export class ListAnnouncementsQuery {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  classId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
  @ApiProperty({ required: false, enum: ANNOUNCEMENT_TYPES })
  @IsOptional()
  @IsIn(ANNOUNCEMENT_TYPES)
  type?: string;
  @ApiProperty({ required: false, enum: PRIORITIES })
  @IsOptional()
  @IsIn(PRIORITIES)
  priority?: string;
  @ApiProperty({ required: false, enum: ['draft', 'published', 'archived'] })
  @IsOptional()
  @IsIn(['draft', 'published', 'archived'])
  status?: string;
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
