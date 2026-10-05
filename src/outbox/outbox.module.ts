import { Global, Module } from '@nestjs/common';
import { OutboxPublisher } from './outbox.publisher';
import { OutboxService } from './outbox.service';

@Global()
@Module({
  providers: [OutboxService, OutboxPublisher],
  exports: [OutboxService, OutboxPublisher],
})
export class OutboxModule {}
