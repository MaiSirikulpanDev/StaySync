import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, KEY, resetDb } from './setup/app';

describe('stays', () => {
  let app: INestApplication;
  let id: string;
  const http = () => request(app.getHttpServer());
  const book = (b: object) =>
    http().post(`/properties/${id}/stays`).set(KEY).send(b);
  const booking = (checkIn: string, checkOut: string, extra = {}) =>
    book({
      kind: 'BOOKING',
      checkIn,
      checkOut,
      guestName: 'Ann',
      guests: 2,
      ...extra,
    });
  const block = (checkIn: string, checkOut: string) =>
    book({ kind: 'BLOCK', checkIn, checkOut });

  const checkIns = (stays: { checkIn: string }[]) =>
    stays.map((s) => s.checkIn);

  beforeAll(async () => (app = await createTestApp()));
  beforeEach(async () => {
    await resetDb(app);
    const res = await http().post('/properties').set(KEY).send({
      name: 'Beach House',
      timezone: 'Australia/Brisbane',
      currency: 'AUD',
      baseRateCents: 10000,
      minStay: 2,
      maxGuests: 4,
    });
    id = res.body.id;
  });
  afterAll(() => app.close());

  describe('create', () => {
    it('creates a priced direct booking', async () => {
      const res = await booking('2026-10-05', '2026-10-08').expect(201);
      expect(res.body).toMatchObject({
        propertyId: id,
        kind: 'BOOKING',
        status: 'CONFIRMED',
        source: 'DIRECT',
        checkIn: '2026-10-05',
        checkOut: '2026-10-08',
        guestName: 'Ann',
        guests: 2,
        totalCents: 30000,
      });
    });

    it('creates an owner block without guest info, pricing or min-stay rules', async () => {
      const res = await block('2026-10-05', '2026-10-06').expect(201);
      expect(res.body).toMatchObject({
        kind: 'BLOCK',
        totalCents: null,
        guestName: null,
      });
    });

    it.each([
      [
        'checkout before checkin',
        () => booking('2026-10-08', '2026-10-05'),
        'BAD_REQUEST',
      ],
      ['same-day stay', () => block('2026-10-05', '2026-10-05'), 'BAD_REQUEST'],
      ['bad date', () => booking('soon', '2026-10-05'), 'BAD_REQUEST'],
      [
        'more guests than allowed',
        () => booking('2026-10-05', '2026-10-08', { guests: 5 }),
        'GUESTS_EXCEEDED',
      ],
      [
        'stay shorter than min-stay',
        () => booking('2026-10-05', '2026-10-06'),
        'MIN_STAY_NOT_MET',
      ],
      [
        'booking without a guest name',
        () =>
          book({
            kind: 'BOOKING',
            checkIn: '2026-10-05',
            checkOut: '2026-10-08',
            guests: 1,
          }),
        'BAD_REQUEST',
      ],
      [
        'bad email',
        () => booking('2026-10-05', '2026-10-08', { guestEmail: 'x' }),
        'BAD_REQUEST',
      ],
      [
        'client-set status',
        () => booking('2026-10-05', '2026-10-08', { status: 'CANCELLED' }),
        'BAD_REQUEST',
      ],
    ])('rejects %s with 400', async (_n, send, code) => {
      const res = await send().expect(400);
      expect(res.body.code).toBe(code);
    });

    it('returns 404 for an unknown property', async () => {
      await http()
        .post('/properties/7b1e2f0e-0000-4000-8000-000000000000/stays')
        .set(KEY)
        .send({ kind: 'BLOCK', checkIn: '2026-10-05', checkOut: '2026-10-06' })
        .expect(404);
    });
  });

  describe('double booking', () => {
    it.each([
      ['identical dates', '2026-10-05', '2026-10-08'],
      ['partial overlap at the start', '2026-10-03', '2026-10-06'],
      ['partial overlap at the end', '2026-10-07', '2026-10-10'],
      ['contained inside', '2026-10-06', '2026-10-07'],
      ['containing it', '2026-10-01', '2026-10-20'],
    ])('rejects %s with 409 DATES_UNAVAILABLE', async (_n, a, b) => {
      await booking('2026-10-05', '2026-10-08').expect(201);
      const res = await block(a, b).expect(409);
      expect(res.body).toMatchObject({
        statusCode: 409,
        code: 'DATES_UNAVAILABLE',
      });
    });

    it('allows back-to-back stays: checkout on the 10th and check-in on the 10th', async () => {
      await booking('2026-10-08', '2026-10-10').expect(201);
      await booking('2026-10-10', '2026-10-12').expect(201);
    });

    it('does not block the same dates on another property', async () => {
      await booking('2026-10-05', '2026-10-08').expect(201);
      const other = await http().post('/properties').set(KEY).send({
        name: 'Other',
        timezone: 'UTC',
        currency: 'AUD',
        baseRateCents: 1,
        maxGuests: 1,
      });
      await http()
        .post(`/properties/${other.body.id}/stays`)
        .set(KEY)
        .send({ kind: 'BLOCK', checkIn: '2026-10-05', checkOut: '2026-10-08' })
        .expect(201);
    });

    it('lets exactly one of 20 simultaneous requests win', async () => {
      const results = await Promise.all(
        Array.from({ length: 20 }, () => booking('2026-11-01', '2026-11-04')),
      );
      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(19);
      expect(
        results
          .filter((r) => r.status === 409)
          .every((r) => r.body.code === 'DATES_UNAVAILABLE'),
      ).toBe(true);
    });

    it('is enforced by the database itself, not by application code', async () => {
      await booking('2026-10-05', '2026-10-08').expect(201);
      const prisma = app.get(PrismaService);
      await expect(
        prisma.$executeRaw`INSERT INTO "Stay" (id, "propertyId", kind, "checkIn", "checkOut", "updatedAt")
          VALUES (gen_random_uuid(), ${id}::uuid, 'BLOCK', '2026-10-06', '2026-10-07', now())`,
      ).rejects.toThrow(/stay_no_overlap/);
      await expect(
        prisma.$executeRaw`INSERT INTO "Stay" (id, "propertyId", kind, "checkIn", "checkOut", "updatedAt")
          VALUES (gen_random_uuid(), ${id}::uuid, 'BLOCK', '2026-12-07', '2026-12-07', now())`,
      ).rejects.toThrow(/stay_dates_valid/);
    });
  });

  describe('cancel', () => {
    it('cancels a stay and frees its dates', async () => {
      const { body } = await booking('2026-10-05', '2026-10-08').expect(201);
      const res = await http()
        .post(`/stays/${body.id}/cancel`)
        .set(KEY)
        .expect(201);
      expect(res.body.status).toBe('CANCELLED');
      await booking('2026-10-05', '2026-10-08').expect(201);
    });

    it('is idempotent', async () => {
      const { body } = await booking('2026-10-05', '2026-10-08');
      await http().post(`/stays/${body.id}/cancel`).set(KEY).expect(201);
      const again = await http()
        .post(`/stays/${body.id}/cancel`)
        .set(KEY)
        .expect(201);
      expect(again.body.status).toBe('CANCELLED');
    });

    it('returns 404 for an unknown stay and 400 for a malformed id', async () => {
      await http()
        .post('/stays/7b1e2f0e-0000-4000-8000-000000000000/cancel')
        .set(KEY)
        .expect(404);
      await http().post('/stays/nope/cancel').set(KEY).expect(400);
    });
  });

  describe('list', () => {
    beforeEach(async () => {
      await booking('2026-10-05', '2026-10-08');
      await booking('2026-10-20', '2026-10-22');
      const { body } = await booking('2026-11-01', '2026-11-03');
      await http().post(`/stays/${body.id}/cancel`).set(KEY);
    });
    const list = (q: object) =>
      http().get(`/properties/${id}/stays`).query(q).set(KEY);

    it('lists all stays ordered by check-in', async () => {
      const res = await list({}).expect(200);
      expect(checkIns(res.body)).toEqual([
        '2026-10-05',
        '2026-10-20',
        '2026-11-01',
      ]);
    });

    it('filters by status', async () => {
      const res = await list({ status: 'CANCELLED' }).expect(200);
      expect(res.body).toHaveLength(1);
    });

    it('returns stays overlapping [from, to)', async () => {
      const res = await list({ from: '2026-10-08', to: '2026-10-21' }).expect(
        200,
      );
      expect(checkIns(res.body)).toEqual(['2026-10-20']);
    });

    it('rejects a bad filter', async () => {
      await list({ status: 'MAYBE' }).expect(400);
      await list({ from: 'x' }).expect(400);
    });
  });

  describe('availability', () => {
    const avail = (q: object) =>
      http().get(`/properties/${id}/availability`).query(q).set(KEY);

    it('returns day-by-day availability with stay ids and rates', async () => {
      await http()
        .post(`/properties/${id}/pricing-rules`)
        .set(KEY)
        .send({ type: 'WEEKEND', adjustPercent: 20 });
      const { body: s } = await booking('2026-10-08', '2026-10-10');
      const res = await avail({ from: '2026-10-07', to: '2026-10-11' }).expect(
        200,
      );
      // Fri 10-09 is a weekend night; checkout day 10-10 (Sat) is free again
      expect(res.body).toEqual([
        { date: '2026-10-07', available: true, rateCents: 10000 },
        {
          date: '2026-10-08',
          available: false,
          stayId: s.id,
          rateCents: 10000,
        },
        {
          date: '2026-10-09',
          available: false,
          stayId: s.id,
          rateCents: 12000,
        },
        { date: '2026-10-10', available: true, rateCents: 12000 },
      ]);
    });

    it('treats cancelled stays as available', async () => {
      const { body: s } = await booking('2026-10-08', '2026-10-10');
      await http().post(`/stays/${s.id}/cancel`).set(KEY);
      const res = await avail({ from: '2026-10-08', to: '2026-10-09' }).expect(
        200,
      );
      expect(res.body[0].available).toBe(true);
    });

    it.each([
      ['to before from', { from: '2026-10-10', to: '2026-10-09' }],
      ['bad date', { from: 'x', to: '2026-10-09' }],
      ['a range over a year', { from: '2026-01-01', to: '2027-06-01' }],
    ])('rejects %s', async (_n, q) => {
      await avail(q).expect(400);
    });

    it('returns 404 for an unknown property', async () => {
      await http()
        .get('/properties/7b1e2f0e-0000-4000-8000-000000000000/availability')
        .query({ from: '2026-10-01', to: '2026-10-02' })
        .set(KEY)
        .expect(404);
    });
  });
});
