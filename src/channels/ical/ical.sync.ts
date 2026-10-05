import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import {
  Channel,
  Prisma,
  StayKind,
  StaySource,
  StayStatus,
} from '@prisma/client';
import { CronJob } from 'cron';
import { isOverlapError } from '../../common/all-exceptions.filter';
import { toDay } from '../../common/dates';
import type { Env } from '../../config/env.schema';
import { OutboxService } from '../../outbox/outbox.service';
import { PrismaService } from '../../prisma/prisma.service';
import { eventPayload } from '../../stays/stay-event';
import { diffStays, LocalStay, parseIcs } from './ical.import';

export interface SyncSummary {
  created: number;
  updated: number;
  cancelled: number;
  conflicts: number;
  errors: number;
}

const CRON_NAME = 'ical-poll';

@Injectable()
export class IcalSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IcalSyncService.name);
  private readonly syncing = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    private readonly config: ConfigService<Env, true>,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit() {
    const job = CronJob.from({
      cronTime: String(this.config.get('ICAL_POLL_CRON')),
      onTick: () => void this.syncAll(),
      start: true,
    });
    this.registry.addCronJob(CRON_NAME, job);
  }

  onModuleDestroy() {
    this.registry.deleteCronJob(CRON_NAME);
  }

  async syncAll() {
    const channels = await this.prisma.channel.findMany({
      where: { type: 'ICAL', active: true },
    });
    for (const c of channels) {
      try {
        await this.sync(c);
      } catch (e) {
        this.logger.warn(
          `iCal sync of channel ${c.id} failed: ${(e as Error).message}`,
        );
      }
    }
  }

  async syncById(id: string) {
    const channel = await this.prisma.channel.findUnique({ where: { id } });
    if (!channel) throw new NotFoundException('Channel not found');
    if (channel.type !== 'ICAL') {
      throw new BadRequestException('Only ICAL channels can be synced');
    }
    return this.sync(channel);
  }

  /**
   * Fetch, parse, diff, apply. Each change is its own transaction so one clash cannot abort the rest.
   * ponytail: the in-process lock assumes a single instance; use an advisory lock when scaling out.
   */
  private async sync(channel: Channel): Promise<SyncSummary> {
    if (this.syncing.has(channel.id)) {
      throw new ConflictException({
        code: 'SYNC_IN_PROGRESS',
        message: 'Sync already running',
      });
    }
    this.syncing.add(channel.id);
    try {
      const { events, errors } = parseIcs(await this.fetchFeed(channel));
      const summary: SyncSummary = {
        created: 0,
        updated: 0,
        cancelled: 0,
        conflicts: 0,
        errors: errors.length,
      };

      for (const e of errors) {
        await this.raise(
          channel.id,
          'PARSE_ERROR',
          `${e.uid ?? ''}|${e.reason}`,
          { uid: e.uid ?? null, reason: e.reason },
        );
      }

      // Externals are namespaced per channel so two feeds never cancel each other's events.
      const prefix = `${channel.id}:`;
      const rows = await this.prisma.stay.findMany({
        where: {
          propertyId: channel.propertyId,
          source: StaySource.ICAL,
          externalId: { startsWith: prefix },
        },
      });
      const existing: LocalStay[] = rows.map((s) => ({
        id: s.id,
        uid: s.externalId!.slice(prefix.length),
        checkIn: toDay(s.checkIn),
        checkOut: toDay(s.checkOut),
        status: s.status,
      }));
      const diff = diffStays(events, existing);

      // Cancel first so dates freed by one event are available to another.
      for (const c of diff.toCancel) {
        await this.prisma.$transaction(async (tx) => {
          const s = await tx.stay.update({
            where: { id: c.id },
            data: { status: StayStatus.CANCELLED },
          });
          await this.outbox.add(tx, 'stay.cancelled', eventPayload(s));
        });
        summary.cancelled++;
      }

      const writes = [
        ...diff.toUpdate.map((u) => ({ ...u, op: 'update' as const })),
        ...diff.toCreate.map((u) => ({ ...u, op: 'create' as const })),
      ];
      for (const w of writes) {
        const dates = {
          checkIn: new Date(w.checkIn),
          checkOut: new Date(w.checkOut),
        };
        try {
          await this.prisma.$transaction(async (tx) => {
            const s =
              w.op === 'update'
                ? await tx.stay.update({
                    where: { id: w.id },
                    data: { ...dates, status: StayStatus.CONFIRMED },
                  })
                : await tx.stay.create({
                    data: {
                      ...dates,
                      propertyId: channel.propertyId,
                      kind: StayKind.BLOCK,
                      source: StaySource.ICAL,
                      externalId: prefix + w.uid,
                    },
                  });
            await this.outbox.add(tx, 'stay.created', eventPayload(s));
          });
          summary[w.op === 'update' ? 'updated' : 'created']++;
        } catch (e) {
          if (!isOverlapError(e)) throw e;
          summary.conflicts++;
          await this.raise(channel.id, 'CONFLICT', w.uid, {
            uid: w.uid,
            checkIn: w.checkIn,
            checkOut: w.checkOut,
          });
        }
      }

      await this.prisma.channel.update({
        where: { id: channel.id },
        data: { lastSyncedAt: new Date(), lastSyncError: null },
      });
      return summary;
    } finally {
      this.syncing.delete(channel.id);
    }
  }

  private async fetchFeed(channel: Channel): Promise<string> {
    try {
      const res = await fetch((channel.config as { url: string }).url, {
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (e) {
      const message = (e as Error).message;
      await this.prisma.channel.update({
        where: { id: channel.id },
        data: { lastSyncError: message },
      });
      throw new BadGatewayException({ code: 'SYNC_FAILED', message });
    }
  }

  /** One open issue per problem: a feed that stays broken must not add a row every poll. */
  private async raise(
    channelId: string,
    kind: string,
    key: string,
    detail: Prisma.InputJsonObject,
  ) {
    const open = await this.prisma.syncIssue.findFirst({
      where: {
        channelId,
        kind,
        resolvedAt: null,
        detail: { path: ['key'], equals: key },
      },
    });
    if (!open) {
      await this.prisma.syncIssue.create({
        data: { channelId, kind, detail: { key, ...detail } },
      });
    }
  }
}
