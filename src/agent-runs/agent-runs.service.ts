import { Injectable, Logger } from '@nestjs/common';
import { AgentRunStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AgentRunsService {
  private readonly logger = new Logger(AgentRunsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Best effort: a failed audit row must not turn a good tool result into an error. */
  async recordToolCall(call: {
    agentRunId: string;
    tool: string;
    input: unknown;
    ok: boolean;
    durationMs: number;
  }) {
    try {
      await this.prisma.agentToolCall.create({
        data: { ...call, input: call.input as Prisma.InputJsonValue },
      });
    } catch (e) {
      this.logger.warn(`tool call not recorded: ${(e as Error).message}`);
    }
  }

  /** Closes a run with its outcome. Used by the agent consumer and by the eval runner. */
  finish(
    id: string,
    status: AgentRunStatus,
    data: {
      inputTokens?: number;
      outputTokens?: number;
      costMicros?: number;
      durationMs?: number;
      error?: string;
    } = {},
  ) {
    return this.prisma.agentRun.update({
      where: { id },
      data: { status, ...data },
    });
  }

  /** Cost of every run since 00:00 UTC, in millionths of a USD. ponytail: UTC day, not the owner's. */
  async spentTodayMicros(now = new Date()): Promise<number> {
    const start = new Date(now);
    start.setUTCHours(0, 0, 0, 0);
    const { _sum } = await this.prisma.agentRun.aggregate({
      where: { createdAt: { gte: start } },
      _sum: { costMicros: true },
    });
    return _sum.costMicros ?? 0;
  }
}
