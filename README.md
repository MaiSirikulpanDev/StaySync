# StaySync

[![CI](https://github.com/MaiSirikulpanDev/StaySync/actions/workflows/ci.yml/badge.svg)](https://github.com/MaiSirikulpanDev/StaySync/actions/workflows/ci.yml)

A small channel manager for short-term rental properties, built with NestJS. It keeps one availability calendar per
property and keeps it in sync with the outside world: two guests can never book the same night, outbound updates reach
the OTA even when it is down, inbound webhooks are verified and idempotent, and iCal feeds work with Airbnb and
Booking.com.

It is a portfolio project, so it deliberately stays small: no frontend (Swagger UI is the demo surface), no user
accounts (one API key), one deployable app plus a tiny mock OTA.

## Architecture

```mermaid
flowchart LR
  Client[API client / Swagger] -->|REST + API key| API[NestJS app]
  OTA[Mock OTA] -->|signed webhook| API
  API --> PG[(PostgreSQL)]
  API -->|outbox publisher| MQ[[RabbitMQ<br/>staysync.events]]
  MQ -->|stay.*| Consumer[OTA consumer<br/>same app]
  Consumer -->|push availability| OTA
  Scheduler[iCal poller] -->|fetch .ics| Ext[External iCal URL]
  Scheduler --> PG
  Airbnb[Airbnb / Booking.com] -->|GET calendar.ics| API
```

One deployable app. The consumer and scheduler are separate Nest modules, so they could become workers later.

## Quick start

You need Docker (and `curl` for the demo).

```bash
docker compose up --build
```

- Swagger UI: <http://localhost:3000/docs> (click **Authorize**, key `dev-api-key`)
- Health: <http://localhost:3000/health>
- RabbitMQ UI: <http://localhost:15672> (`guest` / `guest`)

Then, in another terminal, watch the whole story run:

```bash
./scripts/demo.sh
```

It creates a property and a channel, quotes and books a stay, attempts a double booking (409 from the database),
shows the booking arrive at the mock OTA, receives a signed OTA booking, records an overbooking as a sync issue, and
prints the iCal feed.

Optional demo data (two properties, rules, a demo channel, a few stays):

```bash
npm ci
DATABASE_URL=postgresql://staysync:staysync@localhost:5432/staysync npm run seed
```

## API at a glance

All routes need the `x-api-key` header except `/health`, `/docs`, the iCal export (secret token) and the OTA webhook
(HMAC signature). Errors always look like `{ statusCode, code, message, details? }`.

| Method | Path | Purpose |
|---|---|---|
| POST/GET/PATCH | `/properties`, `/properties/:id` | Properties |
| POST/GET/DELETE | `/properties/:id/pricing-rules` | Seasonal and weekend pricing |
| GET | `/properties/:id/quote?checkIn&checkOut&guests` | Per-night price breakdown and min-stay check |
| GET | `/properties/:id/availability?from&to` | Day-by-day availability and rate |
| POST/GET | `/properties/:id/stays` | Book or block dates; list stays |
| POST | `/stays/:id/cancel` | Cancel (idempotent) |
| POST/GET/DELETE | `/properties/:id/channels` | Connect an iCal URL or a mock OTA listing |
| POST | `/channels/:id/sync` | Import an iCal feed now |
| GET | `/properties/:id/calendar.ics?token=` | iCal export |
| POST | `/webhooks/mock-ota` | Inbound OTA events |
| GET/POST | `/sync-issues`, `/sync-issues/:id/resolve` | Conflicts that need a human |

## Design decisions

- **The database prevents double bookings**, not application code: a PostgreSQL exclusion constraint on a half-open
  date range. [ADR 1](docs/adr/0001-exclusion-constraint.md)
- **A transactional outbox** feeds RabbitMQ, so an event is never lost and never describes a rolled-back change.
  [ADR 2](docs/adr/0002-transactional-outbox.md)
- **One `Stay` table** for bookings, owner blocks and imported dates, so a single constraint covers all of them.
  [ADR 3](docs/adr/0003-single-stays-table.md)
- Notes on where the build differs from the original plan and why:
  [ADR 4](docs/adr/0004-m3-deviations.md), [ADR 5](docs/adr/0005-m5-deviations.md).

Smaller choices worth knowing:

- Pricing, availability, iCal export and the iCal diff are **pure functions** with unit tests. Services are thin.
- Services use `PrismaService` directly: no repository interfaces. There is one database and the tests run against a
  real one.
- Money is integer cents. Nights are calendar dates (`YYYY-MM-DD`), never timestamps, so timezones cannot shift a stay.
- Inbound webhooks verify `HMAC_SHA256(secret, rawBody)` with a constant-time compare, are idempotent per event id,
  and answer `200` on an overbooking (recording a sync issue) so the OTA does not retry forever.
- Outbound pushes are idempotent (they replace the OTA's whole 365-day calendar), retry with a delay, and end in a
  dead-letter queue after 5 attempts.

## Tests

| Layer | What | Tooling |
|---|---|---|
| Unit | pricing engine (100% branch coverage), availability, iCal export/parse/diff, HMAC, retry counting | Jest |
| End to end | HTTP → Postgres → RabbitMQ → mock OTA, concurrency, idempotency, retries and DLQ | Jest + Supertest + Testcontainers (Postgres 16, RabbitMQ 3.13) |

The e2e suite uses real infrastructure and never mocks the database. Docker must be running.

```bash
npm ci
npm test            # unit tests, then e2e
npm run test:e2e    # e2e only
```

Dates in tests are fixed (the app takes an injectable clock), so nothing depends on today's date.

## Configuration

See [`.env.example`](.env.example). The app validates its environment on startup and exits on a bad value.

## What I'd do next

- **CDC with Debezium** instead of polling the outbox, plus a retention job for published rows.
- **Split the worker** (outbox publisher, OTA consumer, iCal poller) out of the API process; partition work by property.
- **Real OTA APIs** (Airbnb, Booking.com, Expedia) behind the existing channel abstraction.
- **Per-channel rate limits** and circuit breaking for outbound calls.
- **Observability with OpenTelemetry**: traces across HTTP → outbox → RabbitMQ → OTA, plus metrics for queue depth and
  DLQ size.
- Multi-instance safety for iCal sync (advisory lock) and iCal recurrence rules.
