import { PrismaClient } from '@prisma/client';
import { replayOccupancy } from '../src/occupancy/replay';

// Usage: stop the app/workers, run `npm run replay:occupancy`, start them again.
const prisma = new PrismaClient();
replayOccupancy(prisma, process.env.KAFKA_BROKERS ?? 'localhost:9092')
  .then(() =>
    console.log('occupancy projection reset; it rebuilds on next start'),
  )
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
