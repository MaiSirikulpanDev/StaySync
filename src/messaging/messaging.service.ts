import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KafkaJS } from '@confluentinc/kafka-javascript';
import type { Env } from '../config/env.schema';
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

type Handler = (event: StayEvent) => Promise<void>;

const TOPICS = [
  { topic: EVENTS_TOPIC, numPartitions: 6 },
  { topic: RETRY_TOPIC, numPartitions: 6 },
  { topic: DLQ_TOPIC, numPartitions: 1 },
];
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
    // Idempotent: existing topics are left alone.
    await this.admin.createTopics({ topics: TOPICS });
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
  }): Promise<void> {
    const event = toEnvelope(row);
    await this.send(EVENTS_TOPIC, {
      key: event.propertyId,
      value: JSON.stringify(event),
    });
  }

  /** Health probe: asks the cluster for its topic list. */
  async ping(): Promise<void> {
    await this.admin.listTopics();
  }

  /**
   * Starts one member of consumer group `group`, reading the main and the retry topic.
   * The offset is committed only after the handler (or the hand-off to retry/DLQ) succeeded,
   * so a crash means redelivery, never loss.
   */
  async consume(group: string, handler: Handler) {
    const consumer = this.kafka.consumer({
      kafkaJS: { groupId: group, fromBeginning: true, autoCommit: true },
    });
    this.consumers.push(consumer);
    await consumer.connect();
    await consumer.subscribe({ topics: [EVENTS_TOPIC, RETRY_TOPIC] });
    await consumer.run({
      eachMessage: async ({ topic, message }) => {
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
            headers: { 'x-error': event.message },
          });
          return;
        }
        try {
          await handler(event);
        } catch (e) {
          await this.fail(message, raw, e as Error, group);
        }
      },
    });
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
          [NOT_BEFORE_HEADER]: String(Date.now() + delay),
        },
      });
    }
    // Out of attempts: park it (acked) before the offset is committed so it cannot be lost.
    return this.send(DLQ_TOPIC, {
      key,
      value: raw,
      headers: { [ATTEMPT_HEADER]: String(attempt), 'x-error': e.message },
    });
  }

  private send(topic: string, message: KafkaJS.Message) {
    return this.producer.send({ topic, messages: [message] });
  }
}
