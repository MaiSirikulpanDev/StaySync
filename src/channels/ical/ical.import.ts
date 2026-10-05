import * as ical from 'node-ical';
import { addDays } from '../../common/dates';

export interface RemoteEvent {
  uid: string;
  checkIn: string;
  checkOut: string;
}

export interface ParseError {
  uid?: string;
  reason: string;
}

export interface LocalStay extends RemoteEvent {
  id: string;
  status: string;
}

export interface Diff {
  toCreate: RemoteEvent[];
  toUpdate: (RemoteEvent & { id: string })[];
  toCancel: { id: string; uid: string }[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * node-ical returns all-day dates as local midnight, so read them with local getters;
 * timed events use their UTC date.
 * ponytail: ignores the listing's timezone and RRULE recurrence; add if a feed needs them.
 */
function dayOf(d: Date & { dateOnly?: boolean }): string {
  return d.dateOnly
    ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
    : d.toISOString().slice(0, 10);
}

/** Pure: iCal text -> stays-shaped events plus the events that could not be understood. */
export function parseIcs(text: string): {
  events: RemoteEvent[];
  errors: ParseError[];
} {
  const events = new Map<string, RemoteEvent>();
  const errors: ParseError[] = [];
  let parsed: ical.CalendarResponse;
  try {
    parsed = ical.sync.parseICS(text);
  } catch (e) {
    return {
      events: [],
      errors: [{ reason: `unparseable calendar: ${(e as Error).message}` }],
    };
  }
  for (const item of Object.values(parsed)) {
    if (item?.type !== 'VEVENT') continue;
    const e = item;
    const uid = e.uid || undefined;
    if (e.status === 'CANCELLED') continue;
    if (!uid) {
      errors.push({ reason: 'event has no UID' });
      continue;
    }
    if (!e.start) {
      errors.push({ uid, reason: 'event has no start date' });
      continue;
    }
    const checkIn = dayOf(e.start);
    let checkOut = e.end ? dayOf(e.end) : addDays(checkIn, 1);
    if (checkOut === checkIn) checkOut = addDays(checkIn, 1);
    if (checkOut < checkIn) {
      errors.push({ uid, reason: 'event ends before it starts' });
      continue;
    }
    events.set(uid, { uid, checkIn, checkOut });
  }
  return { events: [...events.values()], errors };
}

/** Pure: what to do so the local stays for one feed match the remote events. */
export function diffStays(remote: RemoteEvent[], existing: LocalStay[]): Diff {
  const byUid = new Map(existing.map((s) => [s.uid, s]));
  const seen = new Set(remote.map((r) => r.uid));
  const diff: Diff = { toCreate: [], toUpdate: [], toCancel: [] };
  for (const r of remote) {
    const s = byUid.get(r.uid);
    if (!s) diff.toCreate.push(r);
    else if (
      s.status !== 'CONFIRMED' ||
      s.checkIn !== r.checkIn ||
      s.checkOut !== r.checkOut
    ) {
      diff.toUpdate.push({ id: s.id, ...r });
    }
  }
  for (const s of existing) {
    if (!seen.has(s.uid) && s.status === 'CONFIRMED')
      diff.toCancel.push({ id: s.id, uid: s.uid });
  }
  return diff;
}
