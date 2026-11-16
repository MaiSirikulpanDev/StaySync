import {
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ProposalStatus } from '@prisma/client';
import { AgentProposalsService } from './agent-proposals.service';

@ApiTags('agent-proposals')
@Controller('agent-proposals')
export class AgentProposalsController {
  constructor(private readonly proposals: AgentProposalsService) {}

  @Get()
  list(
    @Query('status', new ParseEnumPipe(ProposalStatus, { optional: true }))
    status?: ProposalStatus,
  ) {
    return this.proposals.list(status);
  }

  @Post(':id/approve')
  approve(@Param('id', ParseUUIDPipe) id: string) {
    return this.proposals.approve(id);
  }

  @Post(':id/reject')
  reject(@Param('id', ParseUUIDPipe) id: string) {
    return this.proposals.reject(id);
  }
}
