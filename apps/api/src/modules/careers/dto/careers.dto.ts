import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  COLLEGE_PLAN_STATUSES,
  PORTFOLIO_VISIBILITIES,
  PROJECT_KINDS,
} from '../careers-rules';

export class UpdatePortfolioDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  headline?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  about?: string;

  @ApiProperty({ required: false, enum: PORTFOLIO_VISIBILITIES })
  @IsOptional()
  @IsIn(PORTFOLIO_VISIBILITIES)
  visibility?: (typeof PORTFOLIO_VISIBILITIES)[number];

  @ApiProperty({
    required: false,
    description:
      'Public address label; made from the name when public and empty',
  })
  @IsOptional()
  @IsString()
  @MaxLength(63)
  slug?: string;
}

export class ProjectDto {
  @ApiProperty()
  @IsString()
  @Length(2, 200)
  title!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  summary?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty({ required: false, enum: PROJECT_KINDS })
  @IsOptional()
  @IsIn(PROJECT_KINDS)
  kind?: (typeof PROJECT_KINDS)[number];

  @ApiProperty({ required: false, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  skills?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  reflection?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  externalUrl?: string;

  @ApiProperty({ required: false, format: 'date' })
  @IsOptional()
  @IsDateString()
  completedOn?: string;

  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'A submission of yours to show as evidence',
  })
  @IsOptional()
  @IsUUID()
  sourceSubmissionId?: string;

  @ApiProperty({
    required: false,
    isArray: true,
    format: 'uuid',
    description: 'Files you uploaded, in order',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID(undefined, { each: true })
  fileIds?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  featured?: boolean;

  @ApiProperty({ required: false, enum: ['draft', 'published'] })
  @IsOptional()
  @IsIn(['draft', 'published'])
  status?: 'draft' | 'published';
}

export class UpdateProjectDto extends ProjectDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  declare title: string;
}

export class ReviewProjectDto {
  @ApiProperty()
  @IsString()
  @Length(2, 2000)
  comment!: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  stars?: number;
}

export class SetSkillDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  skillId!: string;

  @ApiProperty({ minimum: 1, maximum: 4 })
  @IsInt()
  @Min(1)
  @Max(4)
  level!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class EndorseDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class CreateSkillDto {
  @ApiProperty()
  @IsString()
  @Length(2, 100)
  name!: string;

  @ApiProperty()
  @IsString()
  @Length(2, 50)
  category!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
}

export class CollegePlanDto {
  @ApiProperty()
  @IsString()
  @Length(2, 200)
  name!: string;

  @ApiProperty({ enum: COLLEGE_PLAN_STATUSES })
  @IsIn(COLLEGE_PLAN_STATUSES)
  status!: (typeof COLLEGE_PLAN_STATUSES)[number];

  @ApiProperty({ required: false, format: 'date' })
  @IsOptional()
  @IsDateString()
  deadline?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class UpdateCareerDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  goals?: string;

  @ApiProperty({
    required: false,
    isArray: true,
    description: 'Career cluster ids chosen to explore',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  pathways?: string[];

  @ApiProperty({ required: false, type: [CollegePlanDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => CollegePlanDto)
  collegePlans?: CollegePlanDto[];
}

export class InventoryDto {
  @ApiProperty({
    description: 'Answers by statement id, 1 (not me) to 5 (very much me)',
  })
  @IsObject()
  answers!: Record<string, number>;
}

export class ChecklistTickDto {
  @ApiProperty()
  @IsString()
  @MaxLength(50)
  key!: string;

  @ApiProperty()
  @IsBoolean()
  done!: boolean;
}

export class RunCodeDto {
  @ApiProperty()
  @IsString()
  @MaxLength(20_000)
  source!: string;
}

export class CreateCodeLessonDto {
  @ApiProperty()
  @IsString()
  @Length(2, 200)
  title!: string;

  @ApiProperty()
  @IsString()
  @MaxLength(5000)
  description!: string;

  @ApiProperty({ required: false, minimum: 1, maximum: 5 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  level?: number;

  @ApiProperty()
  @IsString()
  @MaxLength(20_000)
  starter!: string;

  @ApiProperty({ description: '[{ expr, expected (JSON text), label? }]' })
  @IsArray()
  @ArrayMaxSize(20)
  @IsObject({ each: true })
  tests!: Array<{ expr: string; expected: string; label?: string }>;
}
