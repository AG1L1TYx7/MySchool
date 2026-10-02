import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';

export const H5P_STATUSES = ['draft', 'published', 'archived'] as const;

export class CreateH5pContentDto {
  @ApiProperty() @IsString() @Length(1, 200) title!: string;
  @ApiProperty({ example: 'H5P.QuestionSet 1.20' })
  @IsString()
  @Length(5, 100)
  library!: string;
  @ApiProperty({ description: 'H5P content parameters for the library' })
  @IsObject()
  parameters!: Record<string, unknown>;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  subject?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 10)
  gradeLevel?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  topic?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  courseId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lessonId?: string;
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'District accounts choose the organisation',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class UpdateH5pContentDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  subject?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 10)
  gradeLevel?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  topic?: string;
}

export class RecordResultDto {
  @ApiProperty() @IsNumber() @Min(0) @Max(100000) score!: number;
  @ApiProperty() @IsNumber() @Min(0) @Max(100000) maxScore!: number;
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  completed?: boolean;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(86_400)
  timeSpentSeconds?: number;
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'Post the result to this assignment as a submission and grade',
  })
  @IsOptional()
  @IsUUID()
  assignmentId?: string;
  @ApiProperty({
    required: false,
    description: 'xAPI statement or other detail',
  })
  @IsOptional()
  @IsObject()
  detail?: Record<string, unknown>;
}

export class ListH5pQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;
  @ApiProperty({ required: false, enum: H5P_STATUSES })
  @IsOptional()
  @IsIn(H5P_STATUSES)
  status?: (typeof H5P_STATUSES)[number];
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  contentType?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
