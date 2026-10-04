import { StayKind, StayStatus } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsDateOnly } from '../common/dates';

const booking = (o: CreateStayDto) => o.kind === StayKind.BOOKING;

export class CreateStayDto {
  @IsEnum(StayKind) kind: StayKind;
  @IsDateOnly() checkIn: string;
  @IsDateOnly() checkOut: string;

  @ValidateIf(booking) @IsString() @IsNotEmpty() guestName?: string;
  @ValidateIf(booking) @IsInt() @Min(1) guests?: number;
  @IsOptional() @IsEmail() guestEmail?: string;
}

export class ListStaysQueryDto {
  @IsOptional() @IsDateOnly() from?: string;
  @IsOptional() @IsDateOnly() to?: string;
  @IsOptional() @IsEnum(StayStatus) status?: StayStatus;
}

export class AvailabilityQueryDto {
  @IsDateOnly() from: string;
  @IsDateOnly() to: string;
}
