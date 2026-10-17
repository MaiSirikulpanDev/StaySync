import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { toEnvelope } from '../src/events/stay-events';
import { EVENTS_TOPIC } from '../src/messaging/messaging.service';
import { OCCUPANCY_GROUP } from '../src/occupancy/occupancy.projection';
import { replayOccupancy } from '../src/occupancy/replay';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, KEY, resetDb } from './setup/app';
import { produceRaw } from './setup/kafka';
import { waitFor } from './setup/wait';

// Test clock is fixed at 2026-10-05 (see createTestApp)
describe('occupancy projection', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let id: string;
  const http = () => request(app.getHttpServer());
  const book = async (checkIn: string, checkOut: string) =>
    (
      await http().post(`/properties/${id}/stays`).set(KEY).send({
        kind: 'BOOKING',
        checkIn,
        checkOut,
        guestName: 'Ann',
        guests: 2,
      })
    ).body as { id: string; totalCents: number };
  const occupancy = async () =>
    (
      await http()
        .get(`/properties/${id}/occupancy?from=2026-10-01&to=2026-12-01`)
        .set(KEY)
        .expect(200)
    ).body as { date: string; bookedNights: number; revenueCents: number }[];
  const processed = () =>
    prisma.processedEvent.count({ where: { consumerGroup: OCCUPANCY_GROUP } });

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetDb(app);
    const res = await http().post('/properties').set(KEY).send({
      name: 'Beach House',
      timezone: 'UTC',
      currency: 'AUD',
      baseRateCents: 10000,
      maxGuests: 4,
    });
    id = res.body.id;
  });
  afterAll(() => app.close());

  it('projects a booking per night and removes it again on cancel', async () => {
    const stay = await book('2026-10-08', '2026-10-10');
    const rows = await waitFor(async () => {
      const r = await occupancy();
      return r.length === 2 ? r : null;
    });
    expect(rows).toEqual([
      {
        date: '2026-10-08',
        bookedNights: 1,
        revenueCents: stay.totalCents / 2,
      },
      {
        date: '2026-10-09',
        bookedNights: 1,
        revenueCents: stay.totalCents / 2,
      },
    ]);
    await http().post(`/stays/${stay.id}/cancel`).set(KEY).expect(201);
    await waitFor(async () =>
      (await occupancy()).every((r) => r.bookedNights === 0),
    );
    expect((await occupancy()).every((r) => r.revenueCents === 0)).toBe(true);
  });

  it('changes the projection once when the same event is delivered twice', async () => {
    await book('2026-10-08', '2026-10-10');
    await waitFor(async () => (await occupancy()).length === 2);
    const [first] = await prisma.outboxEvent.findMany();
    const dup = JSON.stringify(toEnvelope(first));
    await produceRaw(EVENTS_TOPIC, id, dup);
    await produceRaw(EVENTS_TOPIC, id, dup);
    // Same key, same partition: once this later booking is projected, the duplicates were seen first.
    await book('2026-10-20', '2026-10-21');
    await waitFor(async () => (await occupancy()).length === 3);
    const rows = await occupancy();
    expect(rows.map((r) => r.bookedNights)).toEqual([1, 1, 1]);
    expect(await processed()).toBe(2); // one inbox row per distinct event
  });

  it('rebuilds the same projection by replaying the stream from the start', async () => {
    const a = await book('2026-10-08', '2026-10-11');
    await book('2026-10-15', '2026-10-17');
    await http().post(`/stays/${a.id}/cancel`).set(KEY).expect(201);
    await book('2026-10-08', '2026-10-09'); // re-uses a freed night
    await waitFor(async () => (await processed()) === 4);
    const live = await occupancy();
    expect(live.length).toBeGreaterThan(0);

    await app.close(); // consumers must be stopped before the group can be reset
    const client = new PrismaClient();
    await replayOccupancy(client, process.env.KAFKA_BROKERS!);
    expect(await client.propertyOccupancyDaily.count()).toBe(0);
    await client.$disconnect();

    app = await createTestApp(); // new consumer: no offsets, so it reads from the earliest
    prisma = app.get(PrismaService);
    await waitFor(
      async () =>
        JSON.stringify(await occupancy()) === JSON.stringify(live) && live,
      30000,
    );
  });
});
