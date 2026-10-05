import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxEvent } from '@prisma/client';
import type { Env } from '../config/env.schema';
import { MessagingService } from '../messaging/messaging.service';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OutboxPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPublisher.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  onModuleInit() {
    this.timer = setInterval(
      () => void this.tick(),
      this.config.get('OUTBOX_POLL_MS'),
    );
  }

  onModuleDestroy() {
    clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.publishPending();
    } catch (e) {
      this.logger.error(e);
    } finally {
      this.running = false;
    }
  }

  /**
   * Claims a batch with FOR UPDATE SKIP LOCKED, so several instances never publish the same row.
   * At-least-once: a crash between publish and commit republishes, so consumers must be idempotent.
   * ponytail: stops at the first failure and retries forever; add a max-attempts parking
   * state if a poison event ever blocks the queue.
   */
  publishPending(limit = 50): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<OutboxEvent[]>`
          SELECT * FROM "OutboxEvent" WHERE "publishedAt" IS NULL
          ORDER BY "createdAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED`;
        let published = 0;
        for (const r of rows) {
          try {
            await this.messaging.publish(r.type, r.payload, r.id);
          } catch (e) {
            this.logger.warn(
              `publish ${r.type} ${r.id} failed: ${(e as Error).message}`,
            );
            await tx.outboxEvent.update({
              where: { id: r.id },
              data: { attempts: { increment: 1 } },
            });
            break;
          }
          await tx.outboxEvent.update({
            where: { id: r.id },
            data: { publishedAt: new Date() },
          });
          published++;
        }
        return published;
      },
      { timeout: 30_000 },
    );
  }
}
