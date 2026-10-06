import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const LANGUAGES = ['en', 'es'] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class GeneratePlanDto {
  @ApiProperty() @IsString() @Length(2, 200) topic!: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  classId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  courseId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lessonId?: string;
  @ApiProperty({ required: false, default: 45, minimum: 10, maximum: 240 })
  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(240)
  durationMinutes?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  standard?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  gradeLevel?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  subject?: string;
  @ApiProperty({ required: false, enum: LANGUAGES })
  @IsOptional()
  @IsIn(LANGUAGES)
  language?: (typeof LANGUAGES)[number];
}

export class UpdatePlanDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;
  @ApiProperty({
    required: false,
    description: 'The edited plan body (same shape the AI produced)',
  })
  @IsOptional()
  @IsObject()
  content?: Record<string, unknown>;
  @ApiProperty({ required: false, enum: ['draft', 'published'] })
  @IsOptional()
  @IsIn(['draft', 'published'])
  status?: 'draft' | 'published';
  @ApiProperty({
    required: false,
    description: 'YYYY-MM-DD, or empty to unschedule',
  })
  @IsOptional()
  @IsString()
  @Matches(/^(\d{4}-\d{2}-\d{2})?$/)
  scheduledOn?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  classId?: string;
}

export class ApproveSuggestionDto {
  @ApiProperty({
    required: false,
    description: 'Override the suggested score (assignment points)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  score?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  feedback?: string;
}

export class ParentEmailDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() studentId!: string;
  @ApiProperty({ example: 'share good news about this week' })
  @IsString()
  @Length(3, 200)
  purpose!: string;
  @ApiProperty({ required: false, example: 'warm and specific' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  tone?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  topic?: string;
  @ApiProperty({ required: false, enum: LANGUAGES })
  @IsOptional()
  @IsIn(LANGUAGES)
  language?: (typeof LANGUAGES)[number];
}

export class NarrativeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() studentId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() classId!: string;
  @ApiProperty({ required: false, enum: LANGUAGES })
  @IsOptional()
  @IsIn(LANGUAGES)
  language?: (typeof LANGUAGES)[number];
}

export class BulkNarrativeDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() classId!: string;
  @ApiProperty({ required: false, enum: LANGUAGES })
  @IsOptional()
  @IsIn(LANGUAGES)
  language?: (typeof LANGUAGES)[number];
}

export class DifferentiationDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() lessonId!: string;
  @ApiProperty({ required: false, enum: LANGUAGES })
  @IsOptional()
  @IsIn(LANGUAGES)
  language?: (typeof LANGUAGES)[number];
}

export class UpdateDraftDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsObject() content?: Record<
    string,
    unknown
  >;
  @ApiProperty({ required: false, enum: ['draft', 'used'] })
  @IsOptional()
  @IsIn(['draft', 'used'])
  status?: 'draft' | 'used';
}

export class PracticeSetDto {
  @ApiProperty({
    required: false,
    description: 'Defaults to the topic the class is stuck on',
  })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  topic?: string;
  @ApiProperty({ required: false, minimum: 3, maximum: 15, default: 5 })
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(15)
  count?: number;
}

export class UpdateInsightDto {
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'The practice set that was generated for it',
  })
  @IsOptional()
  @IsUUID()
  practiceContentId?: string;
}

export class SubstituteDto {
  @ApiProperty({
    format: 'uuid',
    description: 'A teacher or assistant of the school',
  })
  @IsUUID()
  userId!: string;
  @ApiProperty() @IsISO8601() startsAt!: string;
  @ApiProperty() @IsISO8601() endsAt!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class PlannerQuery {
  @ApiProperty({
    required: false,
    example: '2026-10-05',
    description: 'Any day in the week wanted',
  })
  @IsOptional()
  @Matches(DATE)
  week?: string;
}
