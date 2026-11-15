import { Module } from '@nestjs/common';
import { AgentRunsModule } from '../agent-runs/agent-runs.module';
import { AgentConsumer } from './agent.consumer';
import { RUN_AGENT } from './agent.types';
import { runAgent } from './run-agent';

/**
 * Everything that needs an agent SDK. Only the agent process imports it (src/agent.ts). run-agent.ts loads the
 * SDK on the first run, so a test that replaces RUN_AGENT never loads it.
 */
@Module({
  imports: [AgentRunsModule],
  providers: [{ provide: RUN_AGENT, useValue: runAgent }, AgentConsumer],
})
export class AgentModule {}
