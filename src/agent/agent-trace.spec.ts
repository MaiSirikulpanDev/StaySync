import {
  context,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';
import {
  InMemorySpanExporter,
  ReadableSpan,
  SimpleSpanProcessor,
} from '@opentelemetry/sdk-trace-base';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { RunTracer, StreamMessage } from './agent-trace';
import { makeRunAgent, QueryFn } from './run-agent';
import type { RunAgentInput } from './agent.types';

const exporter = new InMemorySpanExporter();
const provider = new NodeTracerProvider({
  spanProcessors: [new SimpleSpanProcessor(exporter)],
});

const assistant = (
  content: unknown[],
  usage = { input_tokens: 100, output_tokens: 10 } as Record<string, number>,
): StreamMessage => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { model: 'claude-haiku-5-5', content, usage },
});
const toolUse = (id: string, name: string) => ({
  type: 'tool_use',
  id,
  name,
  input: {},
});
const toolResult = (id: string, is_error = false): StreamMessage => ({
  type: 'user',
  parent_tool_use_id: null,
  message: { content: [{ type: 'tool_result', tool_use_id: id, is_error }] },
});

const byName = (n: string) =>
  exporter.getFinishedSpans().filter((s) => s.name === n);
const attr = (s: ReadableSpan, k: string) => s.attributes[k];

