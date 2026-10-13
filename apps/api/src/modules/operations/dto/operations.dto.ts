import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import {
  COMPONENTS,
  IMPACTS,
  INCIDENT_KINDS,
  INCIDENT_STATUSES,
} from '../operations-rules';

const COMPONENT_KEYS = COMPONENTS.map((c) => c.key);

export class CreateIncidentDto {
  @ApiProperty({ enum: INCIDENT_KINDS, default: 'incident' })
  @IsOptional()
  @IsIn(INCIDENT_KINDS)
  kind?: (typeof INCIDENT_KINDS)[number];

  @ApiProperty()
  @IsString()
  @Length(3, 200)
  title!: string;

  @ApiProperty({ description: 'The first update, shown on the status page' })
  @IsString()
  @Length(1, 2000)
  message!: string;

  @ApiProperty({ enum: IMPACTS, default: 'minor' })
  @IsOptional()
  @IsIn(IMPACTS)
  impact?: (typeof IMPACTS)[number];

  @ApiProperty({ enum: COMPONENT_KEYS, isArray: true })
  @IsArray()
  @IsIn(COMPONENT_KEYS, { each: true })
  components!: string[];

  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiProperty({ required: false, description: 'Maintenance: when it starts' })
  @IsOptional()
  @IsISO8601()
  scheduledFor?: string;

  @ApiProperty({
    required: false,
    description: 'Maintenance: when it should be over',
  })
  @IsOptional()
  @IsISO8601()
  scheduledUntil?: string;
}

export class UpdateIncidentDto {
  @ApiProperty({ enum: INCIDENT_STATUSES, required: false })
  @IsOptional()
  @IsIn(INCIDENT_STATUSES)
  status?: (typeof INCIDENT_STATUSES)[number];

  @ApiProperty({ description: 'What changed, in plain words' })
  @IsString()
  @Length(1, 2000)
  message!: string;

  @ApiProperty({ enum: IMPACTS, required: false })
  @IsOptional()
  @IsIn(IMPACTS)
  impact?: (typeof IMPACTS)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isPublic?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string;
}
