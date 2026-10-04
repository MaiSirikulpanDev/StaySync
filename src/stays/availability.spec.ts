import { buildCalendar } from './availability';

const stay = (
  id: string,
  checkIn: string,
  checkOut: string,
  status = 'CONFIRMED',
) => ({
  id,
  checkIn,
  checkOut,
  status,
});

describe('buildCalendar', () => {
  it('marks every day available when there are no stays', () => {
    expect(buildCalendar([], '2026-10-01', '2026-10-03')).toEqual([
      { date: '2026-10-01', available: true },
      { date: '2026-10-02', available: true },
    ]);
  });

  it('excludes the to-date and returns nothing for an empty range', () => {
    expect(buildCalendar([], '2026-10-01', '2026-10-01')).toEqual([]);
  });

  it('marks stay nights unavailable with the stay id, but frees checkout day', () => {
    const cal = buildCalendar(
      [stay('a', '2026-10-02', '2026-10-04')],
      '2026-10-01',
      '2026-10-05',
    );
    expect(cal).toEqual([
      { date: '2026-10-01', available: true },
      { date: '2026-10-02', available: false, stayId: 'a' },
      { date: '2026-10-03', available: false, stayId: 'a' },
      { date: '2026-10-04', available: true },
    ]);
  });

  it('handles back-to-back stays', () => {
    const cal = buildCalendar(
      [
        stay('a', '2026-10-01', '2026-10-03'),
        stay('b', '2026-10-03', '2026-10-05'),
      ],
      '2026-10-02',
      '2026-10-04',
    );
    expect(cal.map((d) => d.stayId)).toEqual(['a', 'b']);
  });

  it('clips stays that start before or end after the range', () => {
    const cal = buildCalendar(
      [stay('a', '2026-09-20', '2026-12-01')],
      '2026-10-01',
      '2026-10-02',
    );
    expect(cal).toEqual([
      { date: '2026-10-01', available: false, stayId: 'a' },
    ]);
  });

  it('ignores cancelled stays', () => {
    const cal = buildCalendar(
      [stay('a', '2026-10-01', '2026-10-03', 'CANCELLED')],
      '2026-10-01',
      '2026-10-02',
    );
    expect(cal[0].available).toBe(true);
  });
});
