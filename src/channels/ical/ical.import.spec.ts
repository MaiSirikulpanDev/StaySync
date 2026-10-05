import { execFileSync } from 'node:child_process';
import { diffStays, parseIcs } from './ical.import';

const cal = (...events: string[]) =>
  [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//t//EN',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
const vevent = (...lines: string[]) =>
  ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');
const allDay = (uid: string, from: string, to: string) =>
  vevent(`UID:${uid}`, `DTSTART;VALUE=DATE:${from}`, `DTEND;VALUE=DATE:${to}`);

describe('parseIcs', () => {
  it('reads all-day events with an exclusive end', () => {
    const { events, errors } = parseIcs(
      cal(allDay('a', '20261005', '20261008')),
    );
    expect(errors).toEqual([]);
    expect(events).toEqual([
      { uid: 'a', checkIn: '2026-10-05', checkOut: '2026-10-08' },
    ]);
  });

  it('treats an all-day event without DTEND as one night', () => {
    const { events } = parseIcs(
      cal(vevent('UID:a', 'DTSTART;VALUE=DATE:20261231')),
    );
    expect(events[0]).toMatchObject({
      checkIn: '2026-12-31',
      checkOut: '2027-01-01',
    });
  });

  it('maps timed events to their UTC dates, at least one night long', () => {
    const { events } = parseIcs(
      cal(
        vevent('UID:a', 'DTSTART:20261010T150000Z', 'DTEND:20261012T100000Z'),
        vevent('UID:b', 'DTSTART:20261020T100000Z', 'DTEND:20261020T150000Z'),
      ),
    );
    expect(events).toEqual([
      { uid: 'a', checkIn: '2026-10-10', checkOut: '2026-10-12' },
      { uid: 'b', checkIn: '2026-10-20', checkOut: '2026-10-21' },
    ]);
  });

  it('skips cancelled events', () => {
    const cancelled = vevent(
      'UID:a',
      'STATUS:CANCELLED',
      'DTSTART;VALUE=DATE:20261005',
      'DTEND;VALUE=DATE:20261008',
    );
    expect(parseIcs(cal(cancelled)).events).toEqual([]);
  });

  it('reports bad events without dropping good ones', () => {
    const { events, errors } = parseIcs(
      cal(
        allDay('good', '20261005', '20261008'),
        allDay('backwards', '20261008', '20261005'),
        vevent('DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261102'),
        vevent('UID:nodate', 'SUMMARY:oops'),
      ),
    );
    expect(events.map((e) => e.uid)).toEqual(['good']);
    expect(errors.map((e) => e.uid)).toEqual([
      'backwards',
      undefined,
      'nodate',
    ]);
    expect(errors.every((e) => e.reason.length > 0)).toBe(true);
  });

  it('keeps the last of two events sharing a UID', () => {
    const { events } = parseIcs(
      cal(
        allDay('a', '20261005', '20261006'),
        allDay('a', '20261007', '20261009'),
      ),
    );
    expect(events).toEqual([
      { uid: 'a', checkIn: '2026-10-07', checkOut: '2026-10-09' },
    ]);
  });

  it('finds nothing in a body that is not a calendar', () => {
    expect(parseIcs('<html>not a calendar</html>')).toEqual({
      events: [],
      errors: [],
    });
  });

  // A process's timezone is fixed at startup, so each zone gets its own child process.
  it.each([
    ['UTC', 0],
    ['Asia/Bangkok', -420],
    ['America/Los_Angeles', 420],
    ['Pacific/Auckland', -780],
  ])(
    'reads the same calendar dates whatever the server timezone (%s)',
    (tz, offset) => {
      const script = `
      const { parseIcs } = require('./src/channels/ical/ical.import');
      const ics = process.argv[1];
      console.log(JSON.stringify({
        offset: new Date(2026, 9, 5).getTimezoneOffset(),
        events: parseIcs(ics).events,
      }));`;
      const out = execFileSync(
        process.execPath,
        [
          '-r',
          'ts-node/register/transpile-only',
          '-e',
          script,
          cal(allDay('a', '20261005', '20261008')),
        ],
        { env: { ...process.env, TZ: tz }, encoding: 'utf8' },
      );
      const result = JSON.parse(out) as { offset: number; events: unknown };
      expect(result.offset).toBe(offset); // the zone really took effect
      expect(result.events).toEqual([
        { uid: 'a', checkIn: '2026-10-05', checkOut: '2026-10-08' },
      ]);
    },
    30000,
  );
});

describe('diffStays', () => {
  const remote = (uid: string, checkIn: string, checkOut: string) => ({
    uid,
    checkIn,
    checkOut,
  });
  const local = (
    uid: string,
    checkIn: string,
    checkOut: string,
    status = 'CONFIRMED',
  ) => ({
    id: `id-${uid}`,
    uid,
    checkIn,
    checkOut,
    status,
  });

  it('creates events it has not seen', () => {
    expect(diffStays([remote('a', '2026-10-05', '2026-10-08')], [])).toEqual({
      toCreate: [remote('a', '2026-10-05', '2026-10-08')],
      toUpdate: [],
      toCancel: [],
    });
  });

  it('does nothing when nothing changed', () => {
    const d = diffStays(
      [remote('a', '2026-10-05', '2026-10-08')],
      [local('a', '2026-10-05', '2026-10-08')],
    );
    expect(d).toEqual({ toCreate: [], toUpdate: [], toCancel: [] });
  });

  it('updates a stay whose dates changed', () => {
    const d = diffStays(
      [remote('a', '2026-10-06', '2026-10-09')],
      [local('a', '2026-10-05', '2026-10-08')],
    );
    expect(d.toUpdate).toEqual([
      { id: 'id-a', ...remote('a', '2026-10-06', '2026-10-09') },
    ]);
    expect(d.toCreate).toEqual([]);
  });

  it('cancels a confirmed stay whose UID disappeared', () => {
    const d = diffStays([], [local('a', '2026-10-05', '2026-10-08')]);
    expect(d.toCancel).toEqual([{ id: 'id-a', uid: 'a' }]);
  });

  it('ignores a missing UID that is already cancelled', () => {
    const d = diffStays(
      [],
      [local('a', '2026-10-05', '2026-10-08', 'CANCELLED')],
    );
    expect(d.toCancel).toEqual([]);
  });

  it('reactivates a cancelled stay that reappears, even with the same dates', () => {
    const d = diffStays(
      [remote('a', '2026-10-05', '2026-10-08')],
      [local('a', '2026-10-05', '2026-10-08', 'CANCELLED')],
    );
    expect(d.toUpdate).toHaveLength(1);
  });
});
