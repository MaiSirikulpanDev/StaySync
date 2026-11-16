import { Module } from '@nestjs/common';
import { AgentProposalsModule } from '../agent-proposals/agent-proposals.module';
import { AgentRunsModule } from '../agent-runs/agent-runs.module';
import { GuestMessagesModule } from '../guest-messages/guest-messages.module';
import { PricingModule } from '../pricing/pricing.module';
import { PropertiesModule } from '../properties/properties.module';
import { StaysModule } from '../stays/stays.module';
import { McpController } from './mcp.controller';

@Module({
  imports: [
    PropertiesModule,
    PricingModule,
    StaysModule,
    GuestMessagesModule,
    AgentProposalsModule,
    AgentRunsModule,
  ],
  controllers: [McpController],
})
export class McpModule {}
