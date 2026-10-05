import { ChannelType } from '@prisma/client';
import {
  IsEnum,
  IsNotEmpty,
  IsString,
  IsUrl,
  ValidateIf,
} from 'class-validator';

export class CreateChannelDto {
  @IsEnum(ChannelType) type: ChannelType;

  @ValidateIf((o: CreateChannelDto) => o.type === ChannelType.ICAL)
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  url?: string;

  @ValidateIf((o: CreateChannelDto) => o.type === ChannelType.MOCK_OTA)
  @IsString()
  @IsNotEmpty()
  listingId?: string;
}
