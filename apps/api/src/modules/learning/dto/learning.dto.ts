import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateCardDto {
  @ApiProperty() @IsString() @Length(1, 2000) front!: string;
  @ApiProperty() @IsString() @Length(1, 4000) back!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  hint?: string;
}

export class ReviewCardDto {
  @ApiProperty({
    minimum: 0,
    maximum: 5,
    description: '0 blackout … 5 perfect (SM-2)',
  })
  @IsInt()
  @Min(0)
  @Max(5)
  quality!: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(3_600_000)
  durationMs?: number;
}

const VERBS = [
  'experienced',
  'attempted',
  'answered',
  'completed',
  'passed',
  'failed',
  'interacted',
  'progressed',
] as const;
const OBJECTS = ['h5p-content', 'lesson', 'assignment', 'srs-card'] as const;

export class StatementsQuery {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  objectId?: string;
  @ApiProperty({ required: false, enum: OBJECTS })
  @IsOptional()
  @IsIn(OBJECTS)
  objectType?: (typeof OBJECTS)[number];
  @ApiProperty({ required: false, enum: VERBS })
  @IsOptional()
  @IsIn(VERBS)
  verb?: (typeof VERBS)[number];
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601() since?: string;
  @ApiProperty({ required: false }) @IsOptional() @IsISO8601() until?: string;
  @ApiProperty({ required: false, default: 50, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class ExportQuery {
  @ApiProperty({
    required: false,
    description: 'Only statements stored after this time',
  })
  @IsOptional()
  @IsISO8601()
  since?: string;
  @ApiProperty({ required: false, default: 1000, maximum: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;
}
