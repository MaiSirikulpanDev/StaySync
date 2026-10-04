# StaySync: Implementation Plan

> A small channel manager for short-term rental properties, built with NestJS.
> This is a portfolio project that shows backend skills in a realistic domain: bookings, availability, pricing, and syncing with third-party channels.
>
> **For Claude:** this file is the source of truth. Build it milestone by milestone (section 9). Don't add scope or dependencies that this file doesn't list unless you write down why in `docs/adr/`. Each milestone is done only when its acceptance criteria pass and `npm test` is green.

---

## 1. Goals

### What this project should show a reviewer

1. **Correctness under concurrency.** Two people booking the same dates at the same moment can never both succeed. The database guarantees it, not application code.
2. **Third-party integration done properly.** Outbound calls retry with backoff and go to a dead-letter queue when they keep failing. Inbound webhooks verify an HMAC signature and are idempotent. iCal import and export are real, so they work with Airbnb and Booking.com calendars.
3. **Event-driven design that doesn't lose messages.** A transactional outbox feeds RabbitMQ.
4. **Clean, testable code.** Pure domain functions for pricing and availability, thin services, and a real test pyramid: unit, integration, and e2e against real Postgres and RabbitMQ.
5. **Production habits.** Config validation, health checks, structured logs, migrations, Docker, CI, OpenAPI docs, and ADRs.

### Non-goals (do not build)

- No frontend. Swagger UI is the demo surface.
- No user accounts, roles or OAuth. A single API key guard is enough.
- No Kubernetes and no splitting into several deployable services. One NestJS app, plus a tiny mock OTA server used for demos and tests.
- No real payment processing.
- No multi-currency conversion. Each property has one currency.

---

## 2. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js 24 LTS (22 also works) | Current LTS |
| Framework | NestJS 11, TypeScript `strict: true` | Target stack |
| Database | PostgreSQL 16 | Range types plus an exclusion constraint prevent double booking (see §5) |
| ORM / migrations | Prisma | Typed client and migration files. The exclusion constraint goes in a raw-SQL migration. |
| Messaging | RabbitMQ 3.13 via `amqplib` (or `@nestjs/microservices` RMQ transport) | Topic exchange, retry queue and DLQ |
| Scheduling | `@nestjs/schedule` | Outbox publisher and iCal import polling |
| Validation | `class-validator` + `class-transformer` with a global `ValidationPipe` | Nest standard, and works with Swagger |
| Config | `@nestjs/config` with a `zod` schema | App fails fast on bad env |
| API docs | `@nestjs/swagger` | OpenAPI at `/docs` |
| Health | `@nestjs/terminus` | `/health` checks DB and RabbitMQ |
| Logging | `nestjs-pino` | Structured JSON logs with a request id |
| HTTP client | Node built-in `fetch` | No axios needed |
| iCal | `node-ical` for parsing; export written by hand (the format is small) | |
| Dates | Store as Postgres `DATE`; use `date-fns` for calculations | Booking nights are calendar dates, not instants |
| Testing | Jest (Nest default), Supertest, Testcontainers (Postgres and RabbitMQ) | Integration tests hit real infrastructure |
| Lint / format | ESLint + Prettier (Nest defaults) | |
| Containers | Dockerfile (multi-stage) + `docker-compose.yml` | `docker compose up` runs everything |
| CI | GitHub Actions: lint, typecheck, test | |

**Dependency rule:** if the stdlib or Nest already does it, don't add a package.

---

## 3. Domain model

### Key rules

- A **stay** occupies the half-open date range `[checkIn, checkOut)`. Checkout day is free for the next guest.
- Bookings and blocks live in **one table** (`stays`, with a `kind` column), so a single constraint prevents every overlap. Blocks are owner holds or dates imported from iCal.
- Money is stored as **integer cents**. Never use floats.
- Every stay that comes from a channel has `(source, externalId)`, and that pair is unique. This makes inbound sync idempotent.

### Tables (Prisma models)

