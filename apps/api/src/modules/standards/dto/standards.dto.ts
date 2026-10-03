import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
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

export class CreateSetDto {
  @ApiProperty({ example: 'TEKS-MATH' })
  @IsString()
  @Length(2, 40)
  code!: string;
  @ApiProperty({ example: 'Texas Essential Knowledge and Skills: Mathematics' })
  @IsString()
  @Length(2, 200)
  name!: string;
  @ApiProperty({ required: false, example: 'Mathematics' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  subject?: string;
  @ApiProperty({ required: false, example: 'Texas' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  jurisdiction?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  sourceUri?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  version?: string;
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'Omit (district roles) for a set shared by every school',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class ImportCaseDto {
  @ApiProperty({
    required: false,
    example: 'CCSS-MATH',
    description: 'Code for the new set; defaults to the document title',
  })
  @IsOptional()
  @IsString()
  @Length(2, 40)
  code?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class CreateStandardDto {
  @ApiProperty({ example: 'CCSS.MATH.CONTENT.7.EE.A.1' })
  @IsString()
  @Length(1, 80)
  code!: string;
  @ApiProperty() @IsString() @Length(1, 4000) description!: string;
  @ApiProperty({ required: false, example: '7' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  gradeLevels?: string;
  @ApiProperty({
    required: false,
    description: 'Code of the parent standard in the same set',
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  parentCode?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(100_000)
  sortOrder?: number;
}

export class ListSetsQuery {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class ListStandardsQuery extends PagedQueryDto {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  setId?: string;
  @ApiProperty({ required: false, example: '7' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  gradeLevel?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  search?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
