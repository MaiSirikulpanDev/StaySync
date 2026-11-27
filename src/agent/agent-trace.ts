import {
  Context,
  Span,
  SpanKind,
  SpanStatusCode,
  trace,
} from '@opentelemetry/api';

/**
 * Turns the Agent SDK's message stream into spans, using the OpenTelemetry GenAI semantic
 * conventions: one `chat <model>` span per model turn (with token usage) and one
 * `execute_tool <name>` span per tool call, all children of the run span. Tool inputs and
 * results are not attached: they hold guest text, and AgentToolCall already keeps the inputs.
 *
 * The SDK reports a turn when it is complete, so a turn span starts when the previous event
 * ended and ends when its message arrives. That is accurate to the turn, not to the token.
 */

/** The few fields of an SDK message this reads; SDKMessage is assignable to it. */
export interface StreamMessage {
  type: string;
  parent_tool_use_id?: string | null;
  message?: unknown;
}

interface Block {
  type?: string;
  id?: string;
  name?: string;
  tool_use_id?: string;
  is_error?: boolean;
}
interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}
interface Body {
  model?: string;
  content?: unknown;
  usage?: Usage;
}

const MCP_PREFIX = /^mcp__staysync__/;
const blocks = (content: unknown): Block[] =>
  Array.isArray(content) ? (content as Block[]) : [];

export class RunTracer {
  private readonly tracer = trace.getTracer('staysync');
  private turnStart = Date.now();
  private readonly tools = new Map<string, Span>();
  /** Input counts cache reads and writes, like AgentRun.inputTokens. */
  readonly totals = { inputTokens: 0, outputTokens: 0, turns: 0, toolCalls: 0 };

  constructor(
    private readonly parent: Context,
    private readonly model: string,
  ) {}

  onMessage(m: StreamMessage): void {
    // Sub-agent frames are not this run's own turns.
    if (m.parent_tool_use_id) return;
    if (m.type === 'assistant') this.onAssistant(m.message ?? {});
    else if (m.type === 'user') this.onUser(m.message ?? {});
  }

  /** Closes tool spans that never got a result (the run was aborted or ended early). */
  end(): void {
    for (const span of this.tools.values()) {
      span.setStatus({ code: SpanStatusCode.ERROR, message: 'no result' });
      span.end();
    }
    this.tools.clear();
  }

  private onAssistant(msg: Body) {
    const now = Date.now();
    const u = msg.usage ?? {};
    const input =
      (u.input_tokens ?? 0) +
      (u.cache_read_input_tokens ?? 0) +
      (u.cache_creation_input_tokens ?? 0);
    const output = u.output_tokens ?? 0;
    const model = msg.model ?? this.model;
    const turn = this.tracer.startSpan(
      `chat ${model}`,
      {
        kind: SpanKind.CLIENT,
        startTime: this.turnStart,
        attributes: {
          'gen_ai.operation.name': 'chat',
          'gen_ai.provider.name': 'anthropic',
          'gen_ai.request.model': this.model,
          'gen_ai.response.model': model,
          'gen_ai.usage.input_tokens': input,
          'gen_ai.usage.output_tokens': output,
        },
      },
      this.parent,
    );
    turn.end(now);
    this.totals.turns++;
    this.totals.inputTokens += input;
    this.totals.outputTokens += output;

    for (const b of blocks(msg.content)) {
      if (b.type !== 'tool_use' || !b.id || !b.name) continue;
      const name = b.name.replace(MCP_PREFIX, '');
      this.tools.set(
        b.id,
        this.tracer.startSpan(
          `execute_tool ${name}`,
          {
            kind: SpanKind.INTERNAL,
            startTime: now,
            attributes: {
              'gen_ai.operation.name': 'execute_tool',
              'gen_ai.tool.name': name,
              'gen_ai.tool.call.id': b.id,
            },
          },
          this.parent,
        ),
      );
      this.totals.toolCalls++;
    }
    this.turnStart = now;
  }

  private onUser(msg: Body) {
    const now = Date.now();
    for (const b of blocks(msg.content)) {
      if (b.type !== 'tool_result' || !b.tool_use_id) continue;
      const span = this.tools.get(b.tool_use_id);
      if (!span) continue;
      if (b.is_error) span.setStatus({ code: SpanStatusCode.ERROR });
      span.end(now);
      this.tools.delete(b.tool_use_id);
    }
    this.turnStart = now; // the next turn starts once the results are in
  }
}
