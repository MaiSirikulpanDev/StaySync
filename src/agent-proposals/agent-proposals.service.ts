import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProposalStatus, ProposalType } from '@prisma/client';
import { isOverlapError } from '../common/all-exceptions.filter';
import { PrismaService } from '../prisma/prisma.service';
import { StaysService } from '../stays/stays.service';
import { Parsed, parseParams } from './proposal-params';

type Failure = { code?: string; message: string };

/** The reason a decision's side effect was refused, or null for an unexpected error. */
function refusal(e: unknown): Failure | null {
  if (isOverlapError(e))
    return { code: 'DATES_UNAVAILABLE', message: 'Dates are not available' };
  if (!(e instanceof HttpException)) return null;
  const r = e.getResponse();
  const o = typeof r === 'object' ? (r as Record<string, unknown>) : {};
  return {
    code: o.code as string | undefined,
    message: typeof r === 'string' ? r : String(o.message),
  };
}

@Injectable()
export class AgentProposalsService {
  private readonly logger = new Logger(AgentProposalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly stays: StaysService,
  ) {}

  /**
   * Called by the MCP server for a run. Files a PENDING proposal and changes nothing else:
   * the stay only changes in approve(). The property comes from the run's message, so an
   * agent cannot propose anything on another property.
   */
  async propose(
    agentRunId: string,
    input: {
      type: ProposalType;
      params: Record<string, unknown>;
      reason: string;
    },
  ) {
    const run = await this.prisma.agentRun.findUnique({
      where: { id: agentRunId },
      include: { guestMessage: true },
    });
    if (!run) throw new NotFoundException('Agent run not found');
    const parsed = await parseParams(input.type, input.params);
    await this.assertOwned(parsed, run.guestMessage.propertyId);
    const proposal = await this.prisma.agentProposal.create({
      data: {
        agentRunId,
        type: input.type,
        params: input.params as Prisma.InputJsonValue,
        reason: input.reason,
      },
    });
    return { proposalId: proposal.id, status: proposal.status };
  }

  list(status?: ProposalStatus) {
    return this.prisma.agentProposal.findMany({
      where: { status },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * PENDING -> APPROVED is claimed with a conditional update, so two racing approvals run the
   * change once. The change goes through StaysService, so the exclusion constraint, the outbox
   * and Kafka apply as for any booking. A refusal (409 dates taken, 400 min stay) is recorded
   * as FAILED with its reason; the proposal itself was decided, so this is still a 200.
   */
  async approve(id: string) {
    const proposal = await this.prisma.agentProposal.findUnique({
      where: { id },
      include: { agentRun: { include: { guestMessage: true } } },
    });
    if (!proposal) throw new NotFoundException('Proposal not found');
    const { count } = await this.prisma.agentProposal.updateMany({
      where: { id, status: ProposalStatus.PENDING },
      data: { status: ProposalStatus.APPROVED, decidedAt: new Date() },
    });
    if (!count) throw new ConflictException('Proposal was already decided');

    const propertyId = proposal.agentRun.guestMessage.propertyId;
    try {
      const parsed = await parseParams(
        proposal.type,
        proposal.params as Record<string, unknown>,
      );
      await this.assertOwned(parsed, propertyId);
      const stay = await this.execute(parsed, propertyId);
      return this.prisma.agentProposal.update({
        where: { id },
        data: { result: { stayId: stay.id } },
      });
    } catch (e) {
      const failure = refusal(e);
      await this.prisma.agentProposal.update({
        where: { id },
        data: {
          status: ProposalStatus.FAILED,
          result: failure ?? { message: 'Internal error' },
        },
      });
      if (!failure) {
        this.logger.error(e);
        throw e;
      }
      return this.prisma.agentProposal.findUniqueOrThrow({ where: { id } });
    }
  }

  async reject(id: string) {
    const { count } = await this.prisma.agentProposal.updateMany({
      where: { id, status: ProposalStatus.PENDING },
      data: { status: ProposalStatus.REJECTED, decidedAt: new Date() },
    });
    if (!count) {
      const exists = await this.prisma.agentProposal.findUnique({
        where: { id },
      });
      if (!exists) throw new NotFoundException('Proposal not found');
      throw new ConflictException('Proposal was already decided');
    }
    return this.prisma.agentProposal.findUniqueOrThrow({ where: { id } });
  }

  private execute(p: Parsed, propertyId: string) {
    switch (p.type) {
      case 'CREATE_BOOKING':
      case 'CREATE_BLOCK':
        return this.stays.create(propertyId, p.dto);
      case 'CANCEL_STAY':
        return this.stays.cancel(p.stayId);
      case 'CHANGE_DATES':
        return this.stays.changeDates(p.stayId, p.dto);
    }
  }

  /** A stay can only be touched by a proposal from a message of the same property. */
  private async assertOwned(p: Parsed, propertyId: string) {
    if (!('stayId' in p)) return;
    const stay = await this.prisma.stay.findFirst({
      where: { id: p.stayId, propertyId },
    });
    if (!stay)
      throw new BadRequestException('stayId is not a stay of this property');
  }
}
