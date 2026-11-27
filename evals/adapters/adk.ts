import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  RunAgent,
  RunAgentInput,
  RunAgentResult,
} from '../../src/agent/agent.types';

const ADK_DIR = join(__dirname, '..', '..', 'agents', 'adk');
const KEY_VARS = ['GEMINI_API_KEY', 'GOOGLE_API_KEY', 'GOOGLE_GENAI_API_KEY'];

/** A Gemini key in the environment or in agents/adk/.env (never printed). */
export function hasGeminiKey(): boolean {
  if (KEY_VARS.some((k) => process.env[k])) return true;
  const file = join(ADK_DIR, '.env');
  return (
    existsSync(file) &&
    new RegExp(`^\\s*(${KEY_VARS.join('|')})\\s*=\\s*\\S`, 'm').test(
      readFileSync(file, 'utf8'),
    )
  );
}

export const adkBuilt = () => existsSync(join(ADK_DIR, 'dist', 'main.js'));

const failed = (error: string): RunAgentResult => ({
  status: 'FAILED',
  inputTokens: 0,
  outputTokens: 0,
  costMicros: 0,
  error,
});

/** The last stdout line that parses as a result: ADK and its libraries log to stdout too. */
export function parseResult(stdout: string): RunAgentResult | undefined {
  for (const line of stdout.trim().split('\n').reverse()) {
    try {
      const r = JSON.parse(line) as RunAgentResult;
      if (r && typeof r.status === 'string') return r;
    } catch {
      /* not JSON: a log line */
    }
  }
  return undefined;
}

/**
 * The ADK agent runs as its own process (agents/adk has its own dependencies), so the eval
 * runner spawns it once per run: input as JSON on stdin, result as the last line of stdout.
 * The Anthropic key is not passed on. The Gemini key comes from the environment or from
 * agents/adk/.env.
 */
export const runAdk: RunAgent = (i: RunAgentInput) =>
  new Promise((resolve) => {
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    const child = spawn(
      process.execPath,
      ['--env-file-if-exists=.env', 'dist/main.js'],
      { cwd: ADK_DIR, env, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    // The agent times itself out; this is only for a process that hangs past that.
    const kill = setTimeout(() => child.kill('SIGKILL'), i.timeoutMs + 15_000);
    child.on('error', (e) => {
      clearTimeout(kill);
      resolve(failed(`could not start the ADK agent: ${e.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(kill);
      resolve(
        parseResult(out) ??
          failed(
            `ADK agent exited with ${code} and no result: ${err.slice(-300)}`,
          ),
      );
    });
    child.stdin.end(
      JSON.stringify({
        runId: i.runId,
        model: i.model,
        mcpUrl: i.mcpUrl,
        apiKey: i.apiKey,
        today: i.today,
        timeoutMs: i.timeoutMs,
        systemPrompt: i.systemPrompt,
      }),
    );
  });
