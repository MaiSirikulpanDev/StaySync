import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { IcalModule } from './channels/ical/ical.module';
import { IcalPoller } from './channels/ical/ical.poller';
import { OtaClient } from './channels/mock-ota/ota.client';
import { OtaConsumer } from './channels/mock-ota/ota.consumer';
import { Clock } from './common/clock';
import { CoreModule } from './core.module';
import { OccupancyProjection } from './occupancy/occupancy.projection';
import { OutboxPublisher } from './outbox/outbox.publisher';
import { StaysModule } from './stays/stays.module';

/** Everything that runs in the background. The api process imports none of it. */
@Module({
  imports: [ScheduleModule.forRoot(), StaysModule, IcalModule],
  providers: [
    Clock,
    OtaClient,
    OtaConsumer,
    OccupancyProjection,
    OutboxPublisher,
    IcalPoller,
  ],
})
export class WorkerModule {}

/** Root of the worker process (src/worker.ts). */
@Module({ imports: [CoreModule, WorkerModule] })
export class WorkerRootModule {}
