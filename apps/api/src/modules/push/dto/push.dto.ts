import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { PLATFORMS } from '../push-rules';

export class RegisterDeviceDto {
  @ApiProperty({ enum: PLATFORMS })
  @IsIn(PLATFORMS)
  platform!: (typeof PLATFORMS)[number];
  @ApiProperty({ description: 'The Firebase registration token' })
  @IsString()
  @Length(20, 512)
  token!: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  name?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  appVersion?: string;
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @Length(2, 10)
  locale?: string;
}
