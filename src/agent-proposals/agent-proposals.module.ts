import { Module } from '@nestjs/common';
import { StaysModule } from '../stays/stays.module';
import { AgentProposalsController } from './agent-proposals.controller';
import { AgentProposalsService } from './agent-proposals.service';

@Module({
  imports: [StaysModule],
  controllers: [AgentProposalsController],
  providers: [AgentProposalsService],
  exports: [AgentProposalsService],
})
export class AgentProposalsModule {}
