import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ApiKeyGuard } from './common/api-key.guard';
import { parseEnv } from './config/env.schema';
import { HealthModule } from './health/health.module';
import { MockOtaModule } from './channels/mock-ota/mock-ota.module';
import { MessagingModule } from './messaging/messaging.module';
import { OutboxModule } from './outbox/outbox.module';
import { PricingModule } from './pricing/pricing.module';
import { PropertiesModule } from './properties/properties.module';
import { PrismaModule } from './prisma/prisma.module';
import { StaysModule } from './stays/stays.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: parseEnv }),
    LoggerModule.forRoot({
      pinoHttp: {
        genReqId: (req) =>
          (req.headers['x-request-id'] as string) ?? crypto.randomUUID(),
        level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
        transport:
          process.env.NODE_ENV === 'development'
            ? { target: 'pino-pretty' }
            : undefined,
      },
    }),
    PrismaModule,
    MessagingModule,
    OutboxModule,
    HealthModule,
    PropertiesModule,
    PricingModule,
    StaysModule,
    MockOtaModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ApiKeyGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
