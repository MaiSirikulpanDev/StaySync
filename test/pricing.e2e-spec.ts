import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, KEY, resetDb } from './setup/app';

describe('pricing rules and quote', () => {
  let app: INestApplication;
  let id: string;
  const http = () => request(app.getHttpServer());
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

  const rule = (b: object) =>
    http().post(`/properties/${id}/pricing-rules`).set(KEY).send(b);
  const summer = {
    type: 'SEASONAL',
    startDate: '2026-12-20',
    endDate: '2027-01-05',
    rateCents: 20000,
    minStay: 5,
  };

  it('creates, lists and deletes rules', async () => {
    const r = await rule(summer).expect(201);
    expect(r.body).toMatchObject({
      type: 'SEASONAL',
      startDate: '2026-12-20',
      endDate: '2027-01-05',
      priority: 0,
    });
    const list = await http()
      .get(`/properties/${id}/pricing-rules`)
      .set(KEY)
      .expect(200);
    expect(list.body).toHaveLength(1);
    await http()
      .delete(`/properties/${id}/pricing-rules/${r.body.id}`)
      .set(KEY)
      .expect(204);
    await http()
      .delete(`/properties/${id}/pricing-rules/${r.body.id}`)
      .set(KEY)
      .expect(404);
  });

  it.each([
    ['seasonal without a rate', { ...summer, rateCents: undefined }],
    ['seasonal without dates', { type: 'SEASONAL', rateCents: 1 }],
    ['seasonal ending before it starts', { ...summer, endDate: '2026-12-20' }],
    ['impossible date', { ...summer, startDate: '2026-02-30' }],
    ['weekend without a percent', { type: 'WEEKEND' }],
  ])('rejects %s', async (_n, b) => {
    await rule(b).expect(400);
  });

  it('returns 404 when adding a rule to an unknown property', async () => {
    await http()
      .post('/properties/7b1e2f0e-0000-4000-8000-000000000000/pricing-rules')
      .set(KEY)
      .send(summer)
      .expect(404);
  });

  it('quotes a seasonal + weekend stay with a per-night breakdown', async () => {
    await rule(summer);
    await rule({ type: 'WEEKEND', adjustPercent: 20 });
    // Sat 2026-12-19 is outside the season; Sun-Mon inside it
    const res = await http()
      .get(`/properties/${id}/quote`)
      .query({ checkIn: '2026-12-19', checkOut: '2026-12-22', guests: 2 })
      .set(KEY)
      .expect(200);
    const rates = (res.body.nights as { rateCents: number }[]).map(
      (n) => n.rateCents,
    );
    expect(rates).toEqual([12000, 20000, 20000]);
    expect(res.body).toMatchObject({
      totalCents: 52000,
      currency: 'AUD',
      minStay: 2,
      meetsMinStay: true,
    });
  });

  it('flags a stay shorter than the minimum', async () => {
    const res = await http()
      .get(`/properties/${id}/quote`)
      .query({ checkIn: '2026-10-05', checkOut: '2026-10-06' })
      .set(KEY)
      .expect(200);
    expect(res.body).toMatchObject({ minStay: 2, meetsMinStay: false });
  });

  it.each([
    [
      'checkout before checkin',
      { checkIn: '2026-10-06', checkOut: '2026-10-05' },
    ],
    ['same-day stay', { checkIn: '2026-10-06', checkOut: '2026-10-06' }],
    ['bad date', { checkIn: 'tomorrow', checkOut: '2026-10-06' }],
    [
      'too many guests',
      { checkIn: '2026-10-05', checkOut: '2026-10-07', guests: 5 },
    ],
  ])('rejects a quote with %s', async (_n, q) => {
    await http().get(`/properties/${id}/quote`).query(q).set(KEY).expect(400);
  });

  it('returns 404 quoting an unknown property', async () => {
    await http()
      .get('/properties/7b1e2f0e-0000-4000-8000-000000000000/quote')
      .query({ checkIn: '2026-10-05', checkOut: '2026-10-07' })
      .set(KEY)
      .expect(404);
  });
});
