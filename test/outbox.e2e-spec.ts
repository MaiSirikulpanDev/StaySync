import { INestApplication } from '@nestjs/common';
import amqp, { Channel, ChannelModel } from 'amqplib';
import request from 'supertest';
import { MessagingService } from '../src/messaging/messaging.service';
import { OutboxPublisher } from '../src/outbox/outbox.publisher';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, KEY, resetDb } from './setup/app';
import { waitFor } from './setup/wait';

describe('transactional outbox', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let id: string;
  let conn: ChannelModel;
  let ch: Channel;
  let spyQueue: string;
  let received: { key: string; body: { id: string } }[];
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
    conn = await amqp.connect(process.env.RABBITMQ_URL!);
    ch = await conn.createChannel();
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
    // A spy queue that sees everything published to the events exchange.
    const { queue } = await ch.assertQueue('', { exclusive: true });
    spyQueue = queue;
    await ch.bindQueue(queue, 'staysync.events', 'stay.*');
    received = [];
    await ch.consume(queue, (m) => {
      if (!m) return;
      received.push({
        key: m.fields.routingKey,
        body: JSON.parse(m.content.toString()),
      });
      ch.ack(m);
    });
  });
  afterEach(() => ch.deleteQueue(spyQueue));
  afterAll(async () => {
    await conn.close();
    await app.close();
  });

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

  it('publishes pending events to RabbitMQ and marks them published', async () => {
    const { body: stay } = await book('2026-10-05', '2026-10-08');
    await waitFor(async () => (await events())[0].publishedAt);
    await waitFor(() => received.length === 1);
    expect(received[0].key).toBe('stay.created');
    expect(received[0].body).toMatchObject({
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
      expect(received).toHaveLength(0);
    } finally {
      publish.mockRestore();
    }
    await waitFor(async () => (await events())[0].publishedAt);
    await waitFor(() => received.length === 1);
    await new Promise((r) => setTimeout(r, 500));
    expect(received).toHaveLength(1);
  });

  it('publishes each event exactly once when several publishers run at once', async () => {
    await prisma.outboxEvent.createMany({
      data: Array.from({ length: 30 }, () => ({
        type: 'stay.created',
        payload: {},
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
    await waitFor(() => received.length >= 30);
    await new Promise((r) => setTimeout(r, 500));
    expect(received).toHaveLength(30);
    expect(new Set(received.map((r) => r.body.id)).size).toBe(30);
  });
});
