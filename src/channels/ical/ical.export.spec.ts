import * as ical from 'node-ical';
import { buildIcs } from './ical.export';

const stay = (id: string, checkIn: string, checkOut: string) => ({
  id,
  checkIn,
  checkOut,
  updatedAt: new Date('2026-10-01T03:04:05Z'),
});

describe('buildIcs', () => {
  it('is a valid empty calendar when there are no stays', () => {
    const out = buildIcs([]);
    expect(out.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(out.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(out).toContain('VERSION:2.0');
    expect(out).not.toContain('BEGIN:VEVENT');
  });

  it('writes one all-day event per stay with an exclusive end and a stable UID', () => {
    const out = buildIcs([stay('abc', '2026-10-05', '2026-10-08')]);
    expect(out).toContain('UID:abc@staysync\r\n');
    expect(out).toContain('DTSTART;VALUE=DATE:20261005\r\n');
    expect(out).toContain('DTEND;VALUE=DATE:20261008\r\n');
    expect(out).toContain('DTSTAMP:20261001T030405Z\r\n');
    expect(out).toContain('SUMMARY:Reserved\r\n');
  });

  it('never leaks anything but the stay dates', () => {
    const withPii = {
      ...stay('abc', '2026-10-05', '2026-10-08'),
      guestName: 'Secret Sam',
    };
    expect(buildIcs([withPii])).not.toContain('Secret');
  });

  it('round-trips through a real iCal parser', () => {
    const out = buildIcs([
      stay('a', '2026-10-05', '2026-10-08'),
      stay('b', '2026-12-30', '2027-01-02'),
    ]);
    const events = Object.values(ical.sync.parseICS(out)).filter(
      (e): e is ical.VEvent => e?.type === 'VEVENT',
    );
    expect(events.map((e) => e.uid)).toEqual(['a@staysync', 'b@staysync']);
    const day = (d?: Date) =>
      [d!.getFullYear(), d!.getMonth() + 1, d!.getDate()].join('-');
    expect([day(events[0].start), day(events[0].end)]).toEqual([
      '2026-10-5',
      '2026-10-8',
    ]);
    expect([day(events[1].start), day(events[1].end)]).toEqual([
      '2026-12-30',
      '2027-1-2',
    ]);
  });
});
