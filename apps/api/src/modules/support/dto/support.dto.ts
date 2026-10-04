import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paged-response.dto';
import { AI_CONSENT_DEFAULTS, BEHAVIOR_VISIBILITIES } from '../support-rules';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const PLANS = ['iep', 'section_504', 'other'] as const;
export const BEHAVIOR_KINDS = ['positive', 'concern', 'incident'] as const;
export const WELLNESS_STATUSES = ['open', 'acknowledged', 'resolved'] as const;
export const CONSENT_STATUSES = ['granted', 'declined', 'pending'] as const;

export class AccommodationDto {
  @ApiProperty({ enum: PLANS }) @IsIn(PLANS) plan!: (typeof PLANS)[number];
  @ApiProperty({
    example: 50,
    description: 'Percent more time on due dates and timed activities',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(300)
  extendedTimePercent?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  readAloud?: boolean;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  largeText?: boolean;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  reducedMotion?: boolean;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  reducedDistraction?: boolean;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @Matches(DATE)
  startDate?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @Matches(DATE)
  endDate?: string;
}

export class CaseloadDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() studentId!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}

export class CounselorNoteDto {
  @ApiProperty() @IsString() @Length(1, 10_000) body!: string;
}

export class WellnessUpdateDto {
  @ApiProperty({ required: false, enum: WELLNESS_STATUSES })
  @IsOptional()
  @IsIn(WELLNESS_STATUSES)
  status?: (typeof WELLNESS_STATUSES)[number];
  @ApiProperty({ required: false, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  assignedToId?: string | null;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  resolution?: string;
}

export class ListWellnessQuery extends PagedQueryDto {
  @ApiProperty({ required: false, enum: WELLNESS_STATUSES })
  @IsOptional()
  @IsIn(WELLNESS_STATUSES)
  status?: (typeof WELLNESS_STATUSES)[number];
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class BehaviorRecordDto {
  @ApiProperty({ enum: BEHAVIOR_KINDS })
  @IsIn(BEHAVIOR_KINDS)
  kind!: (typeof BEHAVIOR_KINDS)[number];
  @ApiProperty({ example: 'Helped a classmate' })
  @IsString()
  @Length(1, 200)
  title!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;
  @ApiProperty({ format: 'date-time' }) @IsDateString() occurredAt!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  location?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  actionTaken?: string;
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'Override the school rule for this record',
  })
  @IsOptional()
  @IsBoolean()
  parentVisible?: boolean | null;
}
export class UpdateBehaviorRecordDto extends PartialType(BehaviorRecordDto) {}

export class AiConsentDto {
  @ApiProperty({ enum: ['granted', 'declined'] })
  @IsIn(['granted', 'declined'])
  status!: 'granted' | 'declined';
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class SupportSettingsDto {
  @ApiProperty({ required: false, enum: BEHAVIOR_VISIBILITIES })
  @IsOptional()
  @IsIn(BEHAVIOR_VISIBILITIES)
  behaviorVisibility?: string;
  @ApiProperty({ required: false, enum: AI_CONSENT_DEFAULTS })
  @IsOptional()
  @IsIn(AI_CONSENT_DEFAULTS)
  aiConsentDefault?: string;
  @ApiProperty({
    required: false,
    description: 'Allow students to message classmates directly',
  })
  @IsOptional()
  @IsBoolean()
  studentMessaging?: boolean;
}
