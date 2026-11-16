import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AgentRunStatus } from '@prisma/client';
import { AgentRunsService } from '../agent-runs/agent-runs.service';
import type { Env } from '../config/env.schema';
import type { GuestMessageEvent } from '../events/guest-message-events';
import {
  AGENT_GROUP,
  GUEST_STREAM,
  MessagingService,
} from '../messaging/messaging.service';
import { PrismaService } from '../prisma/prisma.service';
import { currentTraceparent } from '../tracing/trace';
import { RUN_AGENT } from './agent.types';
import type { RunAgent } from './agent.types';
import { overBudget, remainingUsd } from './budget';

@Injectable()
export class AgentConsumer implements OnModuleInit {
  private readonly logger = new Logger(AgentConsumer.name);

  constructor(
    private readonly messaging: MessagingService,
    private readonly prisma: PrismaService,
    private readonly runs: AgentRunsService,
    private readonly config: ConfigService<Env, true>,
    @Inject(RUN_AGENT) private readonly runAgent: RunAgent,
  ) {}

  onModuleInit() {
    if (!this.config.get('ANTHROPIC_API_KEY', { infer: true }))
      throw new Error('ANTHROPIC_API_KEY is required to run the agent');
    return this.messaging.consume(
      AGENT_GROUP,
      (e) => this.handle(e),
      GUEST_STREAM,
    );
  }

  /**
   * At-least-once delivery, at-most-once model call: the inbox row and the AgentRun commit
   * together, so a redelivered message finds its inbox row and is skipped. The cost is that a
   * crash mid-run leaves a RUNNING row that is not retried.
   * ponytail: no sweeper for stale RUNNING rows; add one if crashes during a run turn out to matter.
   */
  async handle(e: GuestMessageEvent): Promise<void> {
    const model = this.config.get('AGENT_MODEL', { infer: true });
    const run = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.processedEvent.createMany({
        data: [{ consumerGroup: AGENT_GROUP, eventId: e.eventId }],
        skipDuplicates: true,
      });
      if (!count) return null;
      return tx.agentRun.create({
        data: {
          guestMessageId: e.payload.guestMessageId,
          agent: 'claude',
          model,
          traceId: currentTraceparent()?.split('-')[1],
        },
      });
    });
    if (!run) return;

    const limit = this.config.get('AGENT_DAILY_BUDGET_USD', { infer: true });
    const spent = await this.runs.spentTodayMicros();
    if (overBudget(spent, limit)) {
      this.logger.warn(
        `daily budget of $${limit} reached, run ${run.id} skipped`,
      );
      await this.finish(run.id, AgentRunStatus.SKIPPED_BUDGET, {
        error: `daily budget of $${limit} reached`,
      });
      return;
    }

    const started = Date.now();
    // The model call never throws into the consumer: a run that cost money must be recorded,
    // and retrying it from Kafka would pay for it again.
    const r = await this.runAgent({
      runId: run.id,
      model,
      mcpUrl: this.config.get('STAYSYNC_MCP_URL', { infer: true }),
      apiKey: this.config.get('API_KEY', { infer: true }),
      traceparent: currentTraceparent(),
      today: new Date().toISOString().slice(0, 10),
      timeoutMs: this.config.get('AGENT_RUN_TIMEOUT_MS', { infer: true }),
      maxBudgetUsd: remainingUsd(spent, limit),
    }).catch((err: Error) => ({
      status: 'FAILED' as const,
      inputTokens: 0,
      outputTokens: 0,
      costMicros: 0,
      error: err.message,
    }));
    await this.finish(run.id, r.status, {
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costMicros: r.costMicros,
      durationMs: Date.now() - started,
      error: r.error,
    });
  }

  private finish(
    id: string,
    status: AgentRunStatus,
    data: {
      inputTokens?: number;
      outputTokens?: number;
      costMicros?: number;
      durationMs?: number;
      error?: string;
    },
  ) {
    return this.prisma.agentRun.update({
      where: { id },
      data: { status, ...data },
    });
  }
}
