import { Module } from '@nestjs/common';
import { PricingModule } from '../pricing/pricing.module';
import { PropertiesModule } from '../properties/properties.module';
import { StaysModule } from '../stays/stays.module';
import { McpController } from './mcp.controller';

@Module({
  imports: [PropertiesModule, PricingModule, StaysModule],
  controllers: [McpController],
})
export class McpModule {}
