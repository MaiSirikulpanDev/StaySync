import { nightsBetween } from '../common/dates';

export interface StayRange {
  id: string;
  checkIn: string;
  checkOut: string; // exclusive
  status: string;
}

export interface CalendarDay {
  date: string;
  available: boolean;
  stayId?: string;
}

/** One entry per night in [from, to). A stay owns [checkIn, checkOut), so checkout day stays free. */
export function buildCalendar(
  stays: StayRange[],
  from: string,
  to: string,
): CalendarDay[] {
  const confirmed = stays.filter((s) => s.status === 'CONFIRMED');
  return nightsBetween(from, to).map((date) => {
    const s = confirmed.find((x) => x.checkIn <= date && date < x.checkOut);
    return s
      ? { date, available: false, stayId: s.id }
      : { date, available: true };
  });
}
