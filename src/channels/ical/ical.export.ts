export interface ExportStay {
  id: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // exclusive
  updatedAt: Date;
}

const compact = (day: string) => day.replaceAll('-', '');
const stamp = (d: Date) => d.toISOString().replace(/[-:]|\.\d{3}/g, '');

/** Stays -> an RFC 5545 calendar of all-day "Reserved" events. Carries no guest data on purpose. */
export function buildIcs(stays: ExportStay[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//StaySync//Channel Manager//EN',
    'CALSCALE:GREGORIAN',
    ...stays.flatMap((s) => [
      'BEGIN:VEVENT',
      `UID:${s.id}@staysync`,
      `DTSTAMP:${stamp(s.updatedAt)}`,
      `DTSTART;VALUE=DATE:${compact(s.checkIn)}`,
      `DTEND;VALUE=DATE:${compact(s.checkOut)}`,
      'SUMMARY:Reserved',
      'END:VEVENT',
    ]),
    'END:VCALENDAR',
  ];
  return lines.join('\r\n') + '\r\n';
}
