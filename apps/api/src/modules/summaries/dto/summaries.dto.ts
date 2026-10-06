import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';

export const SUMMARY_LANGUAGES = ['en', 'es'] as const;

export class GenerateSummaryDto {
  @ApiProperty({
    enum: SUMMARY_LANGUAGES,
    default: 'es',
    description: "The family's language",
  })
  @IsOptional()
  @IsIn(SUMMARY_LANGUAGES)
  language?: (typeof SUMMARY_LANGUAGES)[number];
}

export class UpdateSummaryDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  summary?: string;
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  keyIdeas?: string[];
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  questions?: string[];
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(4)
  @IsString({ each: true })
  tryAtHome?: string[];
  @ApiProperty({
    required: false,
    enum: ['draft', 'released'],
    description: 'released makes it visible to families',
  })
  @IsOptional()
  @IsIn(['draft', 'released'])
  status?: 'draft' | 'released';
}

export class GenerateConferenceDto {
  @ApiProperty({ enum: SUMMARY_LANGUAGES, default: 'en' })
  @IsOptional()
  @IsIn(SUMMARY_LANGUAGES)
  language?: (typeof SUMMARY_LANGUAGES)[number];
}
