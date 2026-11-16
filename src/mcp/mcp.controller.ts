import {
  All,
  BadRequestException,
  Controller,
  MethodNotAllowedException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { AgentProposalsService } from '../agent-proposals/agent-proposals.service';
import { AgentRunsService } from '../agent-runs/agent-runs.service';
import { GuestMessagesService } from '../guest-messages/guest-messages.service';
import { PricingService } from '../pricing/pricing.service';
import { PropertiesService } from '../properties/properties.service';
import { StaysService } from '../stays/stays.service';
import { createMcpServer } from './mcp.tools';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * MCP over Streamable HTTP, stateless: a fresh server per request, so there is no
 * session store and any app instance can answer. The global API-key guard applies.
 */
@ApiExcludeController()
@Controller('mcp')
export class McpController {
  constructor(
    private readonly properties: PropertiesService,
    private readonly stays: StaysService,
    private readonly pricing: PricingService,
    private readonly guestMessages: GuestMessagesService,
    private readonly proposals: AgentProposalsService,
    private readonly runs: AgentRunsService,
  ) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response) {
    const agentRunId = req.header('x-agent-run-id');
    if (agentRunId !== undefined && !UUID.test(agentRunId))
      throw new BadRequestException('x-agent-run-id must be a UUID');
    const server = createMcpServer(
      {
        properties: this.properties,
        stays: this.stays,
        pricing: this.pricing,
        guestMessages: this.guestMessages,
        proposals: this.proposals,
        runs: this.runs,
      },
      agentRunId,
    );
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    res.on('close', () => void server.close());
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  // Stateless: no server-initiated stream (GET) and no session to end (DELETE).
  @All()
  notAllowed() {
    throw new MethodNotAllowedException();
  }
}
