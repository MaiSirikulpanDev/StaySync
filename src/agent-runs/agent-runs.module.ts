import { Module } from '@nestjs/common';
import { AgentRunsService } from './agent-runs.service';

@Module({ providers: [AgentRunsService], exports: [AgentRunsService] })
export class AgentRunsModule {}
