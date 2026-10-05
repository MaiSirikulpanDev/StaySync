# 4. M3 deviations from PLAN.md

Status: accepted

- **`RETRY_DELAY_MS` env var (default 10000).** PLAN §7.6 fixes the retry queue TTL at 10s. A test that proves
  "5 attempts, then DLQ" would take about 50s at that value, so the TTL is configurable; production keeps 10s.
- **`Channel` table added in M3, not M5.** The OTA consumer needs the listing id to push to. Channel CRUD endpoints
  (PLAN §6) are still unscheduled in the milestones; tests insert channels directly.
- **Outbox poll uses `setInterval`, not `@nestjs/schedule`.** One fixed-interval loop needs no dependency.
  `@nestjs/schedule` arrives with the iCal cron in M5.
- **Partial index on `OutboxEvent("createdAt")`**, not `("publishedAt")`: the publisher scans unpublished rows oldest first.
- **amqplib's built-in `recovery` option** re-declares topology and re-attaches consumers after a reconnect, instead of hand-written reconnect code.
