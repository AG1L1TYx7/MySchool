import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
} from 'class-validator';

export const EVENT_TYPES = [
  'day_off',
  'early_release',
  'term_start',
  'term_end',
  'school_event',
  'class_event',
] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class CreateEventDto {
  @ApiProperty() @IsString() @Length(1, 200) title!: string;
  @ApiProperty({ enum: EVENT_TYPES, default: 'school_event' })
  @IsOptional()
  @IsIn(EVENT_TYPES)
  type?: (typeof EVENT_TYPES)[number];
  @ApiProperty({ format: 'date-time' }) @IsDateString() startsAt!: string;
  @ApiProperty({ required: false, format: 'date-time' })
  @IsOptional()
  @IsDateString()
  endsAt?: string;
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  allDay?: boolean;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(0, 5000)
  description?: string;
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'A class event; omit for a school-wide one',
  })
  @IsOptional()
  @IsUUID()
  classId?: string;
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'District accounts choose the organisation',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
export class UpdateEventDto extends PartialType(CreateEventDto) {}

export class FeedQuery {
  @ApiProperty({ example: '2026-10-01' }) @Matches(DATE) from!: string;
  @ApiProperty({ example: '2026-10-31' }) @Matches(DATE) to!: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  classId?: string;
}
