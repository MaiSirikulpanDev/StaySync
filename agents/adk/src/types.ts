/** Same shape as RunAgentInput / RunAgentResult in the main app, which is what the eval runner speaks. */
export interface AdkInput {
  runId: string;
  model: string; // a Gemini model id, e.g. from Google AI Studio
  mcpUrl: string;
  apiKey: string; // the StaySync API key, for the MCP connection (not the Gemini key)
  today: string; // YYYY-MM-DD
  timeoutMs: number;
  systemPrompt?: string;
}

export interface AdkResult {
  status: 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT';
  inputTokens: number;
  outputTokens: number;
  costMicros: number; // always 0: the free tier is not billed
  error?: string;
}
