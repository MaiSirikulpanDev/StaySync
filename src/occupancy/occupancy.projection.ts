import { Injectable, OnModuleInit } from '@nestjs/common';
import type { StayEvent } from '../events/stay-events';
import { MessagingService } from '../messaging/messaging.service';
import { PrismaService } from '../prisma/prisma.service';
import { occupancyDeltas } from './occupancy.reducer';

export const OCCUPANCY_GROUP = 'occupancy-projection';

@Injectable()
export class OccupancyProjection implements OnModuleInit {
  constructor(
    private readonly messaging: MessagingService,
    private readonly prisma: PrismaService,
  ) {}

  onModuleInit() {
    return this.messaging.consume(OCCUPANCY_GROUP, (e) => this.apply(e));
  }

  /**
   * The inbox row and the read-model rows commit together, so an event is applied exactly once:
   * a redelivery finds its inbox row and skips; a crash before commit leaves neither.
   */
  apply(e: StayEvent): Promise<void> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.processedEvent.createMany({
        data: [{ consumerGroup: OCCUPANCY_GROUP, eventId: e.eventId }],
        skipDuplicates: true,
      });
      if (!count) return;
      for (const d of occupancyDeltas(e)) {
        await tx.$executeRaw`
          INSERT INTO "PropertyOccupancyDaily"
            ("propertyId", "date", "bookedNights", "revenueCents", "lastEventId")
          VALUES (${e.propertyId}::uuid, ${d.date}::date, ${d.bookedNights},
                  ${d.revenueCents}, ${e.eventId}::uuid)
          ON CONFLICT ("propertyId", "date") DO UPDATE SET
            "bookedNights" = "PropertyOccupancyDaily"."bookedNights" + EXCLUDED."bookedNights",
            "revenueCents" = "PropertyOccupancyDaily"."revenueCents" + EXCLUDED."revenueCents",
            "lastEventId" = EXCLUDED."lastEventId"`;
      }
    });
  }
}
