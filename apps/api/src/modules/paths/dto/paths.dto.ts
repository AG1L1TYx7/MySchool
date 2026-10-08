import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PATH_STATUSES, STEP_KINDS, STEP_STATUSES } from '../paths-rules';

export class StepInputDto {
  @ApiProperty({ enum: STEP_KINDS })
  @IsIn(STEP_KINDS)
  kind!: (typeof STEP_KINDS)[number];

  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'Lesson, interactive content, library item or assignment id',
  })
  @IsOptional()
  @IsUUID()
  refId?: string;

  @ApiProperty()
  @IsString()
  @Length(2, 200)
  title!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  standardCode?: string;
}

export class CreatePathDto {
  @ApiProperty()
  @IsString()
  @Length(2, 200)
  title!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  goal?: string;

  @ApiProperty({ type: [StepInputDto] })
  @IsArray()
  @ArrayMaxSize(30)
  @ValidateNested({ each: true })
  @Type(() => StepInputDto)
  steps!: StepInputDto[];
}

export class GeneratePathDto {
  @ApiProperty({
    required: false,
    description: 'Limit the gaps to one subject',
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  subject?: string;
}

export class UpdatePathDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  goal?: string;

  @ApiProperty({ required: false, enum: PATH_STATUSES })
  @IsOptional()
  @IsIn(PATH_STATUSES)
  status?: (typeof PATH_STATUSES)[number];
}

export class UpdateStepDto {
  @ApiProperty({ required: false, enum: STEP_STATUSES })
  @IsOptional()
  @IsIn(STEP_STATUSES)
  status?: (typeof STEP_STATUSES)[number];

  @ApiProperty({
    required: false,
    description: 'Move to this position (1-based)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  position?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
