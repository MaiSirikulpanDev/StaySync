import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { toDay } from '../common/dates';
import { PrismaService } from '../prisma/prisma.service';
import { AvailabilityQueryDto } from '../stays/stay.dto';

@ApiTags('occupancy')
@Controller('properties/:id/occupancy')
export class OccupancyController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({
    summary: 'Booked nights and revenue per day, for dates in [from, to)',
    description:
      'Read from a projection built from the event stream, so it is eventually consistent: ' +
      'a booking shows up a moment after it is created.',
  })
  async occupancy(
    @Param('id', ParseUUIDPipe) id: string,
    @Query() { from, to }: AvailabilityQueryDto,
  ) {
    const rows = await this.prisma.propertyOccupancyDaily.findMany({
      where: {
        propertyId: id,
        date: { gte: new Date(from), lt: new Date(to) },
      },
      orderBy: { date: 'asc' },
    });
    return rows.map((r) => ({
      date: toDay(r.date),
      bookedNights: r.bookedNights,
      revenueCents: r.revenueCents,
    }));
  }
}
