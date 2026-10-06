import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { seed } from '../prisma/seed';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp, KEY, resetDb } from './setup/app';

describe('demo seed', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const http = () => request(app.getHttpServer());

  beforeAll(async () => {
    app = await createTestApp();
    prisma = app.get(PrismaService);
  });
  beforeEach(() => resetDb(app));
  afterAll(() => app.close());

  it('creates two properties with pricing rules, a demo OTA channel and stays', async () => {
    expect(await seed(prisma, '2026-10-05')).toEqual({ seeded: true });

    expect(await prisma.property.count()).toBe(2);
    expect(await prisma.pricingRule.count()).toBeGreaterThanOrEqual(3);
    expect(
      await prisma.channel.findFirst({ where: { type: 'MOCK_OTA' } }),
    ).toMatchObject({
      config: { listingId: 'demo-listing-1' },
    });
    const stays = await prisma.stay.findMany();
    expect(stays.length).toBeGreaterThanOrEqual(4);
    expect(stays.some((s) => s.kind === 'BLOCK')).toBe(true);
    expect(
      stays
        .filter((s) => s.kind === 'BOOKING')
        .every((s) => (s.totalCents ?? 0) > 0),
    ).toBe(true);
  });

  it('gives every property its own iCal token and a feed that serves the seeded stays', async () => {
    await seed(prisma, '2026-10-05');
    const props = await prisma.property.findMany();
    expect(new Set(props.map((p) => p.icalToken)).size).toBe(2);
    const p = props[0];
    const res = await http()
      .get(`/properties/${p.id}/calendar.ics`)
      .query({ token: p.icalToken })
      .expect(200);
    expect(res.text).toContain('BEGIN:VEVENT');
  });

  it('is usable straight away: quotes and availability work on seeded data', async () => {
    await seed(prisma, '2026-10-05');
    const [p] = await prisma.property.findMany({
      orderBy: { createdAt: 'asc' },
    });
    await http()
      .get(`/properties/${p.id}/quote`)
      .query({ checkIn: '2026-10-05', checkOut: '2026-10-07' })
      .set(KEY)
      .expect(200);
    const av = await http()
      .get(`/properties/${p.id}/availability`)
      .query({ from: '2026-10-05', to: '2026-11-05' })
      .set(KEY)
      .expect(200);
    const days = av.body as { available: boolean }[];
    expect(days.some((d) => !d.available)).toBe(true);
  });

  it('does nothing when data already exists', async () => {
    await seed(prisma, '2026-10-05');
    expect(await seed(prisma, '2026-10-05')).toEqual({ seeded: false });
    expect(await prisma.property.count()).toBe(2);
  });
});
