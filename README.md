# StaySync

[![CI](https://github.com/MaiSirikulpanDev/StaySync/actions/workflows/ci.yml/badge.svg)](https://github.com/MaiSirikulpanDev/StaySync/actions/workflows/ci.yml)

A small channel manager for short-term rental properties, built with NestJS. It keeps one availability calendar per
property and keeps it in sync with the outside world: two guests can never book the same night, outbound updates reach
the OTA even when it is down, inbound webhooks are verified and idempotent, and iCal feeds work with Airbnb and
Booking.com.

It is a portfolio project, so it deliberately stays small: no frontend (Swagger UI is the demo surface), no user
accounts (one API key), one codebase that runs as two processes (`api` and `worker`) plus a tiny mock OTA.

## Architecture

```mermaid
flowchart LR
  Client[API client / Swagger] -->|REST + API key| API[api process]
  OTA[Mock OTA] -->|signed webhook| API
  API --> PG[(PostgreSQL)]
  PG -->|outbox publisher| K[[Kafka<br/>staysync.stay-events<br/>key = propertyId]]
  K -->|group ota-sync| W[worker replicas x2]
  K -->|group occupancy-projection| W
  W -->|push availability| OTA
  W -->|projection + inbox| PG
  K -.->|failed| R[[stay-events.retry]] -.-> W
  R -.->|after 5 tries| D[[stay-events.dlq]]
  Scheduler[iCal poller in worker] -->|fetch .ics| Ext[External iCal URL]
  Airbnb[Airbnb / Booking.com] -->|GET calendar.ics| API
  API -.->|OTLP traces| J[Jaeger]
  W -.->|OTLP traces| J
```

One codebase, two entrypoints from the same image: `node dist/main` (HTTP only) and `node dist/worker` (outbox publisher, the `ota-sync` and `occupancy-projection` consumers, iCal poller). `docker compose up` runs the worker with 2 replicas that share the Kafka partitions; the iCal sync takes a per-channel Postgres advisory lock so replicas never sync the same feed twice.

## Quick start

You need Docker (and `curl` for the demo).

```bash
docker compose up --build
```

- Swagger UI: <http://localhost:3000/docs> (click **Authorize**, key `dev-api-key`)
- Health: <http://localhost:3000/health> (database, Kafka, consumer lag per group, DLQ depth)
- Traces: <http://localhost:16686> (Jaeger)

Then, in another terminal, watch the whole story run:

```bash
./scripts/demo.sh
```

It creates a property and a channel, quotes and books a stay, attempts a double booking (409 from the database),
shows the booking arrive at the mock OTA, receives a signed OTA booking, records an overbooking as a sync issue, and
kills one of the two workers and shows the next booking still reaches the OTA, and prints the iCal feed.

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
| POST | `/mcp` | MCP tools for AI assistants (see below) |

## Use it from an AI assistant (MCP)

The app is also an [MCP](https://modelcontextprotocol.io) server at `POST /mcp` (Streamable HTTP, stateless, same
`x-api-key`). It offers five read-only tools: `list_properties`, `get_property`, `check_availability`, `get_quote` and
`find_stays`. They call the same services as the REST API. Tool results never include guest emails, surnames or the
iCal secret.

Claude Code:

```bash
claude mcp add --transport http staysync http://localhost:3000/mcp --header "x-api-key: dev-api-key"
```

Claude Desktop (`claude_desktop_config.json`), through the `mcp-remote` bridge:

```json
{
  "mcpServers": {
    "staysync": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:3000/mcp", "--header", "x-api-key:dev-api-key"]
    }
  }
}
```

Then ask, for example: *"Is Beach House free from 12 to 15 December for 4 guests, and what would it cost?"*

## Design decisions

- **The database prevents double bookings**, not application code: a PostgreSQL exclusion constraint on a half-open
  date range. [ADR 1](docs/adr/0001-exclusion-constraint.md)
- **A transactional outbox** feeds Kafka, so an event is never lost and never describes a rolled-back change.
  [ADR 2](docs/adr/0002-transactional-outbox.md)
- **One `Stay` table** for bookings, owner blocks and imported dates, so a single constraint covers all of them.
  [ADR 3](docs/adr/0003-single-stays-table.md)
- Notes on where the build differs from the original plan and why:
  [ADR 4](docs/adr/0004-m3-deviations.md), [ADR 5](docs/adr/0005-m5-deviations.md).
- **Kafka instead of RabbitMQ**, keyed by property so one property's events stay in order.
  [ADR 6](docs/adr/0006-rabbitmq-to-kafka.md)
- **An inbox table** makes consumers idempotent, so duplicate deliveries change nothing.
  [ADR 7](docs/adr/0007-inbox-table.md)

Smaller choices worth knowing:

- Pricing, availability, iCal export and the iCal diff are **pure functions** with unit tests. Services are thin.
- Services use `PrismaService` directly: no repository interfaces. There is one database and the tests run against a
  real one.
- Money is integer cents. Nights are calendar dates (`YYYY-MM-DD`), never timestamps, so timezones cannot shift a stay.
- Inbound webhooks verify `HMAC_SHA256(secret, rawBody)` with a constant-time compare, are idempotent per event id,
  and answer `200` on an overbooking (recording a sync issue) so the OTA does not retry forever.
- Outbound pushes are idempotent (they replace the OTA's whole 365-day calendar), retry with a delay, and end in a
  dead-letter queue after 5 attempts.

## Phase 1 → Phase 2: RabbitMQ to Kafka and a real worker

Phase 1 (branch [`v1-rabbitmq`](../../tree/v1-rabbitmq)) was one process on RabbitMQ. Phase 2 keeps the same
domain and swaps the plumbing, so the before/after is easy to compare.

| | Phase 1 (RabbitMQ) | Phase 2 (Kafka) |
|---|---|---|
| Processes | one app | `api` (HTTP) and `worker`, same image, worker runs 2 replicas |
| Ordering | none across messages | per property (partition key = `propertyId`) |
| Consumers | one queue, one consumer | independent groups: `ota-sync` and `occupancy-projection` |
| Retry / DLQ | TTL retry queue, `x-death` count | retry topic with `x-attempt` and `x-not-before` headers, DLQ topic |
| Replay | none, acked messages are gone | 7 days of retention; `npm run replay:occupancy` rebuilds the read model |
| Duplicates | possible, one idempotent consumer | possible; inbox table (`ProcessedEvent`) makes consumers idempotent |
| Offsets | n/a (acks) | committed explicitly after the side effect |
| Given up | | simple per-message retry and routing, now hand-built |

How it holds up when a worker dies: the failure test starts two workers in one consumer group, publishes 120 events,
stops one of them mid-stream, and checks that every event took effect exactly once (120 inbox rows, projection totals
exactly 120 nights and 12,000 cents). It passed 10 runs in a row locally.

### Seeing one request as one trace

With `docker compose up`, book a stay (or run `./scripts/demo.sh`) and open Jaeger at <http://localhost:16686>. Pick
service `staysync-api` and the `POST /properties/:id/stays` trace: it continues through `outbox publish`, the two
consumer groups (`ota-sync process`, `occupancy-projection process`) and `ota push`. The trace context is stored on the
outbox row and travels in the Kafka `traceparent` header, so the async hop does not break the trace. If the caller
sends a `traceparent` header, the trace continues from it.

## Tests

| Layer | What | Tooling |
|---|---|---|
| Unit | pricing engine (100% branch coverage), availability, iCal export/parse/diff, HMAC, retry counting, event envelopes, occupancy reducer | Jest |
| End to end | HTTP → Postgres → Kafka → mock OTA, concurrency, idempotency, retries and DLQ, event ordering, replay equals live, worker failure, trace propagation | Jest + Supertest + Testcontainers (Postgres 16, Kafka 7.7 (KRaft)) |

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

- **CDC with Debezium** instead of polling the outbox (Outbox Event Router), plus a retention job for old outbox rows.
  Not built yet: it needs a Kafka Connect image, and the polling publisher is safe for multiple replicas meanwhile.
- **Schema registry** (Avro or Protobuf) instead of a versioned JSON envelope checked with `zod`.
- **Exactly-once transactions** only if an effect ever lives in Kafka itself; today idempotent consumers are enough.
- **Partition planning for hot properties**: one very busy property pins one partition, so I would size partitions from
  real traffic.
- **Real OTA APIs** (Airbnb, Booking.com, Expedia) behind the existing channel abstraction.
- **Per-channel rate limits** and circuit breaking for outbound calls.
- iCal recurrence rules.
