import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { EVENTS_TOPIC } from '../src/messaging/messaging.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { MockOta, startMockOta } from '../tools/mock-ota/server';
import { createTestApp, KEY, resetDb } from './setup/app';
import { dlqCount, produceRaw, spyOnEvents } from './setup/kafka';
import { waitFor } from './setup/wait';

describe('event stream', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ota: MockOta;
  let id: string;
  const http = () => request(app.getHttpServer());
  const stay = (day: number) => ({
    kind: 'BOOKING',
    checkIn: `2026-10-${String(day).padStart(2, '0')}`,
    checkOut: `2026-10-${String(day + 2).padStart(2, '0')}`,
    guestName: 'Ann',
    guests: 2,
  });

  beforeAll(async () => {
    ota = await startMockOta(4010);
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    ota.reset();
    await resetDb(app);
    const res = await http().post('/properties').set(KEY).send({
      name: 'Beach House',
      timezone: 'UTC',
      currency: 'AUD',
      baseRateCents: 10000,
      maxGuests: 4,
    });
    id = res.body.id;
    await prisma.channel.create({
      data: { propertyId: id, type: 'MOCK_OTA', config: { listingId: 'L1' } },
    });
  });
  afterAll(async () => {
    await app.close();
    await ota.stop();
  });

  it('delivers one property’s events in outbox order on a single key', async () => {
    const spy = await spyOnEvents();
    try {
      // create, cancel, re-create the same dates, repeated, in quick succession
      for (let i = 0; i < 4; i++) {
        const { body } = await http()
          .post(`/properties/${id}/stays`)
          .set(KEY)
          .send(stay(8))
          .expect(201);
        await http().post(`/stays/${body.id}/cancel`).set(KEY).expect(201);
      }
      const expected = (
        await prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } })
      ).map((e) => e.id);
      expect(expected).toHaveLength(8);
      const seen = () =>
        spy.messages.filter((m) => m.key === id).map((m) => m.body.eventId);
      await waitFor(() => seen().length >= 8, 20000);
      expect(seen()).toEqual(expected);
    } finally {
      await spy.stop();
    }
  });

  it('sends an invalid message to the DLQ and keeps consuming', async () => {
    const before = await dlqCount();
    await produceRaw(EVENTS_TOPIC, id, '{"not":"an event"}');
    await produceRaw(
      EVENTS_TOPIC,
      id,
      JSON.stringify({ version: 2, type: 'stay.created' }),
    );
    await produceRaw(EVENTS_TOPIC, id, 'not json at all');
    await waitFor(async () => (await dlqCount()) === before + 3, 20000);

    await http()
      .post(`/properties/${id}/stays`)
      .set(KEY)
      .send(stay(8))
      .expect(201);
    await waitFor(() => ota.calls.length >= 1, 10000);
    expect(ota.calls[0].status).toBe(200);
    expect(await dlqCount()).toBe(before + 3); // the invalid ones were not retried
  });
});
