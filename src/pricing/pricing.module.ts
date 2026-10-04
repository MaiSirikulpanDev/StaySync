import { Module } from '@nestjs/common';
import { PropertiesModule } from '../properties/properties.module';
import { PricingController } from './pricing.controller';
import { PricingService } from './pricing.service';

@Module({
  imports: [PropertiesModule],
  controllers: [PricingController],
  providers: [PricingService],
  exports: [PricingService],
})
export class PricingModule {}
