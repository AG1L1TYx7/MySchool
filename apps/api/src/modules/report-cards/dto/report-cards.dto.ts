import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paged-response.dto';

export const REPORT_CARD_KINDS = ['report_card', 'progress'] as const;
export const REPORT_CARD_STATUSES = ['draft', 'published'] as const;

export class GenerateReportCardsDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() gradingPeriodId!: string;
  @ApiProperty({
    required: false,
    enum: REPORT_CARD_KINDS,
    default: 'report_card',
  })
  @IsOptional()
  @IsIn(REPORT_CARD_KINDS)
  kind?: (typeof REPORT_CARD_KINDS)[number];
  @ApiProperty({
    required: false,
    format: 'uuid',
    description:
      'Only this class (teachers must give one); administrators may omit it for the whole school',
  })
  @IsOptional()
  @IsUUID()
  classId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class PublishReportCardsDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() gradingPeriodId!: string;
  @ApiProperty({
    required: false,
    enum: REPORT_CARD_KINDS,
    default: 'report_card',
  })
  @IsOptional()
  @IsIn(REPORT_CARD_KINDS)
  kind?: (typeof REPORT_CARD_KINDS)[number];
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class CommentDto {
  @ApiProperty() @IsString() @MaxLength(2000) comment!: string;
}

export class ListReportCardsQuery extends PagedQueryDto {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  gradingPeriodId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  classId?: string;
  @ApiProperty({ required: false, enum: REPORT_CARD_STATUSES })
  @IsOptional()
  @IsIn(REPORT_CARD_STATUSES)
  status?: (typeof REPORT_CARD_STATUSES)[number];
  @ApiProperty({ required: false, enum: REPORT_CARD_KINDS })
  @IsOptional()
  @IsIn(REPORT_CARD_KINDS)
  kind?: (typeof REPORT_CARD_KINDS)[number];
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