```
Property
  id            uuid pk
  name          text
  timezone      text            -- e.g. "Australia/Brisbane"
  currency      char(3)         -- e.g. "AUD"
  baseRateCents int
  minStay       int  default 1
  maxGuests     int
  icalToken     text unique     -- secret for the export URL
  createdAt, updatedAt

Stay
  id            uuid pk
  propertyId    fk -> Property
  kind          enum(BOOKING, BLOCK)
  status        enum(CONFIRMED, CANCELLED)
  source        enum(DIRECT, ICAL, MOCK_OTA)
  externalId    text null       -- UID from iCal / OTA booking id
  checkIn       date
  checkOut      date            -- exclusive
  guestName     text null
  guestEmail    text null
  guests        int null
  totalCents    int null
  createdAt, updatedAt
  UNIQUE (source, externalId)
  CHECK (checkOut > checkIn)
  EXCLUDE (see §5)

PricingRule
  id            uuid pk
  propertyId    fk
  type          enum(SEASONAL, WEEKEND)
  startDate     date null       -- SEASONAL only
  endDate       date null       -- SEASONAL only, exclusive
  rateCents     int null        -- SEASONAL: replaces base rate
  adjustPercent int null        -- WEEKEND: e.g. +20
  minStay       int null        -- SEASONAL: overrides property minStay
  priority      int default 0

Channel
  id            uuid pk
  propertyId    fk
  type          enum(ICAL, MOCK_OTA)
  config        jsonb           -- ICAL: { url }, MOCK_OTA: { listingId }
  active        bool default true
  lastSyncedAt  timestamptz null
  lastSyncError text null

OutboxEvent
  id            uuid pk
  type          text            -- "stay.created", "stay.cancelled"
  payload       jsonb
  createdAt     timestamptz
  publishedAt   timestamptz null
  attempts      int default 0
  INDEX on (publishedAt) WHERE publishedAt IS NULL

ProcessedWebhook
  eventId       text pk         -- from OTA header, for idempotency
  receivedAt    timestamptz

SyncIssue
  id            uuid pk
  channelId     fk
  kind          text            -- "CONFLICT", "PARSE_ERROR", ...
  detail        jsonb
  createdAt     timestamptz
  resolvedAt    timestamptz null
```

---

## 4. Architecture

```mermaid
flowchart LR
  Client[API client / Swagger] -->|REST + API key| API[NestJS app]
  OTA[Mock OTA server] -->|webhook + HMAC| API
  API --> PG[(PostgreSQL)]
  API -->|outbox publisher| MQ[[RabbitMQ<br/>exchange: staysync.events]]
  MQ -->|stay.*| SyncConsumer[Channel sync consumer<br/>in the same app]
  SyncConsumer -->|push availability| OTA
  Scheduler[iCal import job] -->|fetch .ics| ExtCal[External iCal URL]
  Scheduler --> PG
  ExtCal2[Airbnb / Booking.com] -->|GET calendar.ics| API
```

One deployable app. The consumer and scheduler run inside it. Keep them in separate Nest modules so they could become separate workers later. Don't split them now.

### Folder structure

```
staysync/
├─ src/
│  ├─ main.ts
│  ├─ app.module.ts
│  ├─ config/                 # zod env schema, ConfigModule setup
│  ├─ common/                 # api-key guard, exception filter (Prisma error -> HTTP), date utils
│  ├─ prisma/                 # PrismaService (global module)
│  ├─ health/
│  ├─ properties/             # CRUD
│  ├─ pricing/
│  │  ├─ pricing.engine.ts    # PURE function: quote(property, rules, checkIn, checkOut) -> breakdown
│  │  ├─ pricing.engine.spec.ts
│  │  └─ pricing.service.ts / controller (rules CRUD + GET quote)
│  ├─ stays/                  # bookings + blocks, availability
│  │  ├─ availability.ts      # PURE: build day-by-day calendar from stays
│  │  └─ stays.service.ts     # create/cancel in a tx with an outbox row
│  ├─ outbox/                 # OutboxService.add(tx, event), OutboxPublisher (scheduled)
│  ├─ messaging/              # RabbitMQ connection, exchange/queue/DLQ setup, publish/consume helpers
│  ├─ channels/
│  │  ├─ channels.service.ts  # CRUD
│  │  ├─ ical/
│  │  │  ├─ ical.export.ts    # PURE: stays -> .ics string
│  │  │  ├─ ical.import.ts    # fetch + parse + diff (diff is a PURE function)
│  │  │  └─ ical.controller.ts# GET /properties/:id/calendar.ics?token=
│  │  └─ mock-ota/
│  │     ├─ ota.client.ts     # outbound push with timeout
│  │     ├─ ota.consumer.ts   # consumes stay.* -> pushes availability
│  │     └─ ota.webhook.controller.ts  # inbound, HMAC verify, idempotent
│  └─ sync-issues/            # read-only list + resolve endpoint
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/             # includes raw SQL for btree_gist + EXCLUDE
│  └─ seed.ts                 # 2 properties, rules, a few stays
├─ test/
│  ├─ setup/                  # Testcontainers bootstrap
│  ├─ stays.concurrency.e2e-spec.ts
│  ├─ booking-flow.e2e-spec.ts
│  ├─ ota-webhook.e2e-spec.ts
│  └─ ical.e2e-spec.ts
├─ tools/mock-ota/server.ts   # ~100 lines: receives availability pushes, sends signed webhooks on demand
├─ docs/
│  ├─ adr/0001-exclusion-constraint.md
│  ├─ adr/0002-transactional-outbox.md
│  └─ adr/0003-single-stays-table.md
├─ Dockerfile
├─ docker-compose.yml         # app, postgres, rabbitmq, mock-ota
├─ .github/workflows/ci.yml
├─ .env.example
└─ README.md
```

