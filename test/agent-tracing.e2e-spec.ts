import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { SpanKind } from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AgentModule } from '../src/agent/agent.module';
import { RUN_AGENT } from '../src/agent/agent.types';
import { makeRunAgent, QueryFn } from '../src/agent/run-agent';
import { Clock } from '../src/common/clock';
import { configureApp } from '../src/setup-app';
import { WorkerModule } from '../src/worker.module';
import { KEY, resetDb } from './setup/app';
import { waitFor } from './setup/wait';

const TRACE_ID = '5bf92f3577b34da6a3ce929d0e0e4737';

describe('one trace from a guest message to the agent’s tool calls', () => {
  const exporter = new InMemorySpanExporter();
  const provider = new NodeTracerProvider({
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  let app: INestApplication;

  beforeAll(async () => {
    provider.register();
    // The model is a script, but everything around it is real: this fake `query` makes a real MCP
    // call with the headers runAgent gave it, which is how the SDK would connect.
    let mcpUrl = '';
    const fakeQuery: QueryFn = async function* ({ options }) {
      const { headers } = options.mcpServers!.staysync as {
        headers: Record<string, string>;
      };
      const client = new Client({ name: 'fake-sdk', version: '1.0.0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(mcpUrl), {
          requestInit: { headers },
        }),
      );
      await client.callTool({ name: 'get_guest_message', arguments: {} });
      await client.close();
      const msg = (m: unknown) => m as SDKMessage;
      yield msg({
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          model: 'claude-haiku-5-5',
          usage: { input_tokens: 120, output_tokens: 12 },
          content: [
            {
              type: 'tool_use',
              id: 'tu1',
              name: 'mcp__staysync__get_guest_message',
              input: {},
            },
          ],
        },
      });
      yield msg({
        type: 'user',
        parent_tool_use_id: null,
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu1' }] },
      });
      yield msg({
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          model: 'claude-haiku-5-5',
          usage: { input_tokens: 200, output_tokens: 30 },
          content: [{ type: 'text', text: 'Hello' }],
        },
      });
      yield msg({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'ok',
        total_cost_usd: 0.001,
        modelUsage: {
          m: {
            inputTokens: 320,
            outputTokens: 42,
            cacheReadInputTokens: 0,
            cacheCreationInputTokens: 0,
          },
        },
      });
    };
    const mod = await Test.createTestingModule({
      imports: [AppModule, WorkerModule, AgentModule],
    })
      .overrideProvider(Clock)
      .useValue({ today: () => '2026-10-05' })
      .overrideProvider(RUN_AGENT)
      .useValue(makeRunAgent(() => Promise.resolve(fakeQuery)))
      .compile();
    app = mod.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
    await app.listen(0);
    const { port } = (app.getHttpServer() as Server).address() as AddressInfo;
    mcpUrl = `http://127.0.0.1:${port}/mcp`;
  });
  afterAll(async () => {
    await app.close();
    await provider.shutdown();
  });

  const inTrace = () =>
    exporter
      .getFinishedSpans()
      .filter((s) => s.spanContext().traceId === TRACE_ID);
  const parentOf = (s: ReadableSpan) => s.parentSpanContext?.spanId;
  const id = (s: ReadableSpan) => s.spanContext().spanId;

  it('runs from POST /guest-messages through outbox, Kafka, the agent consumer, model turns and MCP tool calls', async () => {
    await resetDb(app);
    const http = () => request(app.getHttpServer());
    const { body: property } = await http().post('/properties').set(KEY).send({
      name: 'Beach House',
      timezone: 'UTC',
      currency: 'AUD',
      baseRateCents: 10000,
      maxGuests: 4,
    });
    await http()
      .post(`/properties/${property.id}/guest-messages`)
      .set(KEY)
      .set('traceparent', `00-${TRACE_ID}-00f067aa0ba902b7-01`)
      .send({ fromName: 'Ann Lee', body: 'Is 12-15 Dec free?' })
      .expect(201);

    await waitFor(
      () =>
        inTrace().some((s) => s.name === 'invoke_agent staysync-inbox') &&
        inTrace().some((s) => s.name === 'mcp.tool get_guest_message'),
      20000,
    );
    // the consumer span ends after the run span, so wait for it too
    await waitFor(() =>
      inTrace().some((s) => s.name === 'agent-claude process'),
    );
    const spans = inTrace();
    const one = (name: string) => spans.find((s) => s.name === name)!;
    const publish = one('outbox publish');
    const consume = one('agent-claude process');
    const run = one('invoke_agent staysync-inbox');
    const mcpTool = one('mcp.tool get_guest_message');
    // One MCP session is several HTTP requests (initialize, the call); the tool ran in the last one.
    const mcpRequest = spans.find((s) => id(s) === parentOf(mcpTool))!;

    const post = spans.find(
      (s) => s.kind === SpanKind.SERVER && s.name.includes('guest-messages'),
    )!;
    expect(parentOf(post)).toBe('00f067aa0ba902b7'); // continues the caller's trace
    expect(parentOf(publish)).toBe(id(post));
    expect(parentOf(consume)).toBe(id(publish));
    expect(consume.kind).toBe(SpanKind.CONSUMER);
    expect(parentOf(run)).toBe(id(consume));
    expect(run.attributes['gen_ai.request.model']).toBe('claude-haiku-5-5');
    expect(run.attributes['staysync.cost_usd']).toBe(0.001);

    // model turns and the tool call are children of the run, with GenAI attributes
    const chats = spans.filter((s) => s.name === 'chat claude-haiku-5-5');
    expect(chats).toHaveLength(2);
    expect(chats.map((s) => parentOf(s))).toEqual([id(run), id(run)]);
    expect(chats.map((s) => s.attributes['gen_ai.usage.input_tokens'])).toEqual(
      [120, 200],
    );
    expect(
      chats.map((s) => s.attributes['gen_ai.usage.output_tokens']),
    ).toEqual([12, 30]);
    expect(parentOf(one('execute_tool get_guest_message'))).toBe(id(run));

    // the server side of the same MCP call is in the same trace, under the run span
    expect(mcpRequest.kind).toBe(SpanKind.SERVER);
    expect(parentOf(mcpRequest)).toBe(id(run));
  });
});
