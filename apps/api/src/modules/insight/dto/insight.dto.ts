import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { FREQUENCIES, REPORT_KINDS } from '../insight-rules';

export class CreateScheduleDto {
  @ApiProperty() @IsString() @Length(1, 120) name!: string;
  @ApiProperty({ enum: REPORT_KINDS })
  @IsIn(REPORT_KINDS)
  kind!: (typeof REPORT_KINDS)[number];
  @ApiProperty({ enum: FREQUENCIES })
  @IsIn(FREQUENCIES)
  frequency!: (typeof FREQUENCIES)[number];
  @ApiProperty({
    required: false,
    minimum: 0,
    maximum: 6,
    description: '0 = Sunday; weekly only',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;
  @ApiProperty({
    required: false,
    minimum: 1,
    maximum: 31,
    description: 'monthly only',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;
  @ApiProperty({
    required: false,
    default: 7,
    description: 'Hour of the day in UTC',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'class_summary only',
  })
  @IsOptional()
  @IsUUID()
  classId?: string;
  @ApiProperty({
    type: [String],
    description: 'Staff email addresses at this school',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true })
  recipients!: string[];
}

export class UpdateScheduleDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;
  @ApiProperty({ required: false, enum: FREQUENCIES })
  @IsOptional()
  @IsIn(FREQUENCIES)
  frequency?: (typeof FREQUENCIES)[number];
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(23)
  hour?: number;
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @IsEmail({}, { each: true })
  recipients?: string[];
  @ApiProperty({ required: false }) @IsOptional() @IsBoolean() active?: boolean;
}

export class OverviewQuery {
  @ApiProperty({ required: false, description: 'ISO date; defaults to today' })
  @IsOptional()
  @IsISO8601()
  date?: string;
}

export class ReportQuery {
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'class_summary only',
  })
  @IsOptional()
  @IsUUID()
  classId?: string;
}