### Deliberate simplicity (explain these in the README; they make good interview answers)

- Services use `PrismaService` directly. **No repository interfaces.** There is one database, and integration tests run against real Postgres.
- Domain logic (pricing, availability, iCal diff and export) is written as **pure functions**. That's where unit tests focus.
- The outbox publisher polls every second. `FOR UPDATE SKIP LOCKED` makes it safe to run more than one instance. CDC with Debezium is the upgrade path; not needed at this scale.

---

## 5. Preventing double bookings

Migration (raw SQL, added after the Prisma-generated table):

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Stay"
  ADD CONSTRAINT stay_no_overlap
  EXCLUDE USING gist (
    "propertyId" WITH =,
    daterange("checkIn", "checkOut", '[)') WITH &&
  ) WHERE (status = 'CONFIRMED');
```

- Cancelled stays don't count because of the `WHERE` clause.
- In the global exception filter, map Postgres error **`23P01`** (exclusion violation) to **HTTP 409 Conflict** with `{ code: "DATES_UNAVAILABLE" }`. Map `23505` on `(source, externalId)` to an idempotent "already exists" result.
- **Prisma caveat:** Prisma has no P-code for `23P01`. It usually surfaces as `PrismaClientUnknownRequestError` with the Postgres code or `stay_no_overlap` in the message. Write one helper `isOverlapError(e)` that checks this, and cover it with the concurrency test. If it proves unreliable, insert stays with `$queryRaw` (Prisma then returns P2010 with `meta.code = '23P01'`) and record the choice in an ADR.
- **Don't** pre-check availability in code as the guarantee. A pre-check is fine for a nicer error message, but the constraint is the real guard.
- **Required test:** fire 20 parallel `POST /stays` requests for the same property and dates. Exactly 1 returns 201 and 19 return 409.

---

## 6. API

All routes except `/health`, `/docs`, the iCal export and the OTA webhook need the `x-api-key` header.

| Method | Path | Purpose |
|---|---|---|
| POST/GET/PATCH | `/properties`, `/properties/:id` | Property CRUD |
| POST/GET/DELETE | `/properties/:id/pricing-rules` | Pricing rules |
| GET | `/properties/:id/quote?checkIn&checkOut&guests` | Price breakdown per night, total, min-stay check |
| GET | `/properties/:id/availability?from&to` | Day-by-day `{date, available, stayId?, rateCents}` |
| POST | `/properties/:id/stays` | Create a direct booking or block. Body: `kind`, dates, guest info |
| GET | `/properties/:id/stays?from&to&status` | List stays |
| POST | `/stays/:id/cancel` | Cancel (idempotent) |
| POST/GET/DELETE | `/properties/:id/channels` | Connect iCal URL or mock OTA listing |
| POST | `/channels/:id/sync` | Trigger an iCal import now |
| GET | `/properties/:id/calendar.ics?token=` | iCal export (token auth) |
| POST | `/webhooks/mock-ota` | Inbound OTA events (HMAC auth) |
| GET/POST | `/sync-issues`, `/sync-issues/:id/resolve` | Conflicts that need a human |
| GET | `/health` | DB and RabbitMQ status |

Errors use one shape: `{ statusCode, code, message, details? }`.

---

## 7. Flows

### 7.1 Direct booking

```mermaid
sequenceDiagram
  participant C as Client
  participant API as StaysService
  participant DB as Postgres
  participant P as OutboxPublisher
  participant MQ as RabbitMQ
  participant K as OtaConsumer
  participant O as Mock OTA
  C->>API: POST /properties/:id/stays
  API->>API: validate DTO, guests <= maxGuests
  API->>API: pricing.engine.quote() -> totalCents, minStay check
  API->>DB: BEGIN; INSERT Stay; INSERT OutboxEvent(stay.created); COMMIT
  alt dates overlap
    DB-->>API: 23P01
    API-->>C: 409 DATES_UNAVAILABLE
  else ok
    API-->>C: 201 stay
  end
  loop every 1s
    P->>DB: SELECT unpublished FOR UPDATE SKIP LOCKED LIMIT 50
    P->>MQ: publish (routing key = event type)
    P->>DB: set publishedAt
  end
  MQ->>K: stay.created
  K->>O: PUT /listings/:listingId/availability
  alt failure
    K->>MQ: nack -> retry queue (TTL backoff), after 5 tries -> DLQ
  end
