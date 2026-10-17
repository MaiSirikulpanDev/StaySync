# 7. Inbox table for idempotent consumers

Status: accepted (Phase 2, M9)

## Problem

Kafka delivers at least once: a consumer can crash after its side effect but before its offset commit, a rebalance can hand a partition to another member mid-batch, and the outbox publisher can republish a row. A consumer that adds to a counter would count the same event twice.

## Decision

`ProcessedEvent(consumerGroup, eventId)` is the consumer's inbox. The projection inserts its row and updates the read model in **one transaction**:

- Duplicate delivery: the insert is skipped (`ON CONFLICT DO NOTHING`), the handler returns, nothing changes.
- Crash before commit: neither the inbox row nor the read-model change exists, so the redelivery applies it once.

`eventId` is the outbox row id, so a republished event keeps the same id. The key includes the consumer group, so each group dedupes on its own.

## Alternatives

- **Offsets in the same transaction as the effect** (store offsets in Postgres): no extra table, but ties the consumer to partition assignment and breaks on replay by id. Rejected.
- **Naturally idempotent writes** (set, not add): used by `ota-sync`, which rebuilds the full calendar from the database on every event, so it needs no inbox. The projection adds counters, so it does.
- **Kafka exactly-once transactions**: only covers Kafka-to-Kafka; our effect is in Postgres. Out of scope in the plan.

## Replay

`npm run replay:occupancy` deletes the consumer group (drops its offsets) and truncates the projection and its inbox rows. The consumer restarts from the earliest offset and rebuilds. The reducer returns sums, so the result does not depend on delivery order.
