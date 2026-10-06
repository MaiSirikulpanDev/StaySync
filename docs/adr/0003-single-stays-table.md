# 3. One `Stay` table for bookings and blocks

Status: accepted

## Context

A property's calendar is occupied by guest bookings, owner holds, and dates imported from other calendars (iCal) or
channels (OTA). They all mean the same thing to availability: those nights are taken.

## Options considered

- **Separate `Booking` and `Block` tables.** Matches the vocabulary, but an exclusion constraint cannot span two
  tables. Preventing a booking from overlapping a block would need triggers, locks, or a third "occupancy" table kept in
  sync, all of which put the guarantee back into application code (see ADR 1).
- **One table with a `kind` column.** One constraint covers every combination.

## Decision

A single `Stay` table with `kind` (`BOOKING` / `BLOCK`), `status` (`CONFIRMED` / `CANCELLED`) and `source`
(`DIRECT` / `ICAL` / `MOCK_OTA`). Guest fields and `totalCents` are nullable because blocks have none.
`(source, externalId)` is unique, which makes inbound sync idempotent.

## Consequences

- The no-overlap guarantee is one constraint, and availability is one query.
- Some columns are meaningless for blocks. The API enforces which fields a booking requires; a block carries none.
- Imported iCal stays store `externalId` as `<channelId>:<uid>` so two feeds cannot cancel each other's events
  (see ADR 5).
- Adding a new channel type means a new `source` value, not a new table.