```

The consumer skips the push when the stay came from that same OTA (`source = MOCK_OTA`), so events don't echo back.

### 7.2 Inbound OTA webhook

1. Read the raw body. Verify `x-ota-signature = HMAC_SHA256(secret, rawBody)` with `crypto.timingSafeEqual`. If it fails, return 401. This needs `rawBody: true` in `NestFactory.create`.
2. If `x-ota-event-id` is already in `ProcessedWebhook`, return 200 and do nothing.
3. In one transaction: insert `ProcessedWebhook`, then upsert the stay by `(MOCK_OTA, externalId)`:
   - `booking.created` → insert a CONFIRMED BOOKING
   - `booking.cancelled` → set CANCELLED
4. On `23P01` (overbooking), insert a `SyncIssue{kind: CONFLICT}`, log a warning, and **still return 200**. The OTA should not retry forever; a human resolves it.
5. Add an outbox event so other channels get the update.

### 7.3 iCal import (scheduled, every 15 min per active ICAL channel, plus manual trigger)

1. `fetch(url)` with a 10s timeout. On error, set `lastSyncError` and stop.
2. Parse with `node-ical` and keep `VEVENT`s, mapping `UID → {checkIn, checkOut}`.
3. **Pure diff** of remote vs existing `(ICAL, externalId)` stays for this property → `{toCreate, toUpdate, toCancel}`.
4. Apply in one transaction as BLOCK stays. Each overlap becomes a `SyncIssue` and doesn't abort the rest.
5. Set `lastSyncedAt` and clear `lastSyncError`.

### 7.4 iCal export

`GET /properties/:id/calendar.ics?token=…` returns `text/calendar`: one `VEVENT` per CONFIRMED stay, with all-day `DTSTART;VALUE=DATE` and exclusive `DTEND`, a stable `UID = <stayId>@staysync`, and no guest PII (summary is "Reserved"). Validate the output with `node-ical` in a test.

### 7.5 Pricing (pure function)

For each night in `[checkIn, checkOut)`:

1. Start with `baseRateCents`.
2. If a SEASONAL rule covers the night, use its `rateCents`. On overlap, the highest `priority` wins.
3. If the night is Fri or Sat and a WEEKEND rule exists, apply `adjustPercent` and round to whole cents.

The effective minStay is the max SEASONAL `minStay` covering the check-in night, else the property's `minStay`. Return `{ nights: [{date, rateCents, ruleIds}], totalCents, currency, minStay, meetsMinStay }`.

### 7.6 RabbitMQ topology (declared at startup, idempotent)

- Exchange `staysync.events` (topic)
- Queue `ota-sync`, bound to `stay.*`, with dead-letter exchange set to `staysync.retry`
- Queue `ota-sync.retry` with TTL 10s, dead-lettering back to `staysync.events`
- Queue `ota-sync.dlq`: after 5 attempts (tracked in the `x-death` header), publish here and ack

---

## 8. Config (`.env.example`)

```
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://staysync:staysync@localhost:5432/staysync
RABBITMQ_URL=amqp://guest:guest@localhost:5672
API_KEY=dev-api-key
OTA_BASE_URL=http://localhost:4000
OTA_WEBHOOK_SECRET=dev-webhook-secret
ICAL_POLL_CRON=*/15 * * * *
OUTBOX_POLL_MS=1000
```

---

## 9. Milestones

Commit at the end of each milestone. Every milestone keeps `npm run lint && npm run build && npm test` green.

### M0 Scaffold
- `nest new`, set strict TS, ESLint and Prettier
- `docker-compose.yml` with postgres, rabbitmq (management image) and an app service
- Prisma init and an empty migration; `PrismaService`
- Config module with the zod schema; app exits on invalid env
- `nestjs-pino`, global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`), global exception filter, API key guard
- `/health` (terminus) and Swagger at `/docs`
- Testcontainers setup in `test/setup` and a smoke e2e test for `/health`
- GitHub Actions: install, lint, build, test

**Done when:** `docker compose up` serves `/health` = ok, and CI is green.

### M1 Properties and pricing
- Property CRUD; generate `icalToken` on create
- PricingRule CRUD
- `pricing.engine.ts` as a pure function, with thorough unit tests covering base rate, seasonal, overlapping seasonal by priority, weekend %, rounding, minStay override, and a 1-night stay
- `GET /quote`

