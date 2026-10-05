import { INestApplication } from '@nestjs/common';
import type { Server } from 'node:http';
import { AddressInfo } from 'node:net';
import request from 'supertest';
import { sign } from '../src/channels/mock-ota/hmac';
import { PrismaService } from '../src/prisma/prisma.service';
import { MockOta, startMockOta } from '../tools/mock-ota/server';
import { createTestApp, KEY, resetDb } from './setup/app';
import { waitFor } from './setup/wait';

const SECRET = 'test-secret'; // OTA_WEBHOOK_SECRET from global-setup

describe('inbound OTA webhook', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let id: string;
  const http = () => request(app.getHttpServer());

  const created = (over: object = {}) => ({
    type: 'booking.created',
    listingId: 'L1',
    bookingId: 'ota-1',
    checkIn: '2026-10-05',
    checkOut: '2026-10-08',
    guestName: 'Olive',
    guests: 2,
    totalCents: 33000,
    ...over,
  });
  const cancelled = (bookingId = 'ota-1') => ({
    type: 'booking.cancelled',
    listingId: 'L1',
    bookingId,
  });

  /** Sends a signed webhook; override secret/signature/eventId to misbehave. */
  const send = (
    body: object | string,
    o: {
      eventId?: string | null;
      secret?: string;
      signature?: string | null;
    } = {},
  ) => {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    let req = http()
      .post('/webhooks/mock-ota')
      .set('content-type', 'application/json');
    if (o.signature !== null)
      req = req.set(
        'x-ota-signature',
        o.signature ?? sign(o.secret ?? SECRET, raw),
      );
    if (o.eventId !== null)
      req = req.set('x-ota-event-id', o.eventId ?? `evt-${Math.random()}`);
    return req.send(raw);
  };

  const stays = () =>
    prisma.stay.findMany({
      where: { propertyId: id },
      orderBy: { createdAt: 'asc' },
    });
  const outbox = async () =>
    (await prisma.outboxEvent.findMany({ orderBy: { createdAt: 'asc' } })).map(
      (e) => e.type,
    );

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetDb(app);
    const { body } = await http().post('/properties').set(KEY).send({
      name: 'Beach House',
      timezone: 'UTC',
      currency: 'AUD',
      baseRateCents: 10000,
      maxGuests: 4,
    });
    id = body.id;
    await http()
      .post(`/properties/${id}/channels`)
      .set(KEY)
      .send({ type: 'MOCK_OTA', listingId: 'L1' });
  });
  afterAll(() => app.close());

  describe('authentication', () => {
    it('rejects a wrong signature with 401 and changes nothing', async () => {
      await send(created(), { secret: 'wrong' }).expect(401);
      expect(await stays()).toHaveLength(0);
      expect(await prisma.processedWebhook.count()).toBe(0);
    });

    it('rejects a missing signature with 401', async () => {
      await send(created(), { signature: null }).expect(401);
    });

    it('rejects a body that was changed after signing', async () => {
      const signature = sign(SECRET, JSON.stringify(created()));
      await send(created({ guests: 3 }), { signature }).expect(401);
    });

    it('does not need the API key', async () => {
      await send(created()).expect(200);
    });
  });

  describe('booking.created', () => {
    it('creates a confirmed OTA stay and queues an event', async () => {
      const res = await send(created()).expect(200);
      expect(res.body).toEqual({ status: 'processed' });
      const [s] = await stays();
      expect(s).toMatchObject({
        source: 'MOCK_OTA',
        externalId: 'ota-1',
        kind: 'BOOKING',
        status: 'CONFIRMED',
        guestName: 'Olive',
        guests: 2,
        totalCents: 33000,
      });
      expect(s.checkIn.toISOString().slice(0, 10)).toBe('2026-10-05');
      expect(await outbox()).toEqual(['stay.created']);
    });

    it('blocks the dates for direct bookings afterwards', async () => {
      await send(created()).expect(200);
      await http()
        .post(`/properties/${id}/stays`)
        .set(KEY)
        .send({ kind: 'BLOCK', checkIn: '2026-10-06', checkOut: '2026-10-07' })
        .expect(409);
    });

    it('processes a duplicate event id only once', async () => {
      await send(created(), { eventId: 'evt-dup' }).expect(200);
      const again = await send(created(), { eventId: 'evt-dup' }).expect(200);
      expect(again.body).toEqual({ status: 'duplicate' });
      expect(await stays()).toHaveLength(1);
      expect(await outbox()).toEqual(['stay.created']);
    });

    it('processes five identical simultaneous deliveries once', async () => {
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          send(created(), { eventId: 'evt-race' }),
        ),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(results.filter((r) => r.body.status === 'processed')).toHaveLength(
        1,
      );
      expect(await stays()).toHaveLength(1);
    });

    it('updates the stay when the OTA re-sends the same booking under a new event id', async () => {
      await send(created()).expect(200);
      await send(created({ checkOut: '2026-10-09', totalCents: 44000 })).expect(
        200,
      );
      const all = await stays();
      expect(all).toHaveLength(1);
      expect(all[0]).toMatchObject({ totalCents: 44000 });
      expect(all[0].checkOut.toISOString().slice(0, 10)).toBe('2026-10-09');
    });

    it('records a SyncIssue and still answers 200 when the dates are already taken', async () => {
      await http()
        .post(`/properties/${id}/stays`)
        .set(KEY)
        .send({
          kind: 'BOOKING',
          checkIn: '2026-10-06',
          checkOut: '2026-10-09',
          guestName: 'Ann',
          guests: 1,
        })
        .expect(201);
      const res = await send(created(), { eventId: 'evt-conflict' }).expect(
        200,
      );
      expect(res.body).toEqual({ status: 'conflict' });

      expect(await stays()).toHaveLength(1); // only the direct booking
      const [issue] = await prisma.syncIssue.findMany();
      expect(issue).toMatchObject({ kind: 'CONFLICT', resolvedAt: null });
      expect(issue.detail).toMatchObject({
        eventId: 'evt-conflict',
        bookingId: 'ota-1',
        checkIn: '2026-10-05',
      });

      // The OTA must not be asked to retry forever: a replay is a plain duplicate.
      const replay = await send(created(), { eventId: 'evt-conflict' }).expect(
        200,
      );
      expect(replay.body).toEqual({ status: 'duplicate' });
      expect(await prisma.syncIssue.count()).toBe(1);
    });
  });

  describe('booking.cancelled', () => {
    it('cancels the stay, frees the dates and queues an event', async () => {
      await send(created()).expect(200);
      await send(cancelled()).expect(200);
      const [s] = await stays();
      expect(s.status).toBe('CANCELLED');
      expect(await outbox()).toEqual(['stay.created', 'stay.cancelled']);
      await http()
        .post(`/properties/${id}/stays`)
        .set(KEY)
        .send({ kind: 'BLOCK', checkIn: '2026-10-05', checkOut: '2026-10-08' })
        .expect(201);
    });

    it('queues only one event when the cancel arrives twice under different event ids', async () => {
      await send(created()).expect(200);
      await send(cancelled()).expect(200);
      await send(cancelled()).expect(200);
      expect(await outbox()).toEqual(['stay.created', 'stay.cancelled']);
    });

    it('accepts a cancel for a booking it never saw', async () => {
      const res = await send(cancelled('ghost')).expect(200);
      expect(res.body).toEqual({ status: 'processed' });
      expect(await stays()).toHaveLength(0);
    });
  });

  describe('bad requests', () => {
    it('returns 404 for an unknown listing and does not mark the event processed', async () => {
      await send(created({ listingId: 'nope' }), { eventId: 'evt-x' }).expect(
        404,
      );
      expect(await prisma.processedWebhook.count()).toBe(0);
    });

    it('returns 400 without an event id header', async () => {
      await send(created(), { eventId: null }).expect(400);
    });

    it.each([
      ['an unknown event type', created({ type: 'booking.exploded' })],
      ['an impossible date', created({ checkIn: '2026-02-30' })],
      ['checkout before checkin', created({ checkOut: '2026-10-01' })],
      ['no guest name', created({ guestName: undefined })],
      ['an unexpected field', created({ extra: 1 })],
    ])('returns 400 for %s', async (_n, body) => {
      await send(body).expect(400);
      expect(await stays()).toHaveLength(0);
    });
  });

  describe('through the mock OTA tool', () => {
    let ota: MockOta;
    beforeAll(async () => {
      await app.listen(0);
      const port = ((app.getHttpServer() as Server).address() as AddressInfo)
        .port;
      ota = await startMockOta(4010, {
        appUrl: `http://127.0.0.1:${port}`,
        webhookSecret: SECRET,
      });
    });
    afterAll(() => ota.stop());

    it('POST /_simulate/booking sends a signed webhook that creates a stay', async () => {
      const res = await fetch('http://127.0.0.1:4010/_simulate/booking', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(created({ bookingId: 'sim-1' })),
      });
      expect(await res.json()).toEqual({
        status: 200,
        body: { status: 'processed' },
      });
      expect(await stays()).toHaveLength(1);
      // The booking came from the OTA, so it must not be pushed back to it.
      await new Promise((r) => setTimeout(r, 1000));
      expect(ota.calls).toHaveLength(0);
      await waitFor(
        async () => (await prisma.outboxEvent.findFirst())?.publishedAt,
      );
    });
  });
});
