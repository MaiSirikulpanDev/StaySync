import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { MockOta, startMockOta } from '../tools/mock-ota/server';
import { createTestApp, KEY, resetDb } from './setup/app';
import { dlqCount } from './setup/kafka';
import { waitFor } from './setup/wait';

// Test clock is fixed at 2026-10-05 (see createTestApp)
describe('OTA sync (outbox -> Kafka -> consumer -> mock OTA)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ota: MockOta;
  let id: string;
  const http = () => request(app.getHttpServer());
  const book = (checkIn: string, checkOut: string) =>
    http().post(`/properties/${id}/stays`).set(KEY).send({
      kind: 'BOOKING',
      checkIn,
      checkOut,
      guestName: 'Ann',
      guests: 2,
    });
  let dlqBefore: number;

  beforeAll(async () => {
    ota = await startMockOta(4010);
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    ota.reset();
    await resetDb(app);
    dlqBefore = await dlqCount();
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

  type Day = { date: string; available: boolean; rateCents: number };
  const lastDays = () => ota.calls[ota.calls.length - 1].body.days as Day[];

  it('pushes 365 days of availability to the OTA within 5s of a booking', async () => {
    await book('2026-10-08', '2026-10-10').expect(201);
    await waitFor(() => ota.calls.length >= 1, 5000);
    const call = ota.calls[0];
    expect(call).toMatchObject({ listingId: 'L1', status: 200 });
    const days = lastDays();
    expect(days).toHaveLength(365);
    expect([days[0].date, days[364].date]).toEqual([
      '2026-10-05',
      '2027-10-04',
    ]);
    expect(days.find((d) => d.date === '2026-10-08')).toMatchObject({
      available: false,
      rateCents: 10000,
    });
    expect(days.find((d) => d.date === '2026-10-10')?.available).toBe(true); // checkout day
  });

  it('pushes again after a cancel, freeing the dates', async () => {
    const { body: stay } = await book('2026-10-08', '2026-10-10');
    await waitFor(() => ota.calls.length >= 1);
    await http().post(`/stays/${stay.id}/cancel`).set(KEY);
    await waitFor(() => ota.calls.length >= 2);
    expect(lastDays().find((d) => d.date === '2026-10-08')?.available).toBe(
      true,
    );
  });

  it('does not push a stay that came from the OTA itself', async () => {
    const echo = await prisma.stay.create({
      data: {
        propertyId: id,
        kind: 'BOOKING',
        source: 'MOCK_OTA',
        externalId: 'ota-1',
        checkIn: new Date('2026-11-01'),
        checkOut: new Date('2026-11-03'),
      },
    });
    await prisma.outboxEvent.create({
      data: {
        type: 'stay.created',
        payload: {
          stayId: echo.id,
          propertyId: id,
          source: 'MOCK_OTA',
          kind: 'BOOKING',
          checkIn: '2026-11-01',
          checkOut: '2026-11-03',
        },
      },
    });
    await book('2026-10-08', '2026-10-10'); // control: a direct stay does push
    await waitFor(() => ota.calls.length >= 1);
    await new Promise((r) => setTimeout(r, 1000));
    expect(ota.calls).toHaveLength(1);
  });

  it('retries a failed push after a delay and then succeeds without reaching the DLQ', async () => {
    ota.failNext(2);
    await book('2026-10-08', '2026-10-10');
    await waitFor(() => ota.calls.length >= 3, 15000);
    expect(ota.calls.map((c) => c.status)).toEqual([500, 500, 200]);
    expect(await dlqCount()).toBe(dlqBefore);
  });

  it('dead-letters a push that keeps failing after 5 attempts', async () => {
    ota.failNext(1000);
    await book('2026-10-08', '2026-10-10');
    await waitFor(async () => (await dlqCount()) === dlqBefore + 1, 30000);
    expect(ota.calls).toHaveLength(5);
    await new Promise((r) => setTimeout(r, 1000));
    expect(ota.calls).toHaveLength(5);
  });
});
