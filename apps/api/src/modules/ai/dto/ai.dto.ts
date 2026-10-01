import { ApiProperty } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';

export const TUTOR_MODES = ['explain', 'socratic', 'homework'] as const;
export type TutorMode = (typeof TUTOR_MODES)[number];

export class CreateConversationDto {
  @ApiProperty({ enum: TUTOR_MODES, default: 'explain' })
  @IsOptional()
  @IsIn(TUTOR_MODES)
  mode?: TutorMode;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  courseId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  lessonId?: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  classId?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;
}

export class SendMessageDto {
  @ApiProperty() @IsString() @Length(1, 4000) content!: string;
  @ApiProperty({
    required: false,
    default: false,
    description: 'Stream tokens as text/event-stream',
  })
  @IsOptional()
  @IsBoolean()
  stream?: boolean;
}

export class FeedbackDto {
  @ApiProperty({ enum: [1, -1] }) @IsInt() @IsIn([1, -1]) rating!: 1 | -1;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  comment?: string;
}
