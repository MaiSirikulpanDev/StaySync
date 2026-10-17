import { Injectable, OnModuleInit } from '@nestjs/common';
import { StayEvent } from '../../events/stay-events';
import { Clock } from '../../common/clock';
import { addDays } from '../../common/dates';
import { MessagingService, OTA_GROUP } from '../../messaging/messaging.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StaysService } from '../../stays/stays.service';
import { OtaClient } from './ota.client';

const WINDOW_DAYS = 365;

@Injectable()
export class OtaConsumer implements OnModuleInit {
  constructor(
    private readonly messaging: MessagingService,
    private readonly prisma: PrismaService,
    private readonly stays: StaysService,
    private readonly ota: OtaClient,
    private readonly clock: Clock,
  ) {}

  onModuleInit() {
    return this.messaging.consume(OTA_GROUP, (e) => this.handle(e));
  }

  /**
   * Rebuilds the whole next-365-days calendar from the database rather than applying a delta, so
   * duplicate deliveries and reordered events are harmless: the last push always reflects current state.
   */
  async handle({ payload }: StayEvent) {
    if (payload.source === 'MOCK_OTA') return; // came from the OTA: don't echo it back
    const propertyId = payload.propertyId;
    const channels = await this.prisma.channel.findMany({
      where: { propertyId, type: 'MOCK_OTA', active: true },
    });
    if (!channels.length) return;
    const from = this.clock.today();
    const days = await this.stays.availability(propertyId, {
      from,
      to: addDays(from, WINDOW_DAYS),
    });
    for (const c of channels) {
      await this.ota.pushAvailability(
        (c.config as { listingId: string }).listingId,
        days,
      );
    }
  }
}
