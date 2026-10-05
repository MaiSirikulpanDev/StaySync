import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import amqp, {
  ChannelModel,
  ConfirmChannel,
  ConsumeMessage,
  RecoveringChannelModel,
} from 'amqplib';
import type { Env } from '../config/env.schema';
import { deathCount } from './retry';

export const EVENTS_EXCHANGE = 'staysync.events';
export const RETRY_EXCHANGE = 'staysync.retry';
export const OTA_QUEUE = 'ota-sync';
export const MAX_ATTEMPTS = 5;

export interface EventMessage<P = Record<string, unknown>> {
  id: string;
  type: string;
  payload: P;
}
type Handler = (event: EventMessage) => Promise<void>;

const PUBLISH_TIMEOUT_MS = 4000;

/** Adapts amqplib's confirm-callback style to a promise. */
const confirmed = (send: (cb: (err: unknown) => void) => unknown) =>
  new Promise<void>((resolve, reject) => {
    send((err) =>
      err
        ? reject(err instanceof Error ? err : new Error(JSON.stringify(err)))
        : resolve(),
    );
  });

@Injectable()
export class MessagingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagingService.name);
  private conn?: RecoveringChannelModel;
  private pub?: ConfirmChannel;
  private readonly handlers = new Map<string, Handler>();

  constructor(private readonly config: ConfigService<Env, true>) {}

  async onModuleInit() {
    this.conn = await amqp.connect(this.config.get('RABBITMQ_URL'), {
      recovery: {
        initialDelay: 200,
        maxDelay: 5000,
        // Runs after every (re)connect: declare topology, then re-attach consumers.
        setup: (model: ChannelModel) => this.setup(model),
      },
    });
    this.conn.on('disconnect', (e) =>
      this.logger.warn(`RabbitMQ disconnected: ${e.message}`),
    );
  }

  async onModuleDestroy() {
    await this.conn?.close();
  }

  /** Publishes with a broker confirm; rejects if the broker does not accept it in time. */
  publish(type: string, payload: unknown, id: string): Promise<void> {
    const pub = this.pub;
    if (!pub) return Promise.reject(new Error('RabbitMQ not connected'));
    const body = Buffer.from(JSON.stringify({ id, type, payload }));
    const send = confirmed((cb) =>
      pub.publish(
        EVENTS_EXCHANGE,
        type,
        body,
        { persistent: true, messageId: id },
        cb,
      ),
    );
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error('publish confirm timed out')),
        PUBLISH_TIMEOUT_MS,
      ).unref(),
    );
    return Promise.race([send, timeout]);
  }

  /** Registers a consumer; it is re-attached automatically after a reconnect. */
  async consume(queue: string, handler: Handler) {
    this.handlers.set(queue, handler);
    await this.conn!.waitForConnect();
    await this.startConsumer(this.conn!, queue, handler);
  }

  private async setup(model: ChannelModel) {
    const ch = await model.createChannel();
    const retryMs = Number(this.config.get('RETRY_DELAY_MS'));
    await ch.assertExchange(EVENTS_EXCHANGE, 'topic', { durable: true });
    await ch.assertExchange(RETRY_EXCHANGE, 'fanout', { durable: true });
    // Rejected messages go to the retry queue, wait out the TTL, then re-enter the events exchange.
    await ch.assertQueue(OTA_QUEUE, {
      durable: true,
      arguments: { 'x-dead-letter-exchange': RETRY_EXCHANGE },
    });
    await ch.bindQueue(OTA_QUEUE, EVENTS_EXCHANGE, 'stay.*');
    await ch.assertQueue(`${OTA_QUEUE}.retry`, {
      durable: true,
      arguments: {
        'x-message-ttl': retryMs,
        'x-dead-letter-exchange': EVENTS_EXCHANGE,
      },
    });
    await ch.bindQueue(`${OTA_QUEUE}.retry`, RETRY_EXCHANGE, '');
    await ch.assertQueue(`${OTA_QUEUE}.dlq`, { durable: true });
    await ch.close();

    this.pub = await model.createConfirmChannel();
    for (const [queue, handler] of this.handlers)
      await this.startConsumer(model, queue, handler);
  }

  private async startConsumer(
    model: Pick<ChannelModel, 'createConfirmChannel'>,
    queue: string,
    handler: Handler,
  ) {
    const ch = await model.createConfirmChannel();
    await ch.prefetch(10);
    await ch.consume(
      queue,
      (msg) => msg && void this.onMessage(ch, queue, msg, handler),
    );
  }

  private async onMessage(
    ch: ConfirmChannel,
    queue: string,
    msg: ConsumeMessage,
    handler: Handler,
  ) {
    try {
      await handler(JSON.parse(msg.content.toString()) as EventMessage);
      ch.ack(msg);
    } catch (e) {
      const attempt = deathCount(msg.properties.headers, queue) + 1;
      this.logger.warn(
        `${queue} attempt ${attempt}/${MAX_ATTEMPTS} failed: ${(e as Error).message}`,
      );
      if (attempt < MAX_ATTEMPTS) return ch.nack(msg, false, false);
      // Out of attempts: park it in the DLQ (confirmed) before acking so it cannot be lost.
      await confirmed((cb) =>
        ch.sendToQueue(
          `${queue}.dlq`,
          msg.content,
          { persistent: true, headers: { 'x-error': (e as Error).message } },
          cb,
        ),
      );
      ch.ack(msg);
    }
  }
}
