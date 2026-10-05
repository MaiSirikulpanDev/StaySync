import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Channel,
  Prisma,
  StayKind,
  StaySource,
  StayStatus,
} from '@prisma/client';
import { isOverlapError } from '../../common/all-exceptions.filter';
import { OutboxService } from '../../outbox/outbox.service';
import { PrismaService } from '../../prisma/prisma.service';
import { eventPayload } from '../../stays/stay-event';
import { BOOKING_CREATED, OtaWebhookDto } from './ota-webhook.dto';

export interface WebhookResult {
  status: 'processed' | 'duplicate' | 'conflict';
}

@Injectable()
export class OtaWebhookService {
  private readonly logger = new Logger(OtaWebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  async handle(eventId: string, dto: OtaWebhookDto): Promise<WebhookResult> {
    if (dto.type === BOOKING_CREATED && dto.checkOut! <= dto.checkIn!) {
      throw new BadRequestException('checkOut must be after checkIn');
    }
    const channel = await this.prisma.channel.findFirst({
      where: {
        type: 'MOCK_OTA',
        active: true,
        config: { path: ['listingId'], equals: dto.listingId },
      },
    });
    if (!channel) {
      throw new NotFoundException({
        code: 'LISTING_NOT_FOUND',
        message: 'Unknown listing',
      });
    }

    try {
      return await this.process(channel, eventId, dto);
    } catch (e) {
      // The ProcessedWebhook primary key is what makes redelivery (even concurrent) a no-op.
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002' &&
        String(e.meta?.target).includes('eventId')
      ) {
        return { status: 'duplicate' };
      }
      throw e;
    }
  }

  private async process(
    channel: Channel,
    eventId: string,
    dto: OtaWebhookDto,
  ): Promise<WebhookResult> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.processedWebhook.create({ data: { eventId } });
        if (dto.type === BOOKING_CREATED) {
          await this.applyCreated(tx, channel.propertyId, dto);
        } else {
          await this.applyCancelled(tx, channel.propertyId, dto);
        }
      });
      return { status: 'processed' };
    } catch (e) {
      if (!isOverlapError(e)) throw e;
      // Overbooking: a human decides. Answer 200 anyway so the OTA does not retry forever.
      // Needs its own transaction because the failed insert aborted the first one.
      this.logger.warn(
        `overbooking from OTA booking ${dto.bookingId} on listing ${dto.listingId}`,
      );
      await this.prisma.$transaction(async (tx) => {
        await tx.processedWebhook.create({ data: { eventId } });
        await tx.syncIssue.create({
          data: {
            channelId: channel.id,
            kind: 'CONFLICT',
            detail: { eventId, ...dto },
          },
        });
      });
      return { status: 'conflict' };
    }
  }

  private async applyCreated(
    tx: Prisma.TransactionClient,
    propertyId: string,
    dto: OtaWebhookDto,
  ) {
    const data = {
      kind: StayKind.BOOKING,
      status: StayStatus.CONFIRMED,
      checkIn: new Date(dto.checkIn!),
      checkOut: new Date(dto.checkOut!),
      guestName: dto.guestName,
      guests: dto.guests,
      totalCents: dto.totalCents,
    };
    const stay = await tx.stay.upsert({
      where: {
        source_externalId: {
          source: StaySource.MOCK_OTA,
          externalId: dto.bookingId,
        },
      },
      create: {
        ...data,
        propertyId,
        source: StaySource.MOCK_OTA,
        externalId: dto.bookingId,
      },
      update: data,
    });
    await this.outbox.add(tx, 'stay.created', eventPayload(stay));
  }

  private async applyCancelled(
    tx: Prisma.TransactionClient,
    propertyId: string,
    dto: OtaWebhookDto,
  ) {
    const stay = await tx.stay.findFirst({
      where: {
        propertyId,
        source: StaySource.MOCK_OTA,
        externalId: dto.bookingId,
        status: StayStatus.CONFIRMED,
      },
    });
    if (!stay) return; // never seen, or already cancelled
    const cancelled = await tx.stay.update({
      where: { id: stay.id },
      data: { status: StayStatus.CANCELLED },
    });
    await this.outbox.add(tx, 'stay.cancelled', eventPayload(cancelled));
  }
}
