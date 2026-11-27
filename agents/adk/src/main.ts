/**
 * Entry for the eval runner: reads one AdkInput as JSON on stdin, runs it, and prints the
 * AdkResult as the last line of stdout. Needs GEMINI_API_KEY (or GOOGLE_API_KEY) in the environment.
 * ADK and its dependencies log to stdout, so the runner reads only the last line.
 */
import { runAdk } from './run.js';
import type { AdkInput } from './types.js';

async function main() {
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(c as Buffer);
  const input = JSON.parse(Buffer.concat(chunks).toString('utf8')) as AdkInput;
  const result = await runAdk(input);
  process.stdout.write(`\n${JSON.stringify(result)}\n`);
  process.exit(0); // the MCP and HTTP clients can keep the event loop alive
}

void main().catch((e: Error) => {
  process.stdout.write(
    `\n${JSON.stringify({ status: 'FAILED', inputTokens: 0, outputTokens: 0, costMicros: 0, error: e.message })}\n`,
  );
  process.exit(0);
});
