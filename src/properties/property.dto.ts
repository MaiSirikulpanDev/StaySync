import { PartialType } from '@nestjs/swagger';
import {
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';

export class CreatePropertyDto {
  @IsString() @IsNotEmpty() name: string;
  // ponytail: any non-empty string; check Intl.supportedValuesOf('timeZone') if bad zones bite
  @IsString() @IsNotEmpty() timezone: string;
  @Matches(/^[A-Z]{3}$/) currency: string;
  @IsInt() @Min(0) baseRateCents: number;
  @IsOptional() @IsInt() @Min(1) minStay?: number;
  @IsInt() @Min(1) maxGuests: number;
}

export class UpdatePropertyDto extends PartialType(CreatePropertyDto) {}
