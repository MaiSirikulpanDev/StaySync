# 1. Prevent double bookings with a database exclusion constraint

Status: accepted

## Context

Two people can book the same dates at the same moment. Whatever guards against that must hold for **every** writer:
the REST API, the OTA webhook and the iCal importer all insert stays.

## Options considered

| Option | Why not |
|---|---|
| `SELECT` for overlaps, then `INSERT` | Classic race: both requests see "free" and both insert. |
| Lock the property row (`SELECT … FOR UPDATE`) before checking | Correct, but only if every code path remembers to do it, and it serialises all bookings of a property. |
| Distributed lock (Redis, advisory locks in app code) | Extra infrastructure, lock expiry edge cases, and it still does not protect a writer that forgets the lock. |
| `SERIALIZABLE` transactions | Works, but needs retry loops everywhere and still relies on each caller. |

## Decision

A PostgreSQL exclusion constraint on the `Stay` table (see `prisma/migrations/*_stays/migration.sql`):

```sql
EXCLUDE USING gist (
  "propertyId" WITH =,
  daterange("checkIn", "checkOut", '[)') WITH &&
) WHERE (status = 'CONFIRMED');
```

- Ranges are half-open, so a checkout on the 10th and a check-in on the 10th do not collide.
- Cancelled stays are excluded by the `WHERE` clause, so cancelling frees the dates.
- `btree_gist` lets the `=` on `propertyId` live in the same GiST index as the range overlap.
- A `CHECK ("checkOut" > "checkIn")` rejects empty or inverted ranges.

The application does **not** pre-check availability. A pre-check could only improve an error message; the constraint is
the guarantee.

## Consequences

- Correct under any concurrency and for any writer, including raw SQL. The e2e suite fires 20 parallel bookings for the
  same dates: exactly one gets 201, nineteen get 409. Another test inserts overlapping rows with raw SQL and watches
  Postgres reject them.
- Postgres error `23P01` reaches us through Prisma as an unknown-request error. `isOverlapError()` recognises it by the
  constraint name or the SQLSTATE and the exception filter maps it to `409 DATES_UNAVAILABLE`. Inside a transaction the
  failed statement aborts the whole transaction, so code that wants to continue (webhook conflicts, iCal import) uses a
  separate transaction per change.
- Ties us to PostgreSQL. That is acceptable: range types are the reason for choosing it.
