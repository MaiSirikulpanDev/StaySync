import { PricingRuleType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Min, ValidateIf } from 'class-validator';
import { IsDateOnly } from '../common/dates';

const seasonal = (o: CreatePricingRuleDto) =>
  o.type === PricingRuleType.SEASONAL;
const weekend = (o: CreatePricingRuleDto) => o.type === PricingRuleType.WEEKEND;

export class CreatePricingRuleDto {
  @IsEnum(PricingRuleType) type: PricingRuleType;

  @ValidateIf(seasonal) @IsDateOnly() startDate?: string;
  @ValidateIf(seasonal) @IsDateOnly() endDate?: string;
  @ValidateIf(seasonal) @IsInt() @Min(0) rateCents?: number;

  @ValidateIf(weekend) @IsInt() adjustPercent?: number;

  @IsOptional() @IsInt() @Min(1) minStay?: number;
  @IsOptional() @IsInt() priority?: number;
}

export class QuoteQueryDto {
  @IsDateOnly() checkIn: string;
  @IsDateOnly() checkOut: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) guests?: number;
}
