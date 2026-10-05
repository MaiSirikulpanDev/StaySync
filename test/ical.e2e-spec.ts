import { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import * as ical from 'node-ical';
import request from 'supertest';
import { IcalSyncService } from '../src/channels/ical/ical.sync';
import { PrismaService } from '../src/prisma/prisma.service';
import { MockOta, startMockOta } from '../tools/mock-ota/server';
import { createTestApp, KEY, resetDb } from './setup/app';

const feed = (...events: string[]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//t//EN',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
const ev = (uid: string, from: string, to: string) =>
  [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART;VALUE=DATE:${from}`,
    `DTEND;VALUE=DATE:${to}`,
    'SUMMARY:Reserved',
    'END:VEVENT',
  ].join('\r\n');
const url = (listing: string) =>
  `http://127.0.0.1:4010/listings/${listing}/calendar.ics`;

describe('iCal export and import', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let ota: MockOta;
  let property: { id: string; icalToken: string };
  const http = () => request(app.getHttpServer());

  const addChannel = async (listing = 'L1') =>
    (
      await http()
        .post(`/properties/${property.id}/channels`)
        .set(KEY)
        .send({ type: 'ICAL', url: url(listing) })
        .expect(201)
    ).body as { id: string };
  const sync = (channelId: string) =>
    http().post(`/channels/${channelId}/sync`).set(KEY);
  const icalStays = () =>
    prisma.stay.findMany({
      where: { propertyId: property.id, source: 'ICAL' },
      orderBy: { checkIn: 'asc' },
    });
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const zero = {
    created: 0,
    updated: 0,
    cancelled: 0,
    conflicts: 0,
    errors: 0,
  };

  beforeAll(async () => {
    ota = await startMockOta(4010);
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(async () => {
    ota.reset();
    await resetDb(app);
    const res = await http().post('/properties').set(KEY).send({
      name: 'Beach House',
      timezone: 'UTC',
      currency: 'AUD',
      baseRateCents: 10000,
      maxGuests: 4,
    });
    property = res.body;
  });
  afterAll(async () => {
    await app.close();
    await ota.stop();
  });

  describe('export', () => {
    const fetchIcs = (token?: string, id = property.id) =>
      http()
        .get(`/properties/${id}/calendar.ics`)
        .query(token === undefined ? {} : { token });

    it('serves confirmed stays as text/calendar a real parser accepts, without guest data or an API key', async () => {
      const book = (b: object) =>
        http().post(`/properties/${property.id}/stays`).set(KEY).send(b);
      const { body: kept } = await book({
        kind: 'BOOKING',
        checkIn: '2026-10-05',
        checkOut: '2026-10-08',
        guestName: 'Secret Sam',
        guests: 2,
      });
      const { body: block } = await book({
        kind: 'BLOCK',
        checkIn: '2026-11-01',
        checkOut: '2026-11-03',
      });
      const { body: gone } = await book({
        kind: 'BOOKING',
        checkIn: '2026-12-01',
        checkOut: '2026-12-04',
        guestName: 'Gone Gail',
        guests: 1,
      });
      await http().post(`/stays/${gone.id}/cancel`).set(KEY);

      const res = await fetchIcs(property.icalToken).expect(200);
      expect(res.headers['content-type']).toMatch(/^text\/calendar/);
      expect(res.text).not.toContain('Secret');
      expect(res.text).not.toContain('Gone');

      const events = Object.values(ical.sync.parseICS(res.text)).filter(
        (e): e is ical.VEvent => e?.type === 'VEVENT',
      );
      expect(events.map((e) => e.uid)).toEqual([
        `${kept.id}@staysync`,
        `${block.id}@staysync`,
      ]);
      const ymd = (d?: Date) =>
        [d!.getFullYear(), d!.getMonth() + 1, d!.getDate()].join('-');
      expect([ymd(events[0].start), ymd(events[0].end)]).toEqual([
        '2026-10-5',
        '2026-10-8',
      ]);
    });

    it('is a valid empty calendar for a property with no stays', async () => {
      const res = await fetchIcs(property.icalToken).expect(200);
      expect(
        Object.values(ical.sync.parseICS(res.text)).filter(
          (e) => e?.type === 'VEVENT',
        ),
      ).toHaveLength(0);
    });

    it('rejects a missing, wrong or foreign token with 401', async () => {
      const other = await http().post('/properties').set(KEY).send({
        name: 'Other',
        timezone: 'UTC',
        currency: 'AUD',
        baseRateCents: 1,
        maxGuests: 1,
      });
      await fetchIcs().expect(401);
      await fetchIcs('nope').expect(401);
      await fetchIcs(other.body.icalToken).expect(401);
    });
  });

  describe('import', () => {
    it('imports remote events as blocks, queues events and closes the dates', async () => {
      const ch = await addChannel();
      ota.setCalendar(
        'L1',
        feed(
          ev('uid-1', '20261005', '20261008'),
          ev('uid-2', '20261101', '20261102'),
        ),
      );
      const res = await sync(ch.id).expect(200);
      expect(res.body).toEqual({ ...zero, created: 2 });

      const stays = await icalStays();
      expect(
        stays.map((s) => [
          s.kind,
          s.status,
          s.externalId,
          day(s.checkIn),
          day(s.checkOut),
        ]),
      ).toEqual([
        ['BLOCK', 'CONFIRMED', `${ch.id}:uid-1`, '2026-10-05', '2026-10-08'],
        ['BLOCK', 'CONFIRMED', `${ch.id}:uid-2`, '2026-11-01', '2026-11-02'],
      ]);
      expect((await prisma.outboxEvent.findMany()).map((e) => e.type)).toEqual([
        'stay.created',
        'stay.created',
      ]);
      await http()
        .post(`/properties/${property.id}/stays`)
        .set(KEY)
        .send({ kind: 'BLOCK', checkIn: '2026-10-06', checkOut: '2026-10-07' })
        .expect(409);
      const after = await prisma.channel.findUniqueOrThrow({
        where: { id: ch.id },
      });
      expect(after.lastSyncedAt).not.toBeNull();
      expect(after.lastSyncError).toBeNull();
    });

    it('does nothing the second time when the feed has not changed', async () => {
      const ch = await addChannel();
      ota.setCalendar('L1', feed(ev('uid-1', '20261005', '20261008')));
      await sync(ch.id).expect(200);
      const res = await sync(ch.id).expect(200);
      expect(res.body).toEqual(zero);
      expect(await prisma.outboxEvent.count()).toBe(1);
    });

    it('follows the remote calendar: dates move, and a removed event is cancelled', async () => {
      const ch = await addChannel();
      ota.setCalendar(
        'L1',
        feed(
          ev('uid-1', '20261005', '20261008'),
          ev('uid-2', '20261101', '20261102'),
        ),
      );
      await sync(ch.id);

      ota.setCalendar('L1', feed(ev('uid-1', '20261006', '20261010'))); // uid-1 moved, uid-2 gone
      const res = await sync(ch.id).expect(200);
      expect(res.body).toEqual({ ...zero, updated: 1, cancelled: 1 });

      const [one, two] = await icalStays();
      expect([one.status, day(one.checkIn), day(one.checkOut)]).toEqual([
        'CONFIRMED',
        '2026-10-06',
        '2026-10-10',
      ]);
      expect(two.status).toBe('CANCELLED');
      // the cancelled event's dates are free again
      await http()
        .post(`/properties/${property.id}/stays`)
        .set(KEY)
        .send({ kind: 'BLOCK', checkIn: '2026-11-01', checkOut: '2026-11-02' })
        .expect(201);
    });

    it('turns an overlap into a SyncIssue without aborting the rest, and does not repeat it', async () => {
      await http()
        .post(`/properties/${property.id}/stays`)
        .set(KEY)
        .send({
          kind: 'BOOKING',
          checkIn: '2026-10-06',
          checkOut: '2026-10-09',
          guestName: 'Ann',
          guests: 1,
        })
        .expect(201);
      const ch = await addChannel();
      ota.setCalendar(
        'L1',
        feed(
          ev('clash', '20261005', '20261008'),
          ev('fine', '20261101', '20261102'),
        ),
      );

      const res = await sync(ch.id).expect(200);
      expect(res.body).toEqual({ ...zero, created: 1, conflicts: 1 });
      expect((await icalStays()).map((s) => s.externalId)).toEqual([
        `${ch.id}:fine`,
      ]);
      const issues = await prisma.syncIssue.findMany();
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        channelId: ch.id,
        kind: 'CONFLICT',
        resolvedAt: null,
      });
      expect(issues[0].detail).toMatchObject({
        uid: 'clash',
        checkIn: '2026-10-05',
        checkOut: '2026-10-08',
      });

      await sync(ch.id).expect(200);
      expect(await prisma.syncIssue.count()).toBe(1);
    });

    it('reports an unreadable event as a PARSE_ERROR issue and still imports the others', async () => {
      const ch = await addChannel();
      ota.setCalendar(
        'L1',
        feed(
          ev('good', '20261005', '20261008'),
          ev('backwards', '20261020', '20261015'),
        ),
      );
      const res = await sync(ch.id).expect(200);
      expect(res.body).toEqual({ ...zero, created: 1, errors: 1 });
      const [issue] = await prisma.syncIssue.findMany();
      expect(issue).toMatchObject({ kind: 'PARSE_ERROR' });
      expect(issue.detail).toMatchObject({ uid: 'backwards' });
      await sync(ch.id);
      expect(await prisma.syncIssue.count()).toBe(1);
    });

    it('keeps each channel to its own events', async () => {
      const a = await addChannel('LA');
      const b = await addChannel('LB');
      ota.setCalendar('LA', feed(ev('shared-uid', '20261005', '20261008')));
      ota.setCalendar('LB', feed(ev('other', '20261101', '20261102')));
      await sync(a.id);
      await sync(b.id); // B's feed lacks A's event: that must not cancel it
      await sync(a.id);
      const stays = await icalStays();
      expect(stays.map((s) => s.status)).toEqual(['CONFIRMED', 'CONFIRMED']);
    });

    it('answers 502 and records the error when the feed cannot be fetched, then recovers', async () => {
      const ch = await addChannel('missing');
      const res = await sync(ch.id).expect(502);
      expect(res.body).toMatchObject({ code: 'SYNC_FAILED' });
      let row = await prisma.channel.findUniqueOrThrow({
        where: { id: ch.id },
      });
      expect(row.lastSyncError).toMatch(/404/);
      expect(row.lastSyncedAt).toBeNull();

      ota.setCalendar('missing', feed(ev('uid-1', '20261005', '20261008')));
      await sync(ch.id).expect(200);
      row = await prisma.channel.findUniqueOrThrow({ where: { id: ch.id } });
      expect(row.lastSyncError).toBeNull();
      expect(row.lastSyncedAt).not.toBeNull();
    });

    it('answers 502 when the host is unreachable', async () => {
      const { body } = await http()
        .post(`/properties/${property.id}/channels`)
        .set(KEY)
        .send({ type: 'ICAL', url: 'http://127.0.0.1:1/cal.ics' });
      await sync(body.id).expect(502);
    });

    it('only syncs ICAL channels, and needs the API key', async () => {
      const { body: ota1 } = await http()
        .post(`/properties/${property.id}/channels`)
        .set(KEY)
        .send({ type: 'MOCK_OTA', listingId: 'L9' });
      await sync(ota1.id).expect(400);
      await sync('7b1e2f0e-0000-4000-8000-000000000000').expect(404);
      await sync('nope').expect(400);
      await http().post(`/channels/${ota1.id}/sync`).expect(401);
    });
  });

  describe('scheduled polling', () => {
    it('registers the cron job', () => {
      expect(app.get(SchedulerRegistry).getCronJob('ical-poll')).toBeDefined();
    });

    it('syncs every active ICAL channel, and one failing channel does not stop the others', async () => {
      const good = await addChannel('LG');
      const broken = await addChannel('LX'); // no calendar served -> 404
      const off = await addChannel('LO');
      await prisma.channel.update({
        where: { id: off.id },
        data: { active: false },
      });
      ota.setCalendar('LG', feed(ev('g', '20261005', '20261008')));
      ota.setCalendar('LO', feed(ev('o', '20261101', '20261102')));

      await app.get(IcalSyncService).syncAll();

      expect((await icalStays()).map((s) => s.externalId)).toEqual([
        `${good.id}:g`,
      ]);
      expect(
        (await prisma.channel.findUniqueOrThrow({ where: { id: broken.id } }))
          .lastSyncError,
      ).toMatch(/404/);
      expect(
        (await prisma.channel.findUniqueOrThrow({ where: { id: off.id } }))
          .lastSyncedAt,
      ).toBeNull();
    });
  });
});
