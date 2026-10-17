import { KafkaJS } from '@confluentinc/kafka-javascript';
import type { PrismaClient } from '@prisma/client';
import { OCCUPANCY_GROUP } from './occupancy.projection';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Resets the occupancy projection so the next consumer start rebuilds it from the first event.
 * Deleting the consumer group drops its committed offsets (the group reads from the earliest
 * offset when it has none); Kafka refuses while any member is alive, so stop the consumers first.
 */
export async function replayOccupancy(prisma: PrismaClient, brokers: string) {
  const admin = new KafkaJS.Kafka({
    kafkaJS: { brokers: brokers.split(',') },
  }).admin();
  await admin.connect();
  try {
    for (let attempt = 1; ; attempt++) {
      try {
        await admin.deleteGroups([OCCUPANCY_GROUP]);
        break;
      } catch (e) {
        const msg = (e as Error).message;
        if (/not.?found/i.test(msg)) break; // never ran: nothing to reset
        if (attempt >= 20)
          throw new Error(`consumers are still running? ${msg}`);
        await sleep(500); // a closing member may take a moment to leave
      }
    }
    await prisma.$transaction([
      prisma.propertyOccupancyDaily.deleteMany(),
      prisma.processedEvent.deleteMany({
        where: { consumerGroup: OCCUPANCY_GROUP },
      }),
    ]);
  } finally {
    await admin.disconnect();
  }
}