**Done when:** pricing engine has 100% branch coverage and the quote e2e test passes.

### M2 Stays and availability (core)
- Stay model plus the raw-SQL exclusion constraint migration
- Create, list and cancel stays, validating guests, minStay and `checkOut > checkIn`
- Exception filter maps `23P01` to 409 and `23505` to 409 or idempotent
- `availability.ts` pure function and the `GET /availability` endpoint
- **Concurrency e2e test** (20 parallel requests, exactly 1 succeeds)
- Back-to-back test: checkout 10th plus check-in 10th both succeed
- Cancelled stay frees its dates

**Done when:** all of the above tests pass.

### M3 Outbox and RabbitMQ
- `OutboxService.add(tx, type, payload)` used inside stay create and cancel transactions
- `OutboxPublisher` using `SKIP LOCKED`, `attempts++` on failure
- RabbitMQ topology from §7.6
- `tools/mock-ota/server.ts`: `PUT /listings/:id/availability` stores calls in memory with `GET /_calls` to inspect; `?fail=n` env/flag to simulate failures
- `OtaConsumer`: on stay.*, rebuild availability for the next 365 days, PUT to the OTA, skip echo

**Done when:** e2e test creates a booking and the mock OTA receives the push within 5s. A test with forced failures ends in the DLQ after 5 attempts. A test shows that if the publish fails, the event is retried, not lost.

### M4 Inbound webhook
- `rawBody` enabled; HMAC verification guard
- Idempotency via `ProcessedWebhook`
- Created and cancelled handling; conflict goes to `SyncIssue` with a 200 response
- Mock OTA gets `POST /_simulate/booking` to send a signed webhook to the app
- `/sync-issues` endpoints

**Done when:** e2e tests cover a bad signature (401), a duplicate event (processed once), a new booking (stay appears), a cancel, and an overlap (SyncIssue, 200).

### M5 iCal
- Export endpoint, validated by parsing its own output in a test
- Import with a pure diff function plus unit tests (create, update when dates change, cancel when the UID disappears, conflict)
- Scheduled job plus `POST /channels/:id/sync`
- Mock OTA serves a static `.ics` at `/listings/:id/calendar.ics` for e2e

**Done when:** e2e test imports a calendar, a block appears, the remote calendar changes, the next sync updates it, and a removed event gets cancelled.

### M6 Polish (this is what reviewers see first)
- `prisma/seed.ts` with demo data
- README:
  - one-paragraph pitch
  - architecture mermaid diagram
  - quick start (`docker compose up`, open `/docs`)
  - a "Design decisions" section linking the ADRs
  - a "What I'd do next" section: CDC/Debezium, splitting the worker, real OTA APIs, rate limits per channel, observability with OpenTelemetry
  - test strategy and how to run tests
- 3 ADRs: exclusion constraint vs app-level locking; transactional outbox vs publish-after-commit; one stays table vs separate bookings and blocks
- `scripts/demo.sh` that runs curl calls: create property, quote, book, try a double booking (409), simulate an OTA booking, show the mock OTA received the push
- Coverage badge (optional)

**Done when:** a stranger can clone, run one command, and follow the README demo in under 5 minutes.

---

## 10. Testing strategy

| Layer | What | Tooling |
|---|---|---|
| Unit | pricing engine, availability builder, iCal export and diff, HMAC verify | Jest, no Nest testing module needed |
| Integration / e2e | HTTP → DB → MQ → mock OTA, concurrency, idempotency | Jest + Supertest + Testcontainers (Postgres 16, RabbitMQ 3.13); mock OTA started in-process |
| CI | All of the above | GitHub Actions `ubuntu-latest` (Docker available for Testcontainers) |

Rules:

- No mocking Prisma. Use the real database in integration tests and truncate tables between tests.
- Use a fixed "today" in date tests by injecting a clock or passing dates explicitly. Never depend on the real current date.
- Test names describe behavior, e.g. `rejects overlapping booking with 409`.

---

## 11. Interview talking points (for the owner, not for Claude to build)

- Why the database constraint beats `SELECT … then INSERT` (race condition), and why it beats a distributed lock
- Outbox: what goes wrong with publish-after-commit and with publish-before-commit
- Webhook design: signature, idempotency, return 200 on conflict, and why
- Half-open date ranges and timezone handling for hotels and rentals
- What changes at 100x scale: split the worker, partition by property, CDC, per-channel rate limits
- Link to real experience: RIS inventory centralization (cross-store stock), Astrofy PHP → Ruby → Node.js migrations, payment gateway idempotency
