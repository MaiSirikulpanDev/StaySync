// Demo data: two properties, pricing rules, a demo OTA channel and a few stays.
// Run with `npm run seed`. It does nothing if any property already exists.
import { PricingRuleType, PrismaClient, StayKind } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { addDays } from '../src/common/dates';
import { PricingRule, quote } from '../src/pricing/pricing.engine';

type RuleSeed = Omit<PricingRule, 'id'>;

const seasonal = (
  startDate: string,
  endDate: string,
  rateCents: number,
  minStay: number | null,
  priority = 0,
): RuleSeed => ({
  type: 'SEASONAL',
  startDate,
  endDate,
  rateCents,
  adjustPercent: null,
  minStay,
  priority,
});
const weekend = (adjustPercent: number): RuleSeed => ({
  type: 'WEEKEND',
  startDate: null,
  endDate: null,
  rateCents: null,
  adjustPercent,
  minStay: null,
  priority: 0,
});

export async function seed(
  prisma: PrismaClient,
  today: string,
): Promise<{ seeded: boolean }> {
  if (await prisma.property.count()) return { seeded: false };
  const year = Number(today.slice(0, 4));

  const properties = [
    {
      name: 'Beachfront Bungalow',
      timezone: 'Australia/Brisbane',
      currency: 'AUD',
      baseRateCents: 18000,
      minStay: 2,
      maxGuests: 4,
      rules: [
        seasonal(`${year}-12-20`, `${year + 1}-01-06`, 32000, 5, 1),
        weekend(20),
      ],
      channel: 'demo-listing-1',
      // [kind, days from today in, days from today out, guest]
      stays: [
        ['BOOKING', 7, 10, 'Alex Morgan'],
        ['BLOCK', 20, 23, null],
        ['BOOKING', 30, 35, 'Priya Nair'],
      ],
    },
    {
      name: 'Mountain Cabin',
      timezone: 'Australia/Sydney',
      currency: 'AUD',
      baseRateCents: 12000,
      minStay: 3,
      maxGuests: 6,
      rules: [
        seasonal(`${year}-06-01`, `${year}-09-01`, 21000, 2, 1),
        weekend(15),
      ],
      channel: null,
      stays: [['BOOKING', 3, 7, 'Sam Lee']],
    },
  ] as const;

  for (const p of properties) {
    const property = await prisma.property.create({
      data: {
        name: p.name,
        timezone: p.timezone,
        currency: p.currency,
        baseRateCents: p.baseRateCents,
        minStay: p.minStay,
        maxGuests: p.maxGuests,
        icalToken: randomBytes(24).toString('hex'),
        pricingRules: {
          create: p.rules.map((r) => ({
            type: r.type as PricingRuleType,
            startDate: r.startDate ? new Date(r.startDate) : null,
            endDate: r.endDate ? new Date(r.endDate) : null,
            rateCents: r.rateCents,
            adjustPercent: r.adjustPercent,
            minStay: r.minStay,
            priority: r.priority,
          })),
        },
        ...(p.channel && {
          channels: {
            create: [{ type: 'MOCK_OTA', config: { listingId: p.channel } }],
          },
        }),
      },
    });
    const rules = p.rules.map((r, i) => ({ ...r, id: String(i) }));
    for (const [kind, from, to, guest] of p.stays) {
      const checkIn = addDays(today, from);
      const checkOut = addDays(today, to);
      await prisma.stay.create({
        data: {
          propertyId: property.id,
          kind: kind as StayKind,
          checkIn: new Date(checkIn),
          checkOut: new Date(checkOut),
          ...(kind === 'BOOKING' && {
            guestName: guest,
            guests: 2,
            totalCents: quote(p, rules, checkIn, checkOut).totalCents,
          }),
        },
      });
    }
  }
  return { seeded: true };
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma, new Date().toISOString().slice(0, 10))
    .then(({ seeded }) =>
      console.log(
        seeded ? 'Seeded demo data.' : 'Skipped: properties already exist.',
      ),
    )
    .finally(() => prisma.$disconnect());
}
