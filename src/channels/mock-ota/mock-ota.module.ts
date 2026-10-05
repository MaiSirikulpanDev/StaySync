import { Module } from '@nestjs/common';
import { Clock } from '../../common/clock';
import { StaysModule } from '../../stays/stays.module';
import { OtaWebhookController } from './ota-webhook.controller';
import { OtaWebhookService } from './ota-webhook.service';
import { OtaClient } from './ota.client';
import { OtaConsumer } from './ota.consumer';

@Module({
  imports: [StaysModule],
  controllers: [OtaWebhookController],
  providers: [Clock, OtaClient, OtaConsumer, OtaWebhookService],
})
export class MockOtaModule {}
