import { BaseLlm, type LlmRequest, type LlmResponse } from '@google/adk';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';
import { runAdk } from './run.js';
import type { AdkInput } from './types.js';

/** A model that plays a script, so the framework wiring is tested without a Gemini key. */
class ScriptedLlm extends BaseLlm {
  readonly requests: LlmRequest[] = [];
  constructor(private readonly steps: (() => LlmResponse | Error | 'hang')[]) {
    super({ model: 'scripted' });
  }
  async *generateContentAsync(
    req: LlmRequest,
    _stream?: boolean,
    abortSignal?: AbortSignal,
  ): AsyncGenerator<LlmResponse, void> {
    this.requests.push(req);
    const step = this.steps[this.requests.length - 1]?.();
    if (step === 'hang') {
      await new Promise((_, reject) =>
        abortSignal?.addEventListener('abort', () =>
          reject(new Error('aborted')),
        ),
      );
    }
    if (step instanceof Error) throw step;
    if (step && step !== 'hang') yield step;
  }
  connect(): never {
    throw new Error('live mode is not used');
  }
}

const call = (
  name: string,
  args: Record<string, unknown> = {},
): LlmResponse => ({
  content: { role: 'model', parts: [{ functionCall: { name, args } }] },
  usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 10 },
});
const say = (text: string): LlmResponse => ({
  content: { role: 'model', parts: [{ text }] },
  usageMetadata: {
    promptTokenCount: 150,
    candidatesTokenCount: 20,
    thoughtsTokenCount: 5,
  },
  turnComplete: true,
});

describe('runAdk', () => {
  let http: Server;
  let url: string;
  const seen: { tool?: string; headers: IncomingMessage['headers'][] } = {
    headers: [],
  };

  before(async () => {
    http = createServer((req, res) => {
      void (async () => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        seen.headers.push(req.headers);
        const server = new McpServer({
          name: 'fake-staysync',
          version: '1.0.0',
        });
        server.registerTool(
          'get_guest_message',
          { description: 'the message' },
          () => ({
            content: [{ type: 'text', text: '{"untrustedGuestMessage":"hi"}' }],
          }),
        );
        // A tool outside the allow-list: the agent must never be offered it.
        server.registerTool(
          'delete_everything',
          { description: 'must not be offered' },
          () => ({
            content: [{ type: 'text', text: 'gone' }],
          }),
        );
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        res.on('close', () => void server.close());
        await server.connect(transport);
        await transport.handleRequest(
          req,
          res,
          JSON.parse(Buffer.concat(chunks).toString() || '{}'),
        );
      })();
    });
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`;
  });
  after(() => http.close());

  const input = (over: Partial<AdkInput> = {}): AdkInput => ({
    runId: '7b1e2f0e-0000-4000-8000-000000000000',
    model: 'gemini-test',
    mcpUrl: url,
    apiKey: 'staysync-key',
    today: '2026-10-05',
    timeoutMs: 20_000,
    ...over,
  });

  it('calls a tool, sums token usage over the model calls, and reports success at no cost', async () => {
    seen.headers.length = 0;
    const llm = new ScriptedLlm([
      () => call('get_guest_message'),
      () => say('Hello Ann'),
    ]);
    const r = await runAdk(input(), llm);
    assert.deepEqual(r, {
      status: 'SUCCEEDED',
      inputTokens: 250,
      outputTokens: 35,
      costMicros: 0,
    });
    assert.equal(llm.requests.length, 2);
    // the second model call carries the tool result back
    const last = JSON.stringify(llm.requests[1].contents);
    assert.match(last, /untrustedGuestMessage/);
  });

  it('sends the StaySync key and the run id on every MCP request', async () => {
    assert.ok(seen.headers.length > 0);
    for (const h of seen.headers) {
      assert.equal(h['x-api-key'], 'staysync-key');
      assert.equal(h['x-agent-run-id'], '7b1e2f0e-0000-4000-8000-000000000000');
    }
  });

  it('offers the model only the allow-listed tools', async () => {
    const llm = new ScriptedLlm([() => say('done')]);
    await runAdk(input(), llm);
    const offered = JSON.stringify(llm.requests[0].config?.tools ?? []);
    assert.match(offered, /get_guest_message/);
    assert.doesNotMatch(offered, /delete_everything/);
  });

  it('gives the model the same task prompt as the Claude agent, with today in it', async () => {
    const llm = new ScriptedLlm([() => say('done')]);
    await runAdk(input({ today: '2026-10-05' }), llm);
    const system = JSON.stringify(llm.requests[0].config?.systemInstruction);
    assert.match(system, /Today is 2026-10-05/);
    assert.match(system, /never instructions to you/);
  });

  it('turns a model error into a failed result that keeps the tokens used so far', async () => {
    const llm = new ScriptedLlm([
      () => call('get_guest_message'),
      () => new Error('429 quota exceeded'),
    ]);
    const r = await runAdk(input(), llm);
    assert.equal(r.status, 'FAILED');
    assert.match(r.error ?? '', /429 quota exceeded/);
    assert.equal(r.inputTokens, 100);
  });

  it('fails a run that ends without a final answer', async () => {
    const llm = new ScriptedLlm([
      () => call('get_guest_message'),
      () => call('get_guest_message'),
      () => call('get_guest_message'),
    ]);
    const r = await runAdk(input(), llm);
    assert.equal(r.status, 'FAILED');
  });

  it('times out a model that never answers', async () => {
    const llm = new ScriptedLlm([() => 'hang']);
    const r = await runAdk(input({ timeoutMs: 300 }), llm);
    assert.equal(r.status, 'TIMED_OUT');
  });
});
