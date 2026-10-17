import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Channel,
  Prisma,
  StayKind,
  StaySource,
  StayStatus,
} from '@prisma/client';
import { isOverlapError } from '../../common/all-exceptions.filter';
import { toDay } from '../../common/dates';
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

@Injectable()
export class IcalSyncService {
  private readonly logger = new Logger(IcalSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

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
   * One sync per channel across all processes: a Postgres advisory lock, held by an open
   * transaction on its own connection (released on commit, rollback or a crash) while the work
   * itself uses the normal pool.
   */
  private sync(channel: Channel): Promise<SyncSummary> {
    return this.prisma.$transaction(
      async (lock) => {
        const [{ locked }] = await lock.$queryRaw<{ locked: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${channel.id}, 0)) AS locked`;
        if (!locked) {
          throw new ConflictException({
            code: 'SYNC_IN_PROGRESS',
            message: 'Sync already running',
          });
        }
        return this.syncLocked(channel);
      },
      { timeout: 120_000 },
    );
  }

  private async syncLocked(channel: Channel): Promise<SyncSummary> {
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
