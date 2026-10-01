import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paged-response.dto';

export const COURSE_STATUSES = [
  'draft',
  'active',
  'archived',
  'under_review',
] as const;
export const LESSON_TYPES = [
  'text',
  'video',
  'document',
  'link',
  'interactive',
] as const;
export type CourseStatusApi = (typeof COURSE_STATUSES)[number];
export type LessonTypeApi = (typeof LESSON_TYPES)[number];

export class ListCoursesQuery extends PagedQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  subject?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  gradeLevel?: string;
  @ApiProperty({ required: false, enum: COURSE_STATUSES })
  @IsOptional()
  @IsIn(COURSE_STATUSES)
  status?: CourseStatusApi;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  instructorId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class CreateCourseDto {
  @ApiProperty({
    required: false,
    description:
      'Unique per organisation; generated from the title when omitted',
  })
  @IsOptional()
  @IsString()
  @Length(2, 50)
  @Matches(/^[A-Za-z0-9._-]+$/, {
    message:
      'courseCode may contain letters, digits, dots, dashes and underscores',
  })
  courseCode?: string;

  @ApiProperty() @IsString() @Length(2, 200) title!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  description?: string;
  @ApiProperty({ required: false, example: 'Mathematics' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  subject?: string;
  @ApiProperty({ required: false, example: '9' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  gradeLevel?: string;
  @ApiProperty({ required: false, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(99)
  creditHours?: number;
  @ApiProperty({ required: false, example: 40 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  estimatedHours?: number;
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'Defaults to the creator when they are a teacher',
  })
  @IsOptional()
  @IsUUID()
  instructorId?: string;
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'District roles choose the organisation',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class UpdateCourseDto extends PartialType(CreateCourseDto) {
  @ApiProperty({ required: false, enum: COURSE_STATUSES })
  @IsOptional()
  @IsIn(COURSE_STATUSES)
  status?: CourseStatusApi;
}

export class CreateModuleDto {
  @ApiProperty() @IsString() @Length(1, 200) title!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  estimatedMinutes?: number;
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdateModuleDto extends PartialType(CreateModuleDto) {}

export class CreateLessonDto {
  @ApiProperty() @IsString() @Length(1, 200) title!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
  @ApiProperty({ required: false, enum: LESSON_TYPES, default: 'text' })
  @IsOptional()
  @IsIn(LESSON_TYPES)
  lessonType?: LessonTypeApi;
  @ApiProperty({
    required: false,
    description: 'Markdown body for text lessons',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2_000_000)
  content?: string;
  @ApiProperty({ required: false, description: 'Video, document or link URL' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  contentUrl?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  durationMinutes?: number;
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpdateLessonDto extends PartialType(CreateLessonDto) {}

export class ReorderDto {
  @ApiProperty({
    type: [String],
    description:
      'Ids in the desired order; every current child must be present',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  ids!: string[];
}

export class SetPrerequisitesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMaxSize(50)
  @IsUUID(undefined, { each: true })
  courseIds!: string[];
}
