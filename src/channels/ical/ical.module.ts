import { Module } from '@nestjs/common';
import { IcalController } from './ical.controller';
import { IcalSyncService } from './ical.sync';

@Module({
  controllers: [IcalController],
  providers: [IcalSyncService],
  exports: [IcalSyncService],
})
export class IcalModule {}
