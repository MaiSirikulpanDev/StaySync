import {
  All,
  Controller,
  MethodNotAllowedException,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { Request, Response } from 'express';
import { PricingService } from '../pricing/pricing.service';
import { PropertiesService } from '../properties/properties.service';
import { StaysService } from '../stays/stays.service';
import { createMcpServer } from './mcp.tools';

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
  ) {}

  @Post()
  async handle(@Req() req: Request, @Res() res: Response) {
    const server = createMcpServer(this.properties, this.stays, this.pricing);
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
