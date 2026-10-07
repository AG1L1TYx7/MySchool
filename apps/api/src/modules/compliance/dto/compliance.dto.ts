import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
} from 'class-validator';
import { INCIDENT_SEVERITIES, INCIDENT_STATUSES } from '../compliance-rules';

export class RetentionDto {
  @ApiProperty({
    required: false,
    description: 'Days; see bounds in the data map',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  aiConversations?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  notifications?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  auditLogs?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  learningRecords?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  pushLogs?: number;
  @ApiProperty({
    required: false,
    description: '0 keeps withdrawn students until a deletion request',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(3650)
  withdrawnStudents?: number;
}

export class CreateDeletionRequestDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  reason?: string;
}

export class DecideDeletionDto {
  @ApiProperty({ enum: ['approve', 'reject'] })
  @IsIn(['approve', 'reject'])
  decision!: 'approve' | 'reject';
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 1000)
  note?: string;
}

export class LegalHoldDto {
  @ApiProperty() @IsBoolean() legalHold!: boolean;
}

export class CreateIncidentDto {
  @ApiProperty() @IsString() @Length(3, 200) title!: string;
  @ApiProperty({ enum: INCIDENT_SEVERITIES })
  @IsIn(INCIDENT_SEVERITIES)
  severity!: (typeof INCIDENT_SEVERITIES)[number];
  @ApiProperty() @IsString() @Length(1, 10000) summary!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsISO8601()
  detectedAt?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  affectedCount?: number;
  @ApiProperty({
    required: false,
    description: 'Comma-separated data categories, for the notice',
  })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  dataCategories?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsString()
  organizationId?: string;
}

export class UpdateIncidentDto {
  @ApiProperty({ required: false, enum: INCIDENT_STATUSES })
  @IsOptional()
  @IsIn(INCIDENT_STATUSES)
  status?: (typeof INCIDENT_STATUSES)[number];
  @ApiProperty({ required: false, enum: INCIDENT_SEVERITIES })
  @IsOptional()
  @IsIn(INCIDENT_SEVERITIES)
  severity?: (typeof INCIDENT_SEVERITIES)[number];
  @ApiProperty({ required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  affectedCount?: number;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 500)
  dataCategories?: string;
  @ApiProperty({ required: false, description: 'A timeline entry' })
  @IsOptional()
  @IsString()
  @Length(1, 2000)
  note?: string;
}
