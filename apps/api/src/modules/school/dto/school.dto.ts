import { ApiProperty, PartialType } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const TERM_TYPES = ['semester', 'trimester', 'quarter', 'term'] as const;
export const CODE_CATEGORIES = [
  'present',
  'tardy',
  'excused',
  'unexcused',
  'remote',
  'other',
] as const;

export class CreateAcademicYearDto {
  @ApiProperty({ example: '2026-2027' })
  @IsString()
  @Length(2, 50)
  name!: string;
  @ApiProperty({ example: '2026-08-15' }) @Matches(DATE) startDate!: string;
  @ApiProperty({ example: '2027-06-05' }) @Matches(DATE) endDate!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;
}
export class UpdateAcademicYearDto extends PartialType(CreateAcademicYearDto) {}

export class CreateTermDto {
  @ApiProperty({ example: 'Fall 2026' })
  @IsString()
  @Length(1, 50)
  name!: string;
  @ApiProperty({ enum: TERM_TYPES, default: 'semester' })
  @IsOptional()
  @IsIn(TERM_TYPES)
  type?: (typeof TERM_TYPES)[number];
  @ApiProperty() @Matches(DATE) startDate!: string;
  @ApiProperty() @Matches(DATE) endDate!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  sortOrder?: number;
}
export class UpdateTermDto extends PartialType(CreateTermDto) {}

export class CreateGradingPeriodDto {
  @ApiProperty({ example: 'Q1' }) @IsString() @Length(1, 50) name!: string;
  @ApiProperty() @Matches(DATE) startDate!: string;
  @ApiProperty() @Matches(DATE) endDate!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  sortOrder?: number;
}

export class CreateBellScheduleDto {
  @ApiProperty({ example: 'Regular day' })
  @IsString()
  @Length(1, 80)
  name!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class CreatePeriodDto {
  @ApiProperty({ example: '3' }) @IsString() @Length(1, 20) name!: string;
  @ApiProperty({ example: '09:50' }) @Matches(TIME) startTime!: string;
  @ApiProperty({ example: '10:40' }) @Matches(TIME) endTime!: string;
  @ApiProperty({ example: 'MTWRF', description: 'M T W R(Thu) F S U(Sun)' })
  @IsOptional()
  @Matches(/^[MTWRFSUmtwrfsu]{1,7}$/)
  days?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  sortOrder?: number;
}
export class UpdatePeriodDto extends PartialType(CreatePeriodDto) {}

export class AttendanceCodeDto {
  @ApiProperty({ example: 'AE' }) @IsString() @Length(1, 10) code!: string;
  @ApiProperty({ example: 'Absent, excused' })
  @IsString()
  @Length(1, 60)
  label!: string;
  @ApiProperty({ enum: CODE_CATEGORIES })
  @IsIn(CODE_CATEGORIES)
  category!: (typeof CODE_CATEGORIES)[number];
  @ApiProperty() @IsBoolean() countsAsPresent!: boolean;
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(50)
  sortOrder?: number;
}
export class UpdateAttendanceCodeDto extends PartialType(AttendanceCodeDto) {}

export class SchoolSettingsDto {
  @ApiProperty({ type: [String], example: ['6', '7', '8'] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(14)
  @IsString({ each: true })
  gradeLevels?: string[];
  @ApiProperty({
    required: false,
    example: '10:00',
    description:
      'Daily attendance deadline in the school timezone; empty disables alerts',
  })
  @IsOptional()
  @Matches(/^(([01]\d|2[0-3]):[0-5]\d)?$/)
  attendanceDeadlineTime?: string;
  @ApiProperty({ required: false, example: 'America/Chicago' })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  timezone?: string;
}
