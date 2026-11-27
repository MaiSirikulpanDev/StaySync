export interface RunAgentInput {
  runId: string;
  model: string;
  mcpUrl: string;
  apiKey: string; // the StaySync API key, for the MCP connection
  today: string; // YYYY-MM-DD, given so relative dates ("this Friday") resolve the same in evals
  timeoutMs: number;
  maxBudgetUsd: number; // hard cap for this one run
  systemPrompt?: string; // replaces the built-in prompt; the eval runner uses it to test a changed prompt
}

export interface RunAgentResult {
  status: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT';
  inputTokens: number;
  outputTokens: number;
  costMicros: number;
  error?: string;
}

export type RunAgent = (input: RunAgentInput) => Promise<RunAgentResult>;

/** DI token, so tests and the eval runner can replace the model call. */
export const RUN_AGENT = Symbol('RUN_AGENT');
