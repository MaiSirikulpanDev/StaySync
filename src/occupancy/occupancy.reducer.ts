import { nightsBetween } from '../common/dates';
import type { StayEvent } from '../events/stay-events';

export interface DailyDelta {
  date: string;
  bookedNights: number;
  revenueCents: number;
}

/**
 * Pure reducer: what one event adds to (or, for a cancel, takes from) each night's row.
 * Deltas are sums, so the result does not depend on delivery order, only on which events arrived.
 * The stay total is split over its nights; the remainder cents go to the first nights.
 * ponytail: stay.updated is ignored because nothing emits it yet; handle it (cancel old + create new) when it does.
 */
export function occupancyDeltas(e: StayEvent): DailyDelta[] {
  if (e.payload.kind !== 'BOOKING' || e.type === 'stay.updated') return [];
  const sign = e.type === 'stay.created' ? 1 : -1;
  const nights = nightsBetween(e.payload.checkIn, e.payload.checkOut);
  const total = e.payload.totalCents ?? 0;
  const base = Math.floor(total / nights.length);
  const extra = total - base * nights.length;
  return nights.map((date, i) => ({
    date,
    bookedNights: sign,
    revenueCents: sign * (base + (i < extra ? 1 : 0)),
  }));
}