describe('agent spans', () => {
  beforeAll(() => provider.register());
  afterAll(() => provider.shutdown());
  beforeEach(() => exporter.reset());

  describe('RunTracer', () => {
    const start = () => {
      const parent = trace.getTracer('t').startSpan('parent');
      const ctx = trace.setSpan(ROOT_CONTEXT, parent);
      return { parent, tracer: new RunTracer(ctx, 'claude-haiku-5-5') };
    };

    it('makes a chat span per model turn with GenAI usage, and a tool span per call, under the parent', () => {
      const { parent, tracer } = start();
      tracer.onMessage(
        assistant([toolUse('t1', 'mcp__staysync__get_quote')], {
          input_tokens: 100,
          output_tokens: 10,
          cache_read_input_tokens: 50,
          cache_creation_input_tokens: 25,
        }),
      );
      tracer.onMessage(toolResult('t1'));
      tracer.onMessage(
        assistant([{ type: 'text', text: 'done' }], {
          input_tokens: 200,
          output_tokens: 20,
        }),
      );
      tracer.end();
      parent.end();

      const chats = byName('chat claude-haiku-5-5');
      expect(chats).toHaveLength(2);
      expect(chats[0].kind).toBe(SpanKind.CLIENT);
      expect(attr(chats[0], 'gen_ai.operation.name')).toBe('chat');
      expect(attr(chats[0], 'gen_ai.request.model')).toBe('claude-haiku-5-5');
      expect(attr(chats[0], 'gen_ai.usage.input_tokens')).toBe(175); // cache reads and writes count as input
      expect(attr(chats[0], 'gen_ai.usage.output_tokens')).toBe(10);
      expect(attr(chats[1], 'gen_ai.usage.input_tokens')).toBe(200);

      const [tool] = byName('execute_tool get_quote'); // the MCP prefix is dropped
      expect(attr(tool, 'gen_ai.tool.name')).toBe('get_quote');
      expect(attr(tool, 'gen_ai.tool.call.id')).toBe('t1');
      for (const s of [...chats, tool])
        expect(s.parentSpanContext?.spanId).toBe(parent.spanContext().spanId);
      expect(tracer.totals).toEqual({
        inputTokens: 375,
        outputTokens: 30,
        turns: 2,
        toolCalls: 1,
      });
    });

    it('ends turns in order, each starting where the previous event ended', () => {
      const { tracer } = start();
      tracer.onMessage(assistant([toolUse('t1', 'mcp__staysync__get_quote')]));
      tracer.onMessage(toolResult('t1'));
      tracer.onMessage(assistant([]));
      const [first, second] = byName('chat claude-haiku-5-5');
      const [tool] = byName('execute_tool get_quote');
      const ms = (t: [number, number]) => t[0] * 1000 + t[1] / 1e6;
      expect(ms(first.endTime)).toBeLessThanOrEqual(ms(tool.endTime));
      expect(ms(second.startTime)).toBeGreaterThanOrEqual(ms(tool.endTime) - 1);
    });

    it('marks a failed tool result as an error', () => {
      const { tracer } = start();
      tracer.onMessage(
        assistant([toolUse('t1', 'mcp__staysync__propose_action')]),
      );
      tracer.onMessage(toolResult('t1', true));
      expect(byName('execute_tool propose_action')[0].status.code).toBe(
        SpanStatusCode.ERROR,
      );
    });

    it('closes a tool span that never got a result when the run ends', () => {
      const { tracer } = start();
      tracer.onMessage(assistant([toolUse('t1', 'mcp__staysync__get_quote')]));
      expect(byName('execute_tool get_quote')).toHaveLength(0); // still open
      tracer.end();
      expect(byName('execute_tool get_quote')[0].status.code).toBe(
        SpanStatusCode.ERROR,
      );
    });

    it('ignores sub-agent frames, results and anything else in the stream', () => {
      const { tracer } = start();
      tracer.onMessage({
        ...assistant([toolUse('s1', 'x')]),
        parent_tool_use_id: 'sub',
      });
      tracer.onMessage({ type: 'result' });
      tracer.onMessage({ type: 'system' });
      expect(exporter.getFinishedSpans()).toHaveLength(0);
    });

    it('does not put tool input or guest text on any span', () => {
      const { tracer } = start();
      tracer.onMessage(
        assistant([
          {
            type: 'tool_use',
            id: 't1',
            name: 'mcp__staysync__propose_action',
            input: { guestName: 'Ann Lee' },
          },
        ]),
      );
      tracer.onMessage(toolResult('t1'));
      expect(
        JSON.stringify(exporter.getFinishedSpans().map((s) => s.attributes)),
      ).not.toContain('Ann');
    });
  });

  describe('makeRunAgent', () => {
    const input: RunAgentInput = {
      runId: '7b1e2f0e-0000-4000-8000-000000000000',
      model: 'claude-haiku-5-5',
      mcpUrl: 'http://api/mcp',
      apiKey: 'k',
      today: '2026-10-05',
      timeoutMs: 5000,
      maxBudgetUsd: 1,
    };
    const result = {
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: 'ok',
      total_cost_usd: 0.0042,
      modelUsage: {
        m: {
          inputTokens: 300,
          outputTokens: 30,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
        },
      },
    };
    const fake = (
      messages: unknown[],
      seen: { headers?: Record<string, string> } = {},
    ): QueryFn =>
      async function* ({ options }) {
        await Promise.resolve();
        seen.headers = (
          options.mcpServers?.staysync as { headers: Record<string, string> }
        ).headers;
        for (const m of messages) yield m as SDKMessage;
      };

    it('wraps the run in an invoke_agent span with totals, and gives the MCP connection its traceparent', async () => {
      const seen: { headers?: Record<string, string> } = {};
      const run = makeRunAgent(() =>
        Promise.resolve(
          fake(
            [
              assistant([toolUse('t1', 'mcp__staysync__get_quote')]),
              toolResult('t1'),
              assistant([]),
              result,
            ],
            seen,
          ),
        ),
      );
      const outer = trace.getTracer('t').startSpan('consumer');
      const r = await context.with(trace.setSpan(context.active(), outer), () =>
        run(input),
      );
      outer.end();

      expect(r).toMatchObject({
        status: 'SUCCEEDED',
        costMicros: 4200,
        inputTokens: 300,
      });
      const [agent] = byName('invoke_agent staysync-inbox');
      expect(agent.parentSpanContext?.spanId).toBe(outer.spanContext().spanId);
      expect(attr(agent, 'gen_ai.agent.name')).toBe('staysync-inbox');
      expect(attr(agent, 'gen_ai.usage.input_tokens')).toBe(300);
      expect(attr(agent, 'staysync.cost_usd')).toBe(0.0042);
      expect(attr(agent, 'staysync.turns')).toBe(2);
      expect(attr(agent, 'staysync.tool_calls')).toBe(1);
      // turns and tool calls hang off the run span, and MCP gets the run span's context
      for (const s of [
        ...byName('chat claude-haiku-5-5'),
        ...byName('execute_tool get_quote'),
      ])
        expect(s.parentSpanContext?.spanId).toBe(agent.spanContext().spanId);
      expect(seen.headers?.traceparent).toBe(
        `00-${agent.spanContext().traceId}-${agent.spanContext().spanId}-01`,
      );
      expect(seen.headers?.['x-agent-run-id']).toBe(input.runId);
    });

    it('marks the span as failed when the run fails, and still returns the result', async () => {
      const run = makeRunAgent(() =>
        Promise.resolve(
          fake([
            {
              ...result,
              subtype: 'error_max_turns',
              errors: ['too many turns'],
            },
          ]),
        ),
      );
      const r = await run(input);
      expect(r).toMatchObject({ status: 'FAILED', error: 'too many turns' });
      expect(byName('invoke_agent staysync-inbox')[0].status.code).toBe(
        SpanStatusCode.ERROR,
      );
    });

    it('closes a half-finished tool span when the stream throws', async () => {
      const run = makeRunAgent(() =>
        Promise.resolve(async function* () {
          await Promise.resolve();
          yield assistant([
            toolUse('t1', 'mcp__staysync__get_quote'),
          ]) as unknown as SDKMessage;
          throw new Error('connection lost');
        } as QueryFn),
      );
      const r = await run(input);
      expect(r).toMatchObject({ status: 'FAILED', error: 'connection lost' });
      expect(byName('execute_tool get_quote')).toHaveLength(1);
    });
  });
});
