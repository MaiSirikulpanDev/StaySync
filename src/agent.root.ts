import { Module } from '@nestjs/common';
import { AgentModule } from './agent/agent.module';
import { CoreModule } from './core.module';

/** Root of the agent process (src/agent.ts): the infrastructure plus the guest-message consumer. */
@Module({ imports: [CoreModule, AgentModule] })
export class AgentRootModule {}
