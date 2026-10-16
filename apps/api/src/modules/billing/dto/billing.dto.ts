import { ApiProperty } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class SetSubscriptionDto {
  @ApiProperty({
    required: false,
    description: 'Sales tax rate in percent (platform administrator only)',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(30)
  taxRatePercent?: number;

  @ApiProperty({
    required: false,
    description:
      'Platform administrators choose the district; a superintendent gets their own',
  })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiProperty({ example: 'district' })
  @IsString()
  @Length(2, 32)
  planCode!: string;

  @ApiProperty({
    required: false,
    description:
      "Students billed; left out, counted from the district's active students",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  seats?: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  @MaxLength(120)
  billingEmail?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  billingName?: string;

  @ApiProperty({
    required: false,
    description:
      'Days of trial before the first invoice (platform administrators)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(365)
  trialDays?: number;
}

export class UpsertPlanDto {
  @ApiProperty()
  @IsString()
  @Length(2, 32)
  code!: string;

  @ApiProperty()
  @IsString()
  @Length(2, 80)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ description: 'Cents per student per month' })
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  pricePerStudentCents!: number;

  @ApiProperty({ description: 'Cents per month at least' })
  @IsInt()
  @Min(0)
  @Max(100_000_000)
  minimumCents!: number;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  includedStudents?: number;

  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  features?: string[];

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class GenerateInvoiceDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiProperty({
    required: false,
    description:
      "First day of the period (ISO date); left out, the subscription's current period",
  })
  @IsOptional()
  @IsISO8601()
  periodStart?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class InvoiceActionDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({
    required: false,
    description: 'Payment reference from the bank or the provider',
  })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}

export class UsageQuery {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiProperty({
    required: false,
    description: 'ISO date; default thirty days ago',
  })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiProperty({ required: false, description: 'ISO date; default today' })
  @IsOptional()
  @IsISO8601()
  to?: string;
}

export class ListInvoicesQuery {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsUUID()
  tenantId?: string;

  @ApiProperty({ required: false, enum: ['open', 'paid', 'void', 'overdue'] })
  @IsOptional()
  @IsIn(['open', 'paid', 'void', 'overdue'])
  status?: string;
}
