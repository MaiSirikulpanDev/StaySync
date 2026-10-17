import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import type { Env } from '../../config/env.schema';
import { IcalSyncService } from './ical.sync';

const CRON_NAME = 'ical-poll';

/** Worker-only: polls every active iCal channel. Replicas are safe, the sync takes a per-channel lock. */
@Injectable()
export class IcalPoller implements OnModuleInit, OnModuleDestroy {
  constructor(
    private readonly sync: IcalSyncService,
    private readonly config: ConfigService<Env, true>,
    private readonly registry: SchedulerRegistry,
  ) {}

  onModuleInit() {
    const job = CronJob.from({
      cronTime: String(this.config.get('ICAL_POLL_CRON')),
      onTick: () => void this.sync.syncAll(),
      start: true,
    });
    this.registry.addCronJob(CRON_NAME, job);
  }

  onModuleDestroy() {
    this.registry.deleteCronJob(CRON_NAME);
  }
}
