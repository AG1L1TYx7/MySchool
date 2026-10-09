import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
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
import {
  GROUP_KINDS,
  GROUP_VISIBILITIES,
  JOIN_POLICIES,
  MAX_BODY_LENGTH,
  MAX_MUTE_DAYS,
  MAX_TITLE_LENGTH,
  MEMBER_ROLES,
  MODERATION_ACTIONS,
  REACTION_KINDS,
  REPORT_REASONS,
  REPORT_RESOLUTIONS,
} from '../community-rules';

const CREATABLE_KINDS = GROUP_KINDS.filter((k) => k !== 'class');

export class ListGroupsQuery extends PagedQueryDto {
  @ApiProperty({ required: false, description: 'Words in the name' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  q?: string;

  @ApiProperty({ required: false, enum: GROUP_KINDS })
  @IsOptional()
  @IsIn(GROUP_KINDS)
  kind?: (typeof GROUP_KINDS)[number];

  @ApiProperty({
    required: false,
    description: 'true: only groups you belong to',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  mine?: string;
}

class GroupFields {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ required: false, enum: GROUP_VISIBILITIES })
  @IsOptional()
  @IsIn(GROUP_VISIBILITIES)
  visibility?: (typeof GROUP_VISIBILITIES)[number];

  @ApiProperty({ required: false, enum: JOIN_POLICIES })
  @IsOptional()
  @IsIn(JOIN_POLICIES)
  joinPolicy?: (typeof JOIN_POLICIES)[number];

  @ApiProperty({
    required: false,
    description: 'false: students read, staff write',
  })
  @IsOptional()
  @IsBoolean()
  studentsCanPost?: boolean;
}

export class CreateGroupDto extends GroupFields {
  @ApiProperty()
  @IsString()
  @Length(2, 120)
  name!: string;

  @ApiProperty({
    required: false,
    description: 'District roles: which school the group belongs to',
  })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @ApiProperty({ required: false, enum: CREATABLE_KINDS, default: 'club' })
  @IsOptional()
  @IsIn(CREATABLE_KINDS)
  kind?: 'club' | 'school';
}

export class UpdateGroupDto extends GroupFields {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;
}

export class AddMemberDto {
  @ApiProperty()
  @IsUUID()
  userId!: string;

  @ApiProperty({ required: false, enum: MEMBER_ROLES })
  @IsOptional()
  @IsIn(MEMBER_ROLES)
  role?: (typeof MEMBER_ROLES)[number];
}

export class UpdateMemberDto {
  @ApiProperty({ required: false, enum: MEMBER_ROLES })
  @IsOptional()
  @IsIn(MEMBER_ROLES)
  role?: (typeof MEMBER_ROLES)[number];

  @ApiProperty({
    required: false,
    enum: ['active', 'removed'],
    description: 'active approves a pending request',
  })
  @IsOptional()
  @IsIn(['active', 'removed'])
  status?: 'active' | 'removed';

  @ApiProperty({
    required: false,
    description: `Mute for this many days (1 to ${MAX_MUTE_DAYS}); 0 lifts a mute`,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_MUTE_DAYS)
  muteDays?: number;
}

export class ListTopicsQuery extends PagedQueryDto {
  @ApiProperty({ required: false, description: 'Words in the title or body' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  q?: string;
}

export class CreateTopicDto {
  @ApiProperty()
  @IsString()
  @Length(2, MAX_TITLE_LENGTH)
  title!: string;

  @ApiProperty()
  @IsString()
  @Length(1, MAX_BODY_LENGTH)
  body!: string;
}

export class UpdateTopicDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, MAX_TITLE_LENGTH)
  title?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, MAX_BODY_LENGTH)
  body?: string;

  @ApiProperty({ required: false, description: 'Moderators only' })
  @IsOptional()
  @IsBoolean()
  pinned?: boolean;

  @ApiProperty({ required: false, description: 'Moderators only' })
  @IsOptional()
  @IsBoolean()
  locked?: boolean;
}

export class CreatePostDto {
  @ApiProperty()
  @IsString()
  @Length(1, MAX_BODY_LENGTH)
  body!: string;
}

export class UpdatePostDto extends CreatePostDto {}

export class ReactDto {
  @ApiProperty({ enum: REACTION_KINDS })
  @IsIn(REACTION_KINDS)
  kind!: (typeof REACTION_KINDS)[number];
}

export class ReportDto {
  @ApiProperty({ enum: ['topic', 'post'] })
  @IsIn(['topic', 'post'])
  targetType!: 'topic' | 'post';

  @ApiProperty()
  @IsUUID()
  targetId!: string;

  @ApiProperty({ enum: REPORT_REASONS })
  @IsIn(REPORT_REASONS)
  reason!: (typeof REPORT_REASONS)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  details?: string;
}

export class ResolveReportDto {
  @ApiProperty({ enum: REPORT_RESOLUTIONS })
  @IsIn(REPORT_RESOLUTIONS)
  resolution!: (typeof REPORT_RESOLUTIONS)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class ModerateDto {
  @ApiProperty({ enum: MODERATION_ACTIONS })
  @IsIn(MODERATION_ACTIONS)
  action!: (typeof MODERATION_ACTIONS)[number];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  note?: string;
}
