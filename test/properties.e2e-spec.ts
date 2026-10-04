import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, KEY, resetDb } from './setup/app';

const body = {
  name: 'Beach House',
  timezone: 'Australia/Brisbane',
  currency: 'AUD',
  baseRateCents: 10000,
  maxGuests: 4,
};

describe('properties', () => {
  let app: INestApplication;
  const http = () => request(app.getHttpServer());
  beforeAll(async () => (app = await createTestApp()));
  beforeEach(() => resetDb(app));
  afterAll(() => app.close());

  it('rejects requests without an API key using the error shape', async () => {
    const res = await http().get('/properties').expect(401);
    expect(res.body).toMatchObject({ statusCode: 401, code: 'UNAUTHORIZED' });
  });

  it('creates a property with defaults and a generated icalToken', async () => {
    const res = await http()
      .post('/properties')
      .set(KEY)
      .send(body)
      .expect(201);
    expect(res.body).toMatchObject({ ...body, minStay: 1 });
    expect(res.body.icalToken).toMatch(/^[0-9a-f]{48}$/);
  });

  it('gives each property a distinct icalToken', async () => {
    const a = await http().post('/properties').set(KEY).send(body);
    const b = await http().post('/properties').set(KEY).send(body);
    expect(a.body.icalToken).not.toBe(b.body.icalToken);
  });

  it.each([
    ['bad currency', { currency: 'aud' }],
    ['negative rate', { baseRateCents: -1 }],
    ['fractional rate', { baseRateCents: 10.5 }],
    ['zero guests', { maxGuests: 0 }],
    ['unknown field', { icalToken: 'mine' }],
  ])('rejects %s with 400', async (_n, patch) => {
    const res = await http()
      .post('/properties')
      .set(KEY)
      .send({ ...body, ...patch })
      .expect(400);
    expect(res.body.code).toBe('BAD_REQUEST');
  });

  it('gets, lists and patches a property', async () => {
    const { body: p } = await http().post('/properties').set(KEY).send(body);
    await http().get(`/properties/${p.id}`).set(KEY).expect(200);
    const list = await http().get('/properties').set(KEY).expect(200);
    expect(list.body).toHaveLength(1);
    const up = await http()
      .patch(`/properties/${p.id}`)
      .set(KEY)
      .send({ baseRateCents: 12000 })
      .expect(200);
    expect(up.body).toMatchObject({
      baseRateCents: 12000,
      name: 'Beach House',
    });
  });

  it('cannot change icalToken through PATCH', async () => {
    const { body: p } = await http().post('/properties').set(KEY).send(body);
    await http()
      .patch(`/properties/${p.id}`)
      .set(KEY)
      .send({ icalToken: 'x' })
      .expect(400);
  });

  it('returns 404 for an unknown property and 400 for a malformed id', async () => {
    await http()
      .get('/properties/7b1e2f0e-0000-4000-8000-000000000000')
      .set(KEY)
      .expect(404);
    await http().get('/properties/nope').set(KEY).expect(400);
    await http()
      .patch('/properties/7b1e2f0e-0000-4000-8000-000000000000')
      .set(KEY)
      .send({ name: 'x' })
      .expect(404);
  });
});
