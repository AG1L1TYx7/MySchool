import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paged-response.dto';

export const CLASS_STATUSES = [
  'scheduled',
  'in_progress',
  'completed',
  'cancelled',
] as const;
export const CLASS_ENROLLMENT_STATUSES = [
  'enrolled',
  'waitlisted',
  'dropped',
  'completed',
] as const;
export type ClassStatusApi = (typeof CLASS_STATUSES)[number];
export type ClassEnrollmentStatusApi =
  (typeof CLASS_ENROLLMENT_STATUSES)[number];

export class ListClassesQuery extends PagedQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiProperty({ required: false, example: '2026-Fall' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  term?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  courseId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  teacherId?: string;
  @ApiProperty({ required: false, enum: CLASS_STATUSES })
  @IsOptional()
  @IsIn(CLASS_STATUSES)
  status?: ClassStatusApi;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class CreateClassDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() courseId!: string;
  @ApiProperty({ example: 'Algebra I - Section A' })
  @IsString()
  @Length(2, 200)
  name!: string;
  @ApiProperty({ required: false, example: 'A' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  section?: string;
  @ApiProperty({ example: '2026-Fall' })
  @IsString()
  @Length(2, 50)
  term!: string;
  @ApiProperty({ required: false, example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  startDate?: string;
  @ApiProperty({ required: false, example: '2026-12-18' })
  @IsOptional()
  @IsDateString()
  endDate?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  room?: string;
  @ApiProperty({ required: false, example: 'Mon/Wed/Fri 09:00-09:50' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  meetingSchedule?: string;
  @ApiProperty({ required: false, example: 25 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  maxStudents?: number;
  @ApiProperty({ required: false, enum: CLASS_STATUSES, default: 'scheduled' })
  @IsOptional()
  @IsIn(CLASS_STATUSES)
  status?: ClassStatusApi;
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'Primary teacher to assign on creation',
  })
  @IsOptional()
  @IsUUID()
  teacherId?: string;
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'District roles choose the organisation',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class UpdateClassDto extends PartialType(CreateClassDto) {}

export class AddTeacherDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() teacherId!: string;
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
}

export class EnrollDto {
  @ApiProperty({ type: [String], format: 'uuid' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  studentIds!: string[];
}

export class UpdateEnrollmentDto {
  @ApiProperty({ enum: CLASS_ENROLLMENT_STATUSES })
  @IsIn(CLASS_ENROLLMENT_STATUSES)
  status!: ClassEnrollmentStatusApi;
}
