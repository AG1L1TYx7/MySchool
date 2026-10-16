import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsArray, IsOptional, IsString, IsUUID } from 'class-validator';

export class LinkContextDto {
  @ApiProperty({
    required: false,
    nullable: true,
    description: 'The class this platform course is; null unlinks',
  })
  @IsOptional()
  @IsUUID()
  classId?: string | null;
}

/** Posted as a plain HTML form from the picker page, so the ids arrive as one value or a list. */
export class DeepLinkRespondDto {
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @Transform(({ value }): string[] =>
    Array.isArray(value)
      ? value.map((v) => String(v))
      : value
        ? [String(value)]
        : [],
  )
  @IsArray()
  @IsString({ each: true })
  assignmentIds?: string[];
}
