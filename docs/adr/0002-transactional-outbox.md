# 2. Publish events through a transactional outbox

Status: accepted

## Context

Creating or cancelling a stay must tell other systems (the OTA) about it. The database write and the message to
RabbitMQ are two different systems, and we cannot commit to both atomically.

## Options considered

| Option | Failure mode |
|---|---|
| Publish after commit | The process dies between `COMMIT` and `publish`: the stay exists, the OTA never hears about it. A lost message that nobody notices. |
| Publish before commit | The commit fails after publishing: the OTA is told about a stay that does not exist. |
| Two-phase commit | Not supported by RabbitMQ in any practical way. |
| Change data capture (Debezium) | The right answer at scale, but a lot of infrastructure for this project. |

## Decision

Write an `OutboxEvent` row **in the same transaction** as the stay. A publisher polls the table (every
`OUTBOX_POLL_MS`, default 1s), claims a batch with `SELECT … FOR UPDATE SKIP LOCKED`, publishes each event with a
broker confirm, and only then sets `publishedAt`. Failures increment `attempts` and leave the row for the next poll.

On the consuming side the `ota-sync` queue dead-letters rejected messages to a retry queue (TTL, default 10s) that
feeds them back in; after 5 attempts a message is parked in `ota-sync.dlq` and acknowledged.

## Consequences

- At-least-once delivery. A crash after publishing but before the row is marked published sends the event again, so
  consumers must be idempotent. The OTA consumer rebuilds the whole 365-day calendar instead of applying a delta, which
  makes replays harmless.
- `SKIP LOCKED` makes it safe to run several instances; ordering across instances is not guaranteed (another reason
  for the full-rebuild consumer).
- Latency is bounded by the poll interval, not zero.
- Published rows are never deleted yet. A retention job is the obvious next step.
- A permanently failing event blocks the ones behind it (the publisher stops at the first failure to keep order).
  A max-attempts parking state would fix that; it is marked in the code.
- The upgrade path to CDC is clean: the outbox table is already the source of truth.
