import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { CoreModule } from './core.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ApiKeyGuard } from './common/api-key.guard';
import { HealthModule } from './health/health.module';
import { ChannelsModule } from './channels/channels.module';
import { IcalModule } from './channels/ical/ical.module';
import { MockOtaModule } from './channels/mock-ota/mock-ota.module';
import { OccupancyModule } from './occupancy/occupancy.module';
import { SyncIssuesModule } from './sync-issues/sync-issues.module';
import { PricingModule } from './pricing/pricing.module';
import { PropertiesModule } from './properties/properties.module';
import { StaysModule } from './stays/stays.module';

@Module({
  imports: [
    CoreModule,
    HealthModule,
    PropertiesModule,
    PricingModule,
    StaysModule,
    MockOtaModule,
    ChannelsModule,
    IcalModule,
    SyncIssuesModule,
    OccupancyModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
