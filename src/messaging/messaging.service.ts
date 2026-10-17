import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
} from '@opentelemetry/api';
import type { Env } from '../config/env.schema';
import { inSpan, contextFrom, traceparentOf } from '../tracing/trace';
import { StayEvent, stayEventSchema, toEnvelope } from '../events/stay-events';
import {
  ATTEMPT_HEADER,
  attemptCount,
  NOT_BEFORE_HEADER,
  notBefore,
} from './retry';

export const EVENTS_TOPIC = 'staysync.stay-events';
export const RETRY_TOPIC = `${EVENTS_TOPIC}.retry`;
export const DLQ_TOPIC = `${EVENTS_TOPIC}.dlq`;
export const OTA_GROUP = 'ota-sync';
export const MAX_ATTEMPTS = 5;
const GROUP_HEADER = 'x-group';

type Handler = (event: StayEvent) => Promise<void>;

const TOPICS = [
  { topic: EVENTS_TOPIC, numPartitions: 6 },
  { topic: RETRY_TOPIC, numPartitions: 6 },
  { topic: DLQ_TOPIC, numPartitions: 1 },
];
/** Retry and DLQ copies keep the trace of the original event. */
const traceHeaders = (headers: Record<string, unknown> | undefined) => {
  const traceparent = traceparentOf(headers);
  return traceparent ? { traceparent } : {};
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

@Injectable()
export class MessagingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagingService.name);
  private readonly kafka: KafkaJS.Kafka;
  private readonly producer: KafkaJS.Producer;
  private readonly admin: KafkaJS.Admin;
  private readonly consumers: KafkaJS.Consumer[] = [];

  constructor(private readonly config: ConfigService<Env, true>) {
    this.kafka = new KafkaJS.Kafka({
      kafkaJS: {
        clientId: 'staysync',
        brokers: String(this.config.get('KAFKA_BROKERS')).split(','),
      },
    });
    // acks=all + idempotence: broker-side dedupe of producer retries, no reordering.
    this.producer = this.kafka.producer({
      kafkaJS: { acks: -1, idempotent: true },
    });
    this.admin = this.kafka.admin();
  }

  async onModuleInit() {
    await this.admin.connect();
    // Idempotent: existing topics are left alone. Retried because a fresh broker (or a topic
    // created a moment ago by another instance) can briefly answer with a transient error.
    for (let attempt = 1; ; attempt++) {
      try {
        await this.admin.createTopics({ topics: TOPICS });
        break;
      } catch (e) {
        if (attempt >= 5) throw e;
        await sleep(500);
      }
    }
    await this.producer.connect();
  }

  async onModuleDestroy() {
    await Promise.all(this.consumers.map((c) => c.disconnect()));
    await this.producer.disconnect();
    await this.admin.disconnect();
  }

  /** Validates the envelope, then resolves once the broker has acked (acks=all). */
  async publish(row: {
    id: string;
    type: string;
    payload: unknown;
    createdAt: Date;
    traceparent?: string | null;
  }): Promise<void> {
    const event = toEnvelope(row);
    // Child of the request that wrote the outbox row; its own context rides in the Kafka headers.
    await inSpan(
      'outbox publish',
      SpanKind.PRODUCER,
      contextFrom(row.traceparent),
      async () => {
        const headers: Record<string, string> = {};
        propagation.inject(context.active(), headers);
        await this.send(EVENTS_TOPIC, {
          key: event.propertyId,
          value: JSON.stringify(event),
          headers,
        });
      },
    );
  }

  /** Health probe: asks the cluster for its topic list. */
  async ping(): Promise<void> {
    await this.admin.listTopics();
  }

  /** Messages the group has not committed yet, over the main and retry topics. */
  async lag(group: string): Promise<number> {
    const topics = [EVENTS_TOPIC, RETRY_TOPIC];
    const committed = await this.admin.fetchOffsets({ groupId: group, topics });
    let lag = 0;
    for (const topic of topics) {
      const done = committed.find((c) => c.topic === topic)?.partitions ?? [];
      for (const end of await this.admin.fetchTopicOffsets(topic)) {
        const c = Number(
          done.find((p) => p.partition === end.partition)?.offset ?? -1,
        );
        // no commit yet: the group starts from the earliest offset
        lag += Number(end.high) - (c >= 0 ? c : Number(end.low));
      }
    }
    return lag;
  }

  /** Messages currently parked in the DLQ topic. */
  async dlqDepth(): Promise<number> {
    const ends = await this.admin.fetchTopicOffsets(DLQ_TOPIC);
    return ends.reduce((n, e) => n + Number(e.high) - Number(e.low), 0);
  }

  /**
   * Starts one member of consumer group `group`, reading the main and the retry topic.
   * The offset is committed only after the handler (or the hand-off to retry/DLQ) succeeded,
   * so a crash means redelivery, never loss.
   */
  async consume(group: string, handler: Handler) {
    const consumer = this.kafka.consumer({
      kafkaJS: { groupId: group, fromBeginning: true, autoCommit: false },
    });
    this.consumers.push(consumer);
    await consumer.connect();
    await consumer.subscribe({ topics: [EVENTS_TOPIC, RETRY_TOPIC] });
    await consumer.run({
      eachMessage: async ({ topic, partition, message }) => {
        await this.handle(group, handler, topic, message);
        // Only now, after the side effect (or the hand-off to retry/DLQ): a crash before this
        // line means redelivery, never loss.
        await consumer.commitOffsets([
          {
            topic,
            partition,
            offset: (BigInt(message.offset) + 1n).toString(),
          },
        ]);
      },
    });
  }

  private async handle(
    group: string,
    handler: Handler,
    topic: string,
    message: KafkaJS.Message & { offset: string },
  ) {
    // Retry/DLQ topics are shared; a retry is only for the group that failed.
    if (
      topic === RETRY_TOPIC &&
      message.headers?.[GROUP_HEADER]?.toString() !== group
    )
      return;
    // Retries wait out their delay here, which also keeps per-partition order.
    const wait = notBefore(message.headers) - Date.now();
    if (topic === RETRY_TOPIC && wait > 0) await sleep(wait);
    const raw = message.value?.toString() ?? '';
    const event = this.decode(raw);
    if (event instanceof Error) {
      // Poison message: retrying cannot fix it, so park it and move on.
      this.logger.warn(`${group} invalid message: ${event.message}`);
      await this.send(DLQ_TOPIC, {
        key: message.key?.toString() ?? null,
        value: raw,
        headers: {
          'x-error': event.message,
          [GROUP_HEADER]: group,
          ...traceHeaders(message.headers),
        },
      });
      return;
    }
    const tp = traceparentOf(message.headers);
    try {
      await inSpan(
        `${group} process`,
        SpanKind.CONSUMER,
        tp
          ? propagation.extract(ROOT_CONTEXT, { traceparent: tp })
          : ROOT_CONTEXT,
        () => handler(event),
      );
    } catch (e) {
      await this.fail(message, raw, e as Error, group);
    }
  }

  private decode(raw: string): StayEvent | Error {
    try {
      return stayEventSchema.parse(JSON.parse(raw));
    } catch (e) {
      return e instanceof Error ? e : new Error(String(e));
    }
  }

  private async fail(
    message: KafkaJS.Message & { key?: unknown },
    raw: string,
    e: Error,
    group: string,
  ) {
    const attempt = attemptCount(message.headers) + 1;
    this.logger.warn(
      `${group} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${e.message}`,
    );
    const key = message.key?.toString() ?? null;
    if (attempt < MAX_ATTEMPTS) {
      const delay = Number(this.config.get('RETRY_DELAY_MS'));
      return this.send(RETRY_TOPIC, {
        key,
        value: raw,
        headers: {
          [ATTEMPT_HEADER]: String(attempt),
          [GROUP_HEADER]: group,
          ...traceHeaders(message.headers),
          [NOT_BEFORE_HEADER]: String(Date.now() + delay),
        },
      });
    }
    // Out of attempts: park it (acked) before the offset is committed so it cannot be lost.
    return this.send(DLQ_TOPIC, {
      key,
      value: raw,
      headers: {
        [ATTEMPT_HEADER]: String(attempt),
        [GROUP_HEADER]: group,
        ...traceHeaders(message.headers),
        'x-error': e.message,
      },
    });
  }

  private send(topic: string, message: KafkaJS.Message) {
    return this.producer.send({ topic, messages: [message] });
  }
}
