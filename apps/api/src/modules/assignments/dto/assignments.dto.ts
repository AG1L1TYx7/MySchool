import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paged-response.dto';

export const ASSIGNMENT_TYPES = [
  'homework',
  'quiz',
  'test',
  'project',
  'essay',
  'presentation',
  'lab',
  'discussion',
  'practice',
] as const;
export const SUBMISSION_TYPES = [
  'online',
  'paper',
  'in_person',
  'external',
  'no_submission',
] as const;
export const ASSIGNMENT_STATUSES = ['draft', 'published', 'closed'] as const;
export type AssignmentTypeApi = (typeof ASSIGNMENT_TYPES)[number];
export type SubmissionTypeApi = (typeof SUBMISSION_TYPES)[number];
export type AssignmentStatusApi = (typeof ASSIGNMENT_STATUSES)[number];

export class ListAssignmentsQuery extends PagedQueryDto {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  classId?: string;
  @ApiProperty({ required: false, enum: ASSIGNMENT_TYPES })
  @IsOptional()
  @IsIn(ASSIGNMENT_TYPES)
  type?: AssignmentTypeApi;
  @ApiProperty({ required: false, enum: ASSIGNMENT_STATUSES })
  @IsOptional()
  @IsIn(ASSIGNMENT_STATUSES)
  status?: AssignmentStatusApi;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  dueBefore?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  dueAfter?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class CreateAssignmentDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() classId!: string;
  @ApiProperty() @IsString() @Length(2, 200) title!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  description?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20_000)
  instructions?: string;
  @ApiProperty({ required: false, enum: ASSIGNMENT_TYPES, default: 'homework' })
  @IsOptional()
  @IsIn(ASSIGNMENT_TYPES)
  type?: AssignmentTypeApi;
  @ApiProperty({ required: false, enum: SUBMISSION_TYPES, default: 'online' })
  @IsOptional()
  @IsIn(SUBMISSION_TYPES)
  submissionType?: SubmissionTypeApi;
  @ApiProperty({ required: false, example: 'Homework' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;
  @ApiProperty({ required: false, default: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10_000)
  maxPoints?: number;
  @ApiProperty({ required: false, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  weight?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  availableFrom?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  dueAt?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  allowLateUntil?: string;
  @ApiProperty({ required: false, example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  latePenaltyPercent?: number;
  @ApiProperty({ required: false, example: 3 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  maxAttempts?: number;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  rubricId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  h5pContentId?: string;
}

export class UpdateAssignmentDto extends PartialType(CreateAssignmentDto) {}

export class SubmitDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200_000)
  textContent?: string;
  @ApiProperty({ required: false, type: [String], format: 'uuid' })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  fileIds?: string[];
}

export class RubricScoreDto {
  @ApiProperty() @IsString() @MaxLength(100) criterionId!: string;
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10_000)
  points!: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comment?: string;
}

export class GradeSubmissionDto {
  @ApiProperty({ description: 'Raw score before any late penalty' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10_000)
  score!: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(10_000)
  feedback?: string;
  @ApiProperty({ required: false, type: [RubricScoreDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RubricScoreDto)
  rubricScores?: RubricScoreDto[];
  @ApiProperty({
    required: false,
    default: false,
    description: 'Skip the automatic late penalty',
  })
  @IsOptional()
  @IsBoolean()
  waiveLatePenalty?: boolean;
}

export class ListGradesQuery extends PagedQueryDto {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  classId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  assignmentId?: string;
}

export class RubricLevelDto {
  @ApiProperty() @IsString() @Length(1, 100) label!: string;
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10_000)
  points!: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;
}

export class RubricCriterionDto {
  @ApiProperty({
    required: false,
    description: 'Stable id; generated when omitted',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  id?: string;
  @ApiProperty() @IsString() @Length(1, 200) title!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;
  @ApiProperty()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(10_000)
  maxPoints!: number;
  @ApiProperty({ required: false, type: [RubricLevelDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => RubricLevelDto)
  levels?: RubricLevelDto[];
}

export class CreateRubricDto {
  @ApiProperty() @IsString() @Length(2, 200) title!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
  @ApiProperty({ type: [RubricCriterionDto] })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => RubricCriterionDto)
  criteria!: RubricCriterionDto[];
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isTemplate?: boolean;
}

export class UpdateRubricDto extends PartialType(CreateRubricDto) {}
