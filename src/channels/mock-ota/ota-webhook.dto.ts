import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';
import { IsDateOnly } from '../../common/dates';

export const BOOKING_CREATED = 'booking.created';
export const BOOKING_CANCELLED = 'booking.cancelled';

const created = (o: OtaWebhookDto) => o.type === BOOKING_CREATED;

export class OtaWebhookDto {
  @IsIn([BOOKING_CREATED, BOOKING_CANCELLED])
  type: typeof BOOKING_CREATED | typeof BOOKING_CANCELLED;
  @IsString() @IsNotEmpty() listingId: string;
  @IsString() @IsNotEmpty() bookingId: string;

  @ValidateIf(created) @IsDateOnly() checkIn?: string;
  @ValidateIf(created) @IsDateOnly() checkOut?: string;
  @ValidateIf(created) @IsString() @IsNotEmpty() guestName?: string;
  @IsOptional() @IsInt() @Min(1) guests?: number;
  @IsOptional() @IsInt() @Min(0) totalCents?: number;
}
