import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { MAX_TEACHER_AWARD, QUEST_METRICS } from '../motivation-rules';

export class AwardDto {
  @ApiProperty({ enum: ['xp', 'badge'] })
  @IsIn(['xp', 'badge'])
  kind!: 'xp' | 'badge';

  @ApiProperty({ required: false, minimum: 1, maximum: MAX_TEACHER_AWARD })
  @ValidateIf((o: AwardDto) => o.kind === 'xp')
  @IsInt()
  @Min(1)
  @Max(MAX_TEACHER_AWARD)
  amount?: number;

  @ApiProperty({
    required: false,
    description: 'A teacher-awarded badge code: kindness, helper, leader',
  })
  @ValidateIf((o: AwardDto) => o.kind === 'badge')
  @IsString()
  @Length(2, 60)
  badgeCode?: string;

  @ApiProperty({ description: 'Shown to the student and their family' })
  @IsString()
  @Length(2, 300)
  reason!: string;
}

export class CreateQuestDto {
  @ApiProperty()
  @IsString()
  @Length(2, 200)
  title!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({ enum: QUEST_METRICS })
  @IsIn(QUEST_METRICS)
  metric!: (typeof QUEST_METRICS)[number];

  @ApiProperty({
    minimum: 1,
    maximum: 1000,
    description: 'Class total to reach',
  })
  @IsInt()
  @Min(1)
  @Max(1000)
  goal!: number;

  @ApiProperty({ required: false, minimum: 0, maximum: 200, default: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  rewardXp?: number;

  @ApiProperty({
    required: false,
    description: 'Defaults to the end of this week',
  })
  @IsOptional()
  @IsISO8601()
  endsAt?: string;
}

export class MotivationSettingsDto {
  @ApiProperty({
    required: false,
    description: 'XP, streaks, badges and quests on or off for the school',
  })
  @IsOptional()
  @IsBoolean()
  motivationEnabled?: boolean;
}
