import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Stay, StayKind, StayStatus } from '@prisma/client';
import { toDay } from '../common/dates';
import { OutboxService } from '../outbox/outbox.service';
import { PricingService } from '../pricing/pricing.service';
import { PrismaService } from '../prisma/prisma.service';
import { PropertiesService } from '../properties/properties.service';
import { buildCalendar } from './availability';
import {
  AvailabilityQueryDto,
  CreateStayDto,
  ListStaysQueryDto,
} from './stay.dto';

const MAX_RANGE_DAYS = 366;

const view = (s: Stay) => ({
  ...s,
  checkIn: toDay(s.checkIn),
  checkOut: toDay(s.checkOut),
});

const eventPayload = (s: Stay) => ({
  stayId: s.id,
  propertyId: s.propertyId,
  source: s.source,
  kind: s.kind,
  checkIn: toDay(s.checkIn),
  checkOut: toDay(s.checkOut),
});

function assertRange(from: string, to: string) {
  if (to <= from)
    throw new BadRequestException('End date must be after start date');
}

@Injectable()
export class StaysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly properties: PropertiesService,
    private readonly pricing: PricingService,
    private readonly outbox: OutboxService,
  ) {}

  /**
   * No availability pre-check on purpose: the stay_no_overlap constraint is the guard,
   * and the exception filter turns its violation into 409 DATES_UNAVAILABLE.
   */
  async create(propertyId: string, dto: CreateStayDto) {
    await this.properties.get(propertyId);
    assertRange(dto.checkIn, dto.checkOut);

    const isBooking = dto.kind === StayKind.BOOKING;
    let totalCents: number | null = null;
    if (isBooking) {
      const q = await this.pricing.quote(propertyId, {
        checkIn: dto.checkIn,
        checkOut: dto.checkOut,
        guests: dto.guests,
      });
      if (!q.meetsMinStay) {
        throw new BadRequestException({
          code: 'MIN_STAY_NOT_MET',
          message: `Minimum stay is ${q.minStay} nights`,
        });
      }
      totalCents = q.totalCents;
    }

    const stay = await this.prisma.$transaction(async (tx) => {
      const created = await tx.stay.create({
        data: {
          propertyId,
          kind: dto.kind,
          checkIn: new Date(dto.checkIn),
          checkOut: new Date(dto.checkOut),
          totalCents,
          ...(isBooking && {
            guestName: dto.guestName,
            guestEmail: dto.guestEmail,
            guests: dto.guests,
          }),
        },
      });
      await this.outbox.add(tx, 'stay.created', eventPayload(created));
      return created;
    });
    return view(stay);
  }

  async list(propertyId: string, q: ListStaysQueryDto) {
    await this.properties.get(propertyId);
    const stays = await this.prisma.stay.findMany({
      where: {
        propertyId,
        status: q.status,
        ...(q.to && { checkIn: { lt: new Date(q.to) } }),
        ...(q.from && { checkOut: { gt: new Date(q.from) } }),
      },
      orderBy: { checkIn: 'asc' },
    });
    return stays.map(view);
  }

  async cancel(id: string) {
    const stay = await this.prisma.stay.findUnique({ where: { id } });
    if (!stay) throw new NotFoundException('Stay not found');
    if (stay.status === StayStatus.CANCELLED) return view(stay);
    // Conditional update: of two racing cancels only one flips the row, so only one event is written.
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.stay.updateMany({
        where: { id, status: StayStatus.CONFIRMED },
        data: { status: StayStatus.CANCELLED },
      });
      const cancelled = await tx.stay.findUniqueOrThrow({ where: { id } });
      if (count)
        await this.outbox.add(tx, 'stay.cancelled', eventPayload(cancelled));
      return view(cancelled);
    });
  }

  async availability(propertyId: string, { from, to }: AvailabilityQueryDto) {
    assertRange(from, to);
    const stays = await this.list(propertyId, {
      from,
      to,
      status: StayStatus.CONFIRMED,
    });
    const { nights } = await this.pricing.quote(propertyId, {
      checkIn: from,
      checkOut: to,
    });
    if (nights.length > MAX_RANGE_DAYS) {
      throw new BadRequestException(
        `Range is limited to ${MAX_RANGE_DAYS} days`,
      );
    }
    const rates = new Map(nights.map((n) => [n.date, n.rateCents]));
    return buildCalendar(stays, from, to).map((d) => ({
      ...d,
      rateCents: rates.get(d.date),
    }));
  }
}
