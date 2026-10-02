import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export const DIFFICULTIES = ['easy', 'medium', 'hard', 'mixed'] as const;
export const QUESTION_TYPES = [
  'multiple_choice',
  'true_false',
  'fill_blank',
] as const;

export class GenerateContentDto {
  @ApiProperty({ example: 'Solving one-step equations' })
  @IsString()
  @Length(2, 200)
  topic!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  subject?: string;
  @ApiProperty({ required: false, example: '7' })
  @IsOptional()
  @IsString()
  @Length(1, 10)
  gradeLevel?: string;
  @ApiProperty({ required: false, default: 10, minimum: 3, maximum: 30 })
  @IsOptional()
  @IsInt()
  @Min(3)
  @Max(30)
  count?: number;
  @ApiProperty({ required: false, enum: DIFFICULTIES, default: 'mixed' })
  @IsOptional()
  @IsIn(DIFFICULTIES)
  difficulty?: (typeof DIFFICULTIES)[number];
  @ApiProperty({ required: false, enum: QUESTION_TYPES, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @IsIn(QUESTION_TYPES, { each: true })
  questionTypes?: Array<(typeof QUESTION_TYPES)[number]>;
  @ApiProperty({
    required: false,
    description: 'Standard or learning objective to align with',
  })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  standard?: string;
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'Lesson whose text becomes the source material',
  })
  @IsOptional()
  @IsUUID()
  lessonId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  courseId?: string;
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'District accounts choose the organisation',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class RegenerateDto {
  @ApiProperty({ description: "What to change, in the teacher's words" })
  @IsString()
  @Length(3, 2000)
  feedback!: string;
}
