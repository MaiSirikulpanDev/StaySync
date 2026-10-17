import { PrismaClient } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import { OccupancyProjection } from '../src/occupancy/occupancy.projection';
import { WorkerRootModule } from '../src/worker.module';
import { waitFor } from './setup/wait';

const N = 120;
const PROPERTIES = Array.from({ length: 12 }, () => randomUUID());

describe('worker failure', () => {
  const prisma = new PrismaClient();
  const workers: TestingModule[] = [];
  const startWorker = async () => {
    const w = await Test.createTestingModule({
      imports: [WorkerRootModule],
    }).compile();
    await w.init();
    workers.push(w);
    return w;
  };
  const processed = () => prisma.processedEvent.count();

  beforeAll(() =>
    prisma.$executeRawUnsafe(
      'TRUNCATE "OutboxEvent", "ProcessedEvent", "PropertyOccupancyDaily"',
    ),
  );
  afterAll(async () => {
    await Promise.all(workers.map((w) => w.close().catch(() => undefined)));
    await prisma.$disconnect();
  });

  it('loses nothing and applies nothing twice when one of two workers stops mid-stream', async () => {
    const a = await startWorker();
    await startWorker();
    // A is slow, so it always has events in flight when it is stopped.
    const projection = a.get(OccupancyProjection);
    const apply = projection.apply.bind(projection);
    jest.spyOn(projection, 'apply').mockImplementation(async (e) => {
      await new Promise((r) => setTimeout(r, 40));
      return apply(e);
    });

    await prisma.outboxEvent.createMany({
      data: Array.from({ length: N }, (_, i) => ({
        type: 'stay.created',
        payload: {
          stayId: randomUUID(),
          propertyId: PROPERTIES[i % PROPERTIES.length],
          source: 'DIRECT',
          kind: 'BOOKING',
          checkIn: '2026-10-05',
          checkOut: '2026-10-06',
          totalCents: 100,
        },
      })),
    });

    await waitFor(async () => (await processed()) >= 20, 30000);
    await a.close(); // mid-stream: its partitions move to the other worker

    await waitFor(async () => (await processed()) === N, 60000);
    await new Promise((r) => setTimeout(r, 1500)); // let any late duplicate show up
    expect(await processed()).toBe(N);
    const [totals] = await prisma.$queryRaw<
      { nights: bigint; cents: bigint }[]
    >`SELECT SUM("bookedNights") AS nights, SUM("revenueCents") AS cents FROM "PropertyOccupancyDaily"`;
    expect([Number(totals.nights), Number(totals.cents)]).toEqual([N, N * 100]);
  });
});
