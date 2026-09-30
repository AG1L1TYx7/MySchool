import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { PagedQueryDto } from '../../../common/dto/paged-response.dto';

const ROLES = [
  'super_admin',
  'superintendent',
  'principal',
  'teacher',
  'student',
  'parent',
  'assistant',
] as const;
const lower = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class CreateOrganizationDto {
  @ApiProperty() @IsString() @Length(2, 200) name!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @Transform(lower)
  @IsEmail()
  @MaxLength(100)
  email?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;
  @ApiProperty({ required: false, example: 'America/New_York' })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class UpdateOrganizationDto extends PartialType(CreateOrganizationDto) {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ListOrganizationsQuery extends PagedQueryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
  @ApiProperty({ required: false, default: false })
  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  includeInactive?: boolean;
}

export class ListMembersQuery extends PagedQueryDto {
  @ApiProperty({ required: false, enum: ROLES })
  @IsOptional()
  @IsIn(ROLES)
  role?: (typeof ROLES)[number];
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;
}

export class AddMemberDto {
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'Existing user id; or give an email',
  })
  @ValidateIf((o: AddMemberDto) => !o.email)
  @IsUUID()
  userId?: string;

  @ApiProperty({ required: false })
  @ValidateIf((o: AddMemberDto) => !o.userId)
  @Transform(lower)
  @IsEmail()
  @MaxLength(256)
  email?: string;

  @ApiProperty({
    required: false,
    enum: ROLES,
    description: "Change the user's role while linking",
  })
  @IsOptional()
  @IsIn(ROLES)
  role?: (typeof ROLES)[number];
}
