import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paged-response.dto';
import {
  ATTENDANCE_STATUSES,
  type AttendanceStatusApi,
} from '../attendance-rules';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ListAttendanceQuery extends PagedQueryDto {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  classId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
  @ApiProperty({ required: false, example: '2026-10-01' })
  @IsOptional()
  @Matches(DATE)
  date?: string;
  @ApiProperty({ required: false, example: '2026-09-01' })
  @IsOptional()
  @Matches(DATE)
  from?: string;
  @ApiProperty({ required: false, example: '2026-12-18' })
  @IsOptional()
  @Matches(DATE)
  to?: string;
}

export class SummaryQuery {
  @ApiProperty({ required: false }) @IsOptional() @Matches(DATE) from?: string;
  @ApiProperty({ required: false }) @IsOptional() @Matches(DATE) to?: string;
}

export class MarkAttendanceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() classId!: string;
  @ApiProperty({ format: 'uuid' }) @IsUUID() studentId!: string;
  @ApiProperty({ example: '2026-10-01' }) @Matches(DATE) date!: string;
  @ApiProperty({ enum: ATTENDANCE_STATUSES })
  @IsIn(ATTENDANCE_STATUSES)
  status!: AttendanceStatusApi;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class BulkRecordDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() studentId!: string;
  @ApiProperty({ enum: ATTENDANCE_STATUSES })
  @IsIn(ATTENDANCE_STATUSES)
  status!: AttendanceStatusApi;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class BulkAttendanceDto {
  @ApiProperty({ format: 'uuid' }) @IsUUID() classId!: string;
  @ApiProperty({ example: '2026-10-01' }) @Matches(DATE) date!: string;
  @ApiProperty({ type: [BulkRecordDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => BulkRecordDto)
  records!: BulkRecordDto[];
}

export class UpdateAttendanceDto {
  @ApiProperty({ required: false, enum: ATTENDANCE_STATUSES })
  @IsOptional()
  @IsIn(ATTENDANCE_STATUSES)
  status?: AttendanceStatusApi;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsDateString()
  _unused?: string;
}
