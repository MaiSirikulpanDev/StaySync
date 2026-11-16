import { Module } from '@nestjs/common';
import { PropertiesModule } from '../properties/properties.module';
import { GuestMessagesController } from './guest-messages.controller';
import { GuestMessagesService } from './guest-messages.service';

@Module({
  imports: [PropertiesModule],
  controllers: [GuestMessagesController],
  providers: [GuestMessagesService],
  exports: [GuestMessagesService],
})
export class GuestMessagesModule {}
