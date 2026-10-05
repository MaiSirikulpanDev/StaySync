import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, KEY, resetDb } from './setup/app';

describe('channels', () => {
  let app: INestApplication;
  let id: string;
  const http = () => request(app.getHttpServer());
  const add = (b: object, propertyId = id) =>
    http().post(`/properties/${propertyId}/channels`).set(KEY).send(b);

  beforeAll(async () => (app = await createTestApp()));
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

  it('connects an iCal feed', async () => {
    const res = await add({
      type: 'ICAL',
      url: 'https://example.com/cal.ics',
    }).expect(201);
    expect(res.body).toMatchObject({
      propertyId: id,
      type: 'ICAL',
      config: { url: 'https://example.com/cal.ics' },
      active: true,
      lastSyncedAt: null,
      lastSyncError: null,
    });
  });

  it('connects a mock OTA listing', async () => {
    const res = await add({ type: 'MOCK_OTA', listingId: 'L1' }).expect(201);
    expect(res.body).toMatchObject({
      type: 'MOCK_OTA',
      config: { listingId: 'L1' },
    });
  });

  it.each([
    ['ical without url', { type: 'ICAL' }],
    ['ical with a non-http url', { type: 'ICAL', url: 'ftp://x/y.ics' }],
    ['ical with garbage url', { type: 'ICAL', url: 'nope' }],
    ['ota without listingId', { type: 'MOCK_OTA' }],
    ['unknown type', { type: 'SMOKE_SIGNAL' }],
    ['unknown field', { type: 'MOCK_OTA', listingId: 'L1', active: false }],
  ])('rejects %s', async (_n, b) => {
    await add(b).expect(400);
  });

  it('refuses to connect the same OTA listing twice', async () => {
    await add({ type: 'MOCK_OTA', listingId: 'L1' }).expect(201);
    const res = await add({ type: 'MOCK_OTA', listingId: 'L1' }).expect(409);
    expect(res.body.code).toBe('ALREADY_EXISTS');
  });

  it('lists and deletes channels', async () => {
    const { body: c } = await add({ type: 'MOCK_OTA', listingId: 'L1' });
    await add({ type: 'ICAL', url: 'https://example.com/cal.ics' });
    const list = await http()
      .get(`/properties/${id}/channels`)
      .set(KEY)
      .expect(200);
    expect(list.body).toHaveLength(2);
    await http()
      .delete(`/properties/${id}/channels/${c.id}`)
      .set(KEY)
      .expect(204);
    await http()
      .delete(`/properties/${id}/channels/${c.id}`)
      .set(KEY)
      .expect(404);
    expect(
      (await http().get(`/properties/${id}/channels`).set(KEY)).body,
    ).toHaveLength(1);
  });

  it('returns 404 for an unknown property', async () => {
    await add(
      { type: 'MOCK_OTA', listingId: 'L1' },
      '7b1e2f0e-0000-4000-8000-000000000000',
    ).expect(404);
    await http()
      .get('/properties/7b1e2f0e-0000-4000-8000-000000000000/channels')
      .set(KEY)
      .expect(404);
  });
});
