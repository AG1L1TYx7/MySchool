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
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { TEACHER_MARKS } from '../gradebook-rules';

export const GRADING_MODES = ['points', 'standards'] as const;

export class ClassGradingDto {
  @ApiProperty({ required: false, enum: GRADING_MODES })
  @IsOptional()
  @IsIn(GRADING_MODES)
  gradingMode?: (typeof GRADING_MODES)[number];
  @ApiProperty({ required: false, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  proficiencyScaleId?: string | null;
  @ApiProperty({
    required: false,
    description: 'Shown to students and parents on the class page',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  latePolicy?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50_000)
  syllabus?: string;
}

export class CreateCategoryDto {
  @ApiProperty({ example: 'Homework' })
  @IsString()
  @Length(1, 60)
  name!: string;
  @ApiProperty({ example: 20, description: 'Percent of the final grade' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  weight!: number;
  @ApiProperty({ required: false, default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  dropLowest?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100)
  sortOrder?: number;
}
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

export class SetMarkDto {
  @ApiProperty({
    enum: TEACHER_MARKS,
    nullable: true,
    description: 'null clears the mark',
  })
  @IsOptional()
  @IsIn(TEACHER_MARKS)
  mark?: (typeof TEACHER_MARKS)[number] | null;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ProficiencyLevelDto {
  @ApiProperty({ example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  level!: number;
  @ApiProperty({ example: 'Proficient' })
  @IsString()
  @Length(1, 40)
  label!: string;
  @ApiProperty({
    example: 80,
    description: 'Lowest percentage that maps to this level',
  })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(100)
  minPercent!: number;
}
export class CreateScaleDto {
  @ApiProperty({ example: 'Four levels' })
  @IsString()
  @Length(1, 80)
  name!: string;
  @ApiProperty({ type: [ProficiencyLevelDto] })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => ProficiencyLevelDto)
  levels!: ProficiencyLevelDto[];
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}
export class UpdateScaleDto extends PartialType(CreateScaleDto) {}
