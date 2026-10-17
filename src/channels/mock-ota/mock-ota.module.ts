import { Module } from '@nestjs/common';
import { StaysModule } from '../../stays/stays.module';
import { OtaWebhookController } from './ota-webhook.controller';
import { OtaWebhookService } from './ota-webhook.service';

@Module({
  imports: [StaysModule],
  controllers: [OtaWebhookController],
  providers: [OtaWebhookService],
})
export class MockOtaModule {}
