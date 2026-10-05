import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, KEY, resetDb } from './setup/app';

describe('sync issues', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let channelId: string;
  const http = () => request(app.getHttpServer());
  const ids = (issues: { id: string }[]) => issues.map((i) => i.id);

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    await resetDb(app);
    const { body: p } = await http().post('/properties').set(KEY).send({
      name: 'Beach House',
      timezone: 'UTC',
      currency: 'AUD',
      baseRateCents: 10000,
      maxGuests: 4,
    });
    const { body: c } = await http()
      .post(`/properties/${p.id}/channels`)
      .set(KEY)
      .send({ type: 'MOCK_OTA', listingId: 'L1' });
    channelId = c.id;
  });
  afterAll(() => app.close());

  const issue = (kind = 'CONFLICT') =>
    prisma.syncIssue.create({
      data: { channelId, kind, detail: { bookingId: 'b1' } },
    });

  it('requires the API key', async () => {
    await http().get('/sync-issues').expect(401);
  });

  it('lists issues, optionally filtered by resolved state', async () => {
    const open = await issue();
    const done = await issue('PARSE_ERROR');
    await http().post(`/sync-issues/${done.id}/resolve`).set(KEY).expect(201);

    const all = await http().get('/sync-issues').set(KEY).expect(200);
    expect(all.body).toHaveLength(2);
    const unresolved = await http()
      .get('/sync-issues')
      .query({ resolved: 'false' })
      .set(KEY)
      .expect(200);
    expect(ids(unresolved.body)).toEqual([open.id]);
    const resolved = await http()
      .get('/sync-issues')
      .query({ resolved: 'true' })
      .set(KEY)
      .expect(200);
    expect(ids(resolved.body)).toEqual([done.id]);
  });

  it('resolves an issue and keeps the first resolution time when repeated', async () => {
    const i = await issue();
    const first = await http()
      .post(`/sync-issues/${i.id}/resolve`)
      .set(KEY)
      .expect(201);
    expect(first.body).toMatchObject({
      id: i.id,
      kind: 'CONFLICT',
      detail: { bookingId: 'b1' },
    });
    expect(first.body.resolvedAt).not.toBeNull();
    const again = await http()
      .post(`/sync-issues/${i.id}/resolve`)
      .set(KEY)
      .expect(201);
    expect(again.body.resolvedAt).toBe(first.body.resolvedAt);
  });

  it('returns 404 for an unknown issue and 400 for a malformed id or filter', async () => {
    await http()
      .post('/sync-issues/7b1e2f0e-0000-4000-8000-000000000000/resolve')
      .set(KEY)
      .expect(404);
    await http().post('/sync-issues/nope/resolve').set(KEY).expect(400);
    await http()
      .get('/sync-issues')
      .query({ resolved: 'maybe' })
      .set(KEY)
      .expect(400);
  });
});
