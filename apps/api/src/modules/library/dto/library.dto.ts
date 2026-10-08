import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paged-response.dto';
import {
  FLAG_REASONS,
  ITEM_STATUSES,
  LIBRARY_KINDS,
  VISIBILITIES,
} from '../library-rules';

export class ListLibraryQuery extends PagedQueryDto {
  @ApiProperty({
    required: false,
    description: 'Words in the title, description or keywords',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;

  @ApiProperty({ required: false, enum: LIBRARY_KINDS })
  @IsOptional()
  @IsIn(LIBRARY_KINDS)
  kind?: (typeof LIBRARY_KINDS)[number];

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

  @ApiProperty({
    required: false,
    description: 'true: only items I created, any status',
  })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  mine?: boolean;

  @ApiProperty({
    required: false,
    enum: ITEM_STATUSES,
    description: 'With mine=true: filter by status',
  })
  @IsOptional()
  @IsIn(ITEM_STATUSES)
  status?: (typeof ITEM_STATUSES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  featured?: boolean;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  collectionId?: string;
}

export class SearchLibraryQuery {
  @ApiProperty({ example: 'fractions practice for fifth grade' })
  @IsString()
  @Length(2, 300)
  q!: string;

  @ApiProperty({ required: false, enum: LIBRARY_KINDS })
  @IsOptional()
  @IsIn(LIBRARY_KINDS)
  kind?: (typeof LIBRARY_KINDS)[number];

  @ApiProperty({ required: false, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

class ItemFields {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

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

  @ApiProperty({ required: false, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  topics?: string[];

  @ApiProperty({
    required: false,
    isArray: true,
    description: 'Standard codes, for example CCSS.MATH.5.NF.1',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  standards?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  keywords?: string;

  @ApiProperty({ required: false, enum: VISIBILITIES })
  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: (typeof VISIBILITIES)[number];

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  h5pContentId?: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  fileId?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lessonPlanId?: string;

  @ApiProperty({
    required: false,
    description: 'Administrators: pin to the top',
  })
  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}

export class CreateLibraryItemDto extends ItemFields {
  @ApiProperty({ enum: LIBRARY_KINDS })
  @IsIn(LIBRARY_KINDS)
  kind!: (typeof LIBRARY_KINDS)[number];

  @ApiProperty()
  @IsString()
  @Length(2, 200)
  declare title: string;
}

export class UpdateLibraryItemDto extends ItemFields {
  @ApiProperty({
    required: false,
    description: 'Interactive content only: new parameters stored as a version',
  })
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  versionNote?: string;
}

export class ReviewItemDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class FlagItemDto {
  @ApiProperty({ enum: FLAG_REASONS })
  @IsIn(FLAG_REASONS)
  reason!: (typeof FLAG_REASONS)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  details?: string;
}

export class ResolveFlagDto {
  @ApiProperty({ enum: ['dismiss', 'unpublish'] })
  @IsIn(['dismiss', 'unpublish'])
  action!: 'dismiss' | 'unpublish';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class RateItemDto {
  @ApiProperty({ minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  stars!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}

export class CreateCollectionDto {
  @ApiProperty()
  @IsString()
  @Length(2, 200)
  title!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ required: false, enum: VISIBILITIES })
  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: (typeof VISIBILITIES)[number];
}

export class UpdateCollectionDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ required: false, enum: VISIBILITIES })
  @IsOptional()
  @IsIn(VISIBILITIES)
  visibility?: (typeof VISIBILITIES)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  featured?: boolean;
}

export class AddCollectionItemDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId!: string;
}
