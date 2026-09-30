import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  MaxLength,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paged-response.dto';
import { PasswordService } from '../../auth/password.service';

const ROLES = [
  'super_admin',
  'superintendent',
  'principal',
  'teacher',
  'student',
  'parent',
  'assistant',
] as const;
const STATUSES = ['active', 'inactive', 'locked'] as const;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class ListUsersQuery extends PagedQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiProperty({ required: false, enum: ROLES })
  @IsOptional()
  @IsIn(ROLES)
  role?: (typeof ROLES)[number];
  @ApiProperty({ required: false, enum: STATUSES })
  @IsOptional()
  @IsIn(STATUSES)
  status?: (typeof STATUSES)[number];
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class CreateUserDto {
  @ApiProperty() @Transform(lower) @IsEmail() @MaxLength(256) email!: string;
  @ApiProperty() @IsString() @Length(1, 100) firstName!: string;
  @ApiProperty() @IsString() @Length(1, 100) lastName!: string;
  @ApiProperty({ enum: ROLES }) @IsIn(ROLES) role!: (typeof ROLES)[number];
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
  @ApiProperty({
    required: false,
    description: 'Omit to send an invitation email with a reset code',
  })
  @IsOptional()
  @IsString()
  @Matches(PasswordService.POLICY, {
    message:
      'Password must be 12 to 128 characters with upper and lower case letters, a digit and a symbol.',
  })
  password?: string;
}

export class UpdateUserDto {
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
  @ApiProperty({ required: false, enum: ROLES })
  @IsOptional()
  @IsIn(ROLES)
  role?: (typeof ROLES)[number];
  @ApiProperty({ required: false, enum: ['active', 'inactive'] })
  @IsOptional()
  @IsIn(['active', 'inactive'])
  status?: 'active' | 'inactive';
  @ApiProperty({ required: false, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;
}
