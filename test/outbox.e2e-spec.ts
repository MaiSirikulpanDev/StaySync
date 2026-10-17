import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { MessagingService } from '../src/messaging/messaging.service';
import { OutboxPublisher } from '../src/outbox/outbox.publisher';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, KEY, resetDb } from './setup/app';
import { spyOnEvents } from './setup/kafka';
import { waitFor } from './setup/wait';

describe('transactional outbox', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let id: string;
  let spy: Awaited<ReturnType<typeof spyOnEvents>>;
  // The topic is never reset, so only count events whose outbox row belongs to this test.
  const received = async () => {
    const ids = new Set((await events()).map((e) => e.id));
    return spy.messages.filter((m) => ids.has(m.body.eventId));
  };
  const http = () => request(app.getHttpServer());
  const book = (checkIn: string, checkOut: string) =>
    http().post(`/properties/${id}/stays`).set(KEY).send({
      kind: 'BOOKING',
      checkIn,
      checkOut,
      guestName: 'Ann',
      guests: 2,
    });

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
    spy = await spyOnEvents();
  });
  afterEach(() => spy.stop());
  afterAll(() => app.close());

  const events = () =>
    prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } });

  it('writes stay.created in the same transaction as the stay', async () => {
    const { body: stay } = await book('2026-10-05', '2026-10-08').expect(201);
    const [e] = await events();
    expect(e.type).toBe('stay.created');
    expect(e.payload).toMatchObject({
      stayId: stay.id,
      propertyId: id,
      source: 'DIRECT',
    });
  });

  it('writes no event when the stay is rejected', async () => {
    await book('2026-10-05', '2026-10-08').expect(201);
    await book('2026-10-06', '2026-10-09').expect(409);
    expect(await events()).toHaveLength(1);
  });

  it('writes stay.cancelled once, even if cancel is repeated', async () => {
    const { body: stay } = await book('2026-10-05', '2026-10-08');
    await http().post(`/stays/${stay.id}/cancel`).set(KEY);
    await http().post(`/stays/${stay.id}/cancel`).set(KEY);
    expect((await events()).map((e) => e.type)).toEqual([
      'stay.created',
      'stay.cancelled',
    ]);
  });

  it('publishes pending events to Kafka, keyed by property, and marks them published', async () => {
    const { body: stay } = await book('2026-10-05', '2026-10-08');
    await waitFor(async () => (await events())[0].publishedAt);
    const r = await waitFor(async () => {
      const got = await received();
      return got.length === 1 ? got : null;
    });
    const msg = r[0];
    expect(msg.key).toBe(id);
    expect(msg.body).toMatchObject({
      type: 'stay.created',
      payload: { stayId: stay.id },
    });
  });

  it('keeps the event and counts the attempt when publishing fails, then delivers it after recovery', async () => {
    const publish = jest
      .spyOn(app.get(MessagingService), 'publish')
      .mockRejectedValue(new Error('broker down'));
    try {
      await book('2026-10-05', '2026-10-08');
      const failed = await waitFor(async () => {
        const [e] = await events();
        return e.attempts >= 1 ? e : null;
      });
      expect(failed.publishedAt).toBeNull();
      expect(await received()).toHaveLength(0);
    } finally {
      publish.mockRestore();
    }
    await waitFor(async () => (await events())[0].publishedAt);
    await waitFor(async () => (await received()).length === 1);
    await new Promise((r) => setTimeout(r, 500));
    expect(await received()).toHaveLength(1);
  });

  it('publishes each event exactly once when several publishers run at once', async () => {
    await prisma.outboxEvent.createMany({
      data: Array.from({ length: 30 }, () => ({
        type: 'stay.created',
        payload: {
          stayId: randomUUID(),
          propertyId: id,
          source: 'DIRECT',
          kind: 'BOOKING',
          checkIn: '2026-10-05',
          checkOut: '2026-10-08',
        },
      })),
    });
    const publisher = app.get(OutboxPublisher);
    await Promise.all([
      publisher.publishPending(),
      publisher.publishPending(),
      publisher.publishPending(),
    ]);
    await waitFor(
      async () =>
        (await prisma.outboxEvent.count({ where: { publishedAt: null } })) ===
        0,
    );
    await waitFor(async () => (await received()).length >= 30, 20000);
    await new Promise((r) => setTimeout(r, 500));
    const all = await received();
    expect(all).toHaveLength(30);
    expect(new Set(all.map((r) => r.body.eventId)).size).toBe(30);
  });
});
