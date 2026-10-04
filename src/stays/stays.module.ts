import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { PropertiesModule } from '../properties/properties.module';
import { StaysController } from './stays.controller';
import { StaysService } from './stays.service';

@Module({
  imports: [PropertiesModule, PricingModule],
  controllers: [StaysController],
  providers: [StaysService],
})
export class StaysModule {}
