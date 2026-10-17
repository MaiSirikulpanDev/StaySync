# 6. RabbitMQ to Kafka

Status: accepted (Phase 2, M7). The RabbitMQ version stays on branch `v1-rabbitmq`.

## Why

- **Replay.** Kafka keeps events for 7 days, so a new consumer (the M9 read model) can rebuild from the start of the stream. RabbitMQ deletes a message once it is acked.
- **Many independent consumers.** Each consumer group has its own offsets on the same topic; no extra queue and binding per consumer.
- **Per-key ordering.** The key is `propertyId`, so all events of one property go to one partition and are read in order.
- **Horizontal scale.** Partitions are shared between replicas of a group, and a dead replica's partitions move to the others.

## What we give up

- Per-message retry and routing: RabbitMQ gives these with TTL queues and `x-death`. Here they are built by hand with a retry topic (`x-attempt`, `x-not-before` headers) and a DLQ topic.
- A retry waits inside the consumer until `x-not-before`, which pauses that partition. Fine at this scale; it also keeps per-partition order during a retry.
- A failed event that goes through the retry topic is no longer ordered against newer events of the same property. The OTA consumer rebuilds the full calendar from the database on every event, so this is harmless.

## Client library

`@confluentinc/kafka-javascript` with its KafkaJS-compatible API (`KafkaJS.Kafka`). KafkaJS itself is no longer maintained; this client is maintained by Confluent and wraps librdkafka (prebuilt binaries, no compile step). It is a thin API swap if we ever need to change again.

## Delivery

- Producer: `acks=all`, `idempotent=true`. The outbox publisher sets `publishedAt` only after the broker acks.
- Consumer: offsets are committed only after the handler (or the hand-off to retry/DLQ) succeeds. Crash means redelivery, so consumers must be idempotent.
- Topics (`staysync.stay-events`, `.retry` with 6 partitions, `.dlq` with 1) are created at startup by the admin client.
