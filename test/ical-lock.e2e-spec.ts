import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { PrismaService } from '../src/prisma/prisma.service';
import { MockOta, startMockOta } from '../tools/mock-ota/server';
import { createTestApp, KEY, resetDb } from './setup/app';

const feed = [
  'BEGIN:VCALENDAR',
  'VERSION:2.0',
  'PRODID:-//t//EN',
  'BEGIN:VEVENT',
  'UID:a',
  'DTSTART;VALUE=DATE:20261005',
  'DTEND;VALUE=DATE:20261008',
  'SUMMARY:Reserved',
  'END:VEVENT',
  'END:VCALENDAR',
  '',
].join('\r\n');

describe('iCal sync lock across processes', () => {
  let app: INestApplication;
  let ota: MockOta;
  let other: PrismaClient; // stands in for another worker replica
  let channelId: string;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    ota = await startMockOta(4010);
    app = await createTestApp();
    other = new PrismaClient();
  });
  beforeEach(async () => {
    ota.reset();
    ota.setCalendar('L1', feed);
    await resetDb(app);
    const { body: property } = await http().post('/properties').set(KEY).send({
      name: 'Beach House',
      timezone: 'UTC',
      currency: 'AUD',
      baseRateCents: 10000,
      maxGuests: 4,
    });
    const { body } = await http()
      .post(`/properties/${property.id}/channels`)
      .set(KEY)
      .send({
        type: 'ICAL',
        url: 'http://127.0.0.1:4010/listings/L1/calendar.ics',
      });
    channelId = body.id;
  });
  afterAll(async () => {
    await other.$disconnect();
    await app.close();
    await ota.stop();
  });

  it('refuses to sync a channel another process is already syncing, then works once it is free', async () => {
    await other.$transaction(async (tx) => {
      // Same key the service uses: a lock held by a different database session.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${channelId}, 0))`;
      const res = await http()
        .post(`/channels/${channelId}/sync`)
        .set(KEY)
        .expect(409);
      expect(res.body.code).toBe('SYNC_IN_PROGRESS');
      expect(await app.get(PrismaService).stay.count()).toBe(0);
    });
    const res = await http().post(`/channels/${channelId}/sync`).set(KEY);
    expect(res.body).toMatchObject({ created: 1 });
  });

  it('lets two syncs of different channels run at the same time', async () => {
    const lockedElsewhere = '00000000-0000-4000-8000-0000000000aa';
    await other.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockedElsewhere}, 0))`;
      await http().post(`/channels/${channelId}/sync`).set(KEY).expect(200);
    });
  });
});
