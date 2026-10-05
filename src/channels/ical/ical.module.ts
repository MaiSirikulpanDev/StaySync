import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { IcalController } from './ical.controller';
import { IcalSyncService } from './ical.sync';

@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [IcalController],
  providers: [IcalSyncService],
})
export class IcalModule {}
