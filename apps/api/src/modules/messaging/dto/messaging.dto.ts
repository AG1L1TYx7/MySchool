import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { MAX_MESSAGE_LENGTH } from '../messaging-rules';

export const CONVERSATION_TYPES = ['direct', 'group', 'class'] as const;

export class CreateConversationDto {
  @ApiProperty({ enum: CONVERSATION_TYPES, default: 'direct' })
  @IsOptional()
  @IsIn(CONVERSATION_TYPES)
  type?: (typeof CONVERSATION_TYPES)[number];
  @ApiProperty({
    required: false,
    type: [String],
    description: 'Other participants (direct: exactly one)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  participantIds?: string[];
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'For class conversations',
  })
  @IsOptional()
  @IsUUID()
  classId?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;
}

export class UpdateConversationDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;
  @ApiProperty({ required: false, description: 'Mute for me' })
  @IsOptional()
  @IsBoolean()
  muted?: boolean;
}

export class AddParticipantsDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('all', { each: true })
  userIds!: string[];
}

export class SendMessageDto {
  @ApiProperty() @IsString() @Length(1, MAX_MESSAGE_LENGTH) content!: string;
  @ApiProperty({ required: false, format: 'uuid' })
  @IsOptional()
  @IsUUID()
  replyToMessageId?: string;
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID('all', { each: true })
  fileIds?: string[];
}

export class EditMessageDto {
  @ApiProperty() @IsString() @Length(1, MAX_MESSAGE_LENGTH) content!: string;
}

export class ListMessagesQuery {
  @ApiProperty({
    required: false,
    format: 'uuid',
    description: 'Return messages older than this message',
  })
  @IsOptional()
  @IsUUID()
  before?: string;
  @ApiProperty({ required: false, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit = 50;
}
