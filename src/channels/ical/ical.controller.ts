import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { toDay } from '../../common/dates';
import { Public } from '../../common/public.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { buildIcs } from './ical.export';
import { IcalSyncService } from './ical.sync';

@ApiTags('ical')
@Controller()
export class IcalController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sync: IcalSyncService,
  ) {}

  /** Public feed for Airbnb / Booking.com to subscribe to; the secret token is the credential. */
  @Public()
  @Get('properties/:id/calendar.ics')
  @Header('content-type', 'text/calendar; charset=utf-8')
  async export(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('token') token?: string,
  ) {
    const property = token
      ? await this.prisma.property.findFirst({
          where: { id, icalToken: token },
        })
      : null;
    if (!property) throw new UnauthorizedException('Invalid calendar token');
    const stays = await this.prisma.stay.findMany({
      where: { propertyId: id, status: 'CONFIRMED' },
      orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
    });
    return buildIcs(
      stays.map((s) => ({
        ...s,
        checkIn: toDay(s.checkIn),
        checkOut: toDay(s.checkOut),
      })),
    );
  }

  @Post('channels/:id/sync')
  @HttpCode(200)
  syncNow(@Param('id', ParseUUIDPipe) id: string) {
    return this.sync.syncById(id);
  }
}
