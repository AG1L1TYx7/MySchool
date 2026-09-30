import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paged-response.dto';

export const ENROLLMENT_STATUSES = [
  'active',
  'inactive',
  'graduated',
  'transferred',
  'withdrawn',
  'suspended',
] as const;
export const LEARNING_STYLES = [
  'visual',
  'auditory',
  'kinesthetic',
  'reading_writing',
  'mixed',
] as const;
export const RELATIONSHIPS = [
  'mother',
  'father',
  'guardian',
  'grandparent',
  'sibling',
  'other',
] as const;
export type EnrollmentStatusApi = (typeof ENROLLMENT_STATUSES)[number];
export type LearningStyleApi = (typeof LEARNING_STYLES)[number];
export type RelationshipApi = (typeof RELATIONSHIPS)[number];

const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;
const bool = ({ value }: { value: unknown }) =>
  value === true || value === 'true';

export class ListStudentsQuery extends PagedQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiProperty({ required: false, example: '7' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  gradeLevel?: string;
  @ApiProperty({ required: false, enum: ENROLLMENT_STATUSES })
  @IsOptional()
  @IsIn(ENROLLMENT_STATUSES)
  status?: EnrollmentStatusApi;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class CreateStudentDto {
  @ApiProperty({
    required: false,
    description: 'Unique per organisation; generated when omitted',
  })
  @IsOptional()
  @IsString()
  @Length(1, 50)
  @Matches(/^[A-Za-z0-9._/-]+$/, {
    message:
      'studentNumber may contain letters, digits, dots, dashes, underscores and slashes',
  })
  studentNumber?: string;

  @ApiProperty() @IsString() @Length(1, 100) firstName!: string;
  @ApiProperty() @IsString() @Length(1, 100) lastName!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(lower)
  @IsEmail()
  @MaxLength(256)
  email?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
  @ApiProperty({ required: false, example: '2012-09-01' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  gender?: string;
  @ApiProperty({ required: false, example: '7' })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  gradeLevel?: string;
  @ApiProperty({
    required: false,
    enum: ENROLLMENT_STATUSES,
    default: 'active',
  })
  @IsOptional()
  @IsIn(ENROLLMENT_STATUSES)
  enrollmentStatus?: EnrollmentStatusApi;
  @ApiProperty({ required: false, example: '2026-09-01' })
  @IsOptional()
  @IsDateString()
  enrollmentDate?: string;
  @ApiProperty({ required: false, enum: LEARNING_STYLES })
  @IsOptional()
  @IsIn(LEARNING_STYLES)
  preferredLearningStyle?: LearningStyleApi;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  accessibilityNeeds?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  goals?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  notes?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'District roles choose the organisation',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'Link an existing student account',
  })
  @IsOptional()
  @IsUUID()
  userId?: string;
  @ApiProperty({
    required: false,
    default: false,
    description:
      'Create a sign-in account and email an invitation (needs email)',
  })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  createAccount?: boolean;
}

export class UpdateStudentDto extends PartialType(CreateStudentDto) {}

export class AddGuardianDto {
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'Existing parent account; or give an email',
  })
  @ValidateIf((o: AddGuardianDto) => !o.email)
  @IsUUID()
  guardianUserId?: string;

  @ApiProperty({
    required: false,
    description:
      'Existing user by email, or a new parent account that is invited',
  })
  @ValidateIf((o: AddGuardianDto) => !o.guardianUserId)
  @Transform(lower)
  @IsEmail()
  @MaxLength(256)
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  firstName?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  lastName?: string;
  @ApiProperty({ required: false, enum: RELATIONSHIPS, default: 'guardian' })
  @IsOptional()
  @IsIn(RELATIONSHIPS)
  relationship?: RelationshipApi;
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  receivesNotifications?: boolean;
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  canViewGrades?: boolean;
  @ApiProperty({ required: false, default: true })
  @IsOptional()
  @IsBoolean()
  canViewAttendance?: boolean;
}

export class UpdateGuardianDto {
  @ApiProperty({ required: false, enum: RELATIONSHIPS })
  @IsOptional()
  @IsIn(RELATIONSHIPS)
  relationship?: RelationshipApi;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isPrimary?: boolean;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  receivesNotifications?: boolean;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  canViewGrades?: boolean;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  canViewAttendance?: boolean;
}

export class ImportStudentsDto {
  @ApiProperty({
    description:
      'CSV text with a header row (see GET /students/import/template)',
  })
  @IsString()
  @MaxLength(10_000_000)
  csv!: string;

  @ApiProperty({
    required: false,
    default: false,
    description: 'Validate and report without writing',
  })
  @IsOptional()
  @Transform(bool)
  @IsBoolean()
  dryRun?: boolean;

  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'District roles choose the organisation',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}
