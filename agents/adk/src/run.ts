import {
  BaseLlm,
  InMemoryRunner,
  isFinalResponse,
  LlmAgent,
  MCPToolset,
} from '@google/adk';
import { systemPrompt } from './prompt.js';
import type { AdkInput, AdkResult } from './types.js';

const APP = 'staysync';
// The only tools the agent may call: StaySync's own MCP tools. None of them can change a stay.
// ADK has no built-in tools unless they are added, so this filter is the whole allow-list.
const TOOLS = [
  'get_guest_message',
  'list_properties',
  'get_property',
  'check_availability',
  'get_quote',
  'find_stays',
  'propose_action',
  'save_reply_draft',
];
const MAX_LLM_CALLS = 15; // the same turn limit as the Claude agent's maxTurns

const failed = (
  status: AdkResult['status'],
  error: string,
  inputTokens = 0,
  outputTokens = 0,
): AdkResult => ({
  status,
  inputTokens,
  outputTokens,
  costMicros: 0,
  error,
});

/**
 * One agent run on Google ADK: an LlmAgent with an MCPToolset on the same /mcp the Claude agent
 * uses, sending the same x-agent-run-id so the server records the tool calls and proposals.
 * Failures come back as a result, not an exception, as in the Claude agent.
 * `llm` replaces the model, so a test can script the conversation without a Gemini key.
 */
export async function runAdk(i: AdkInput, llm?: BaseLlm): Promise<AdkResult> {
  const toolset = new MCPToolset(
    {
      type: 'StreamableHTTPConnectionParams',
      url: i.mcpUrl,
      transportOptions: {
        requestInit: {
          headers: { 'x-api-key': i.apiKey, 'x-agent-run-id': i.runId },
        },
      },
    },
    TOOLS,
  );
  const runner = new InMemoryRunner({
    appName: APP,
    agent: new LlmAgent({
      name: 'staysync_inbox',
      model: llm ?? i.model,
      instruction: i.systemPrompt ?? systemPrompt(i.today),
      tools: [toolset],
    }),
  });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), i.timeoutMs);
  let inputTokens = 0;
  let outputTokens = 0;
  let final = false;
  // ADK reports an abort as an error event or as an exception, so both paths check the signal.
  const timedOut = () =>
    failed(
      'TIMED_OUT',
      `no result within ${i.timeoutMs} ms`,
      inputTokens,
      outputTokens,
    );
  try {
    await runner.sessionService.createSession({
      appName: APP,
      userId: 'inbox',
      sessionId: i.runId,
    });
    for await (const event of runner.runAsync({
      userId: 'inbox',
      sessionId: i.runId,
      newMessage: {
        role: 'user',
        parts: [{ text: 'Handle the guest message.' }],
      },
      runConfig: { maxLlmCalls: MAX_LLM_CALLS },
      abortSignal: abort.signal,
    })) {
      const u = event.usageMetadata;
      if (u && !event.partial) {
        // thinking tokens are billed as output, so they count as output here
        inputTokens +=
          (u.promptTokenCount ?? 0) + (u.toolUsePromptTokenCount ?? 0);
        outputTokens +=
          (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
      }
      if (event.errorCode || event.errorMessage)
        return abort.signal.aborted
          ? timedOut()
          : failed(
              'FAILED',
              `${event.errorCode ?? 'error'}: ${event.errorMessage ?? ''}`.trim(),
              inputTokens,
              outputTokens,
            );
      if (isFinalResponse(event)) final = true;
    }
    if (abort.signal.aborted) return timedOut();
    return final
      ? { status: 'SUCCEEDED', inputTokens, outputTokens, costMicros: 0 }
      : failed(
          'FAILED',
          'no final response from the agent',
          inputTokens,
          outputTokens,
        );
  } catch (e) {
    return abort.signal.aborted
      ? timedOut()
      : failed('FAILED', (e as Error).message, inputTokens, outputTokens);
  } finally {
    clearTimeout(timer);
    await runner.close().catch(() => undefined);
  }
}
