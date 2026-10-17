import { toEnvelope } from '../events/stay-events';
import { occupancyDeltas } from './occupancy.reducer';

const event = (type: string, over: Record<string, unknown> = {}) =>
  toEnvelope({
    id: '00000000-0000-4000-8000-000000000003',
    type,
    createdAt: new Date('2026-10-05T00:00:00Z'),
    payload: {
      stayId: '00000000-0000-4000-8000-000000000001',
      propertyId: '00000000-0000-4000-8000-000000000002',
      source: 'DIRECT',
      kind: 'BOOKING',
      checkIn: '2026-10-05',
      checkOut: '2026-10-08',
      totalCents: 30000,
      ...over,
    },
  });

describe('occupancyDeltas', () => {
  it('books each night of [checkIn, checkOut) and splits revenue evenly', () => {
    expect(occupancyDeltas(event('stay.created'))).toEqual([
      { date: '2026-10-05', bookedNights: 1, revenueCents: 10000 },
      { date: '2026-10-06', bookedNights: 1, revenueCents: 10000 },
      { date: '2026-10-07', bookedNights: 1, revenueCents: 10000 },
    ]);
  });

  it('gives remainder cents to the first nights so the total is exact', () => {
    const d = occupancyDeltas(event('stay.created', { totalCents: 10001 }));
    expect(d.map((x) => x.revenueCents)).toEqual([3334, 3334, 3333]);
  });

  it('a cancel is the exact negative of the create', () => {
    const create = occupancyDeltas(
      event('stay.created', { totalCents: 10001 }),
    );
    const cancel = occupancyDeltas(
      event('stay.cancelled', { totalCents: 10001 }),
    );
    expect(cancel).toEqual(
      create.map((d) => ({
        date: d.date,
        bookedNights: -d.bookedNights,
        revenueCents: -d.revenueCents,
      })),
    );
  });

  it('treats a missing total as zero revenue', () => {
    const d = occupancyDeltas(event('stay.created', { totalCents: null }));
    expect(d.every((x) => x.revenueCents === 0)).toBe(true);
  });

  it('ignores blocks and stay.updated', () => {
    expect(occupancyDeltas(event('stay.created', { kind: 'BLOCK' }))).toEqual(
      [],
    );
    expect(occupancyDeltas(event('stay.updated'))).toEqual([]);
  });
});
