/**
 * Eval runner: `npm run eval -- --agent claude --model <id> --repeat 3 --budget 1`.
 *
 * Starts Postgres and Kafka with Testcontainers (like the e2e suite, so no compose is needed),
 * boots the API in this process, and for every case resets the database, seeds the fixture,
 * calls the agent directly (no Kafka, for speed and determinism) and grades what the server
 * recorded. This spends real money: --budget (USD) is required and stops the run when reached.
 */
import { KafkaContainer } from '@testcontainers/kafka';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { INestApplication } from '@nestjs/common';
import { ROOT_CONTEXT, SpanKind } from '@opentelemetry/api';
import { grade, passed } from './graders';
import { loadCases, loadFixture } from './load';
import {
  compare,
  CaseResult,
  EvalResults,
  RunResult,
  summarize,
  toMarkdown,
} from './report';
import type { EvalCase, Facts, Fixture, Observed } from './types';
import type { RunAgent } from '../src/agent/agent.types';
import { runAgent as runClaude } from '../src/agent/run-agent';
import { adkBuilt, hasGeminiKey, runAdk } from './adapters/adk';
import { startTracing } from '../src/tracing/start';
import { inSpan } from '../src/tracing/trace';

const TODAY = '2026-10-05'; // the agent's "today", fixed so relative dates resolve the same every run
const API_KEY = 'eval-key';
const RUN_TIMEOUT_MS = 120_000;

const { values: args } = parseArgs({
  options: {
    agent: { type: 'string', default: 'claude' },
    model: { type: 'string' }, // default claude-haiku-5-5; required for adk (a Gemini model id)
    pause: { type: 'string', default: '0' }, // seconds between runs, for a free tier's rate limit
    repeat: { type: 'string', default: '3' },
    budget: { type: 'string' }, // USD, required
    case: { type: 'string', multiple: true }, // run only cases whose id starts with one of these
    'prompt-file': { type: 'string' }, // replaces the agent's system prompt (to test a change)
    'update-baseline': { type: 'boolean', default: false },
    baseline: { type: 'string', default: 'evals/baseline.json' },
    out: { type: 'string', default: 'evals/results' },
  },
});

/** The adapter registry: every agent framework is a `RunAgent`. ADK joins in M17. */
const adapters: Record<string, RunAgent> = { claude: runClaude, adk: runAdk };

function fail(msg: string): never {
  console.error(`eval: ${msg}`);
  process.exit(1);
}

async function main() {
  // Spans (and so trace ids) exist either way; they reach Jaeger only if OTEL_EXPORTER_OTLP_ENDPOINT is set.
  const tracing = startTracing('staysync-eval');
  const repeat = Number(args.repeat);
  const budgetUsd = Number(args.budget);
  if (!args.budget || !(budgetUsd > 0))
    fail(
      '--budget <USD> is required: the run spends real money and stops when it is reached',
    );
  if (!Number.isInteger(repeat) || repeat < 1)
    fail('--repeat must be a positive integer');
  const agent = args.agent;
  const model =
    args.model ??
    (agent === 'claude'
      ? 'claude-haiku-5-5'
      : fail(
          '--model is required for this agent (a Gemini model id from Google AI Studio)',
        ));
  const pauseMs = Number(args.pause) * 1000;
  if (!(pauseMs >= 0)) fail('--pause must be a number of seconds');
  if (!adapters[agent])
    fail(
      `unknown --agent ${agent} (have: ${Object.keys(adapters).join(', ')})`,
    );
  if (agent === 'claude' && !process.env.ANTHROPIC_API_KEY)
    fail('ANTHROPIC_API_KEY is not set');
  if (agent === 'adk') {
    if (!adkBuilt())
      fail(
        'build the ADK agent first: npm ci --prefix agents/adk && npm run build --prefix agents/adk',
      );
    if (!hasGeminiKey())
      fail('no Gemini key: set GEMINI_API_KEY, or put it in agents/adk/.env');
  }
  const systemPrompt = args['prompt-file']
    ? readFileSync(args['prompt-file'], 'utf8')
    : undefined;

  const filters = args.case ?? [];
  const cases = loadCases().filter(
    (c) => !filters.length || filters.some((f) => c.id.startsWith(f)),
  );
  if (!cases.length) fail('no case matches --case');
  const fixture = loadFixture();
  const runAgent = adapters[agent];

  console.error('starting Postgres and Kafka...');
  const [pg, kafka] = await Promise.all([
    new PostgreSqlContainer('postgres:16').start(),
    new KafkaContainer('confluentinc/cp-kafka:7.7.0').withKraft().start(),
  ]);
  let app: INestApplication | undefined;
  try {
    Object.assign(process.env, {
      NODE_ENV: 'test', // silences request logs
      DATABASE_URL: pg.getConnectionUri(),
      KAFKA_BROKERS: `${kafka.getHost()}:${kafka.getMappedPort(9093)}`,
      API_KEY,
      OTA_WEBHOOK_SECRET: 'eval-secret',
    });
    execSync('npx prisma migrate deploy', {
      stdio: 'ignore',
      env: process.env,
    });

    // Required only now: the config module validates the environment as soon as it is loaded.
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { NestFactory } =
      require('@nestjs/core') as typeof import('@nestjs/core');
    const { AppModule } =
      require('../src/app.module') as typeof import('../src/app.module');
    const { configureApp } =
      require('../src/setup-app') as typeof import('../src/setup-app');
    const { PrismaService } =
      require('../src/prisma/prisma.service') as typeof import('../src/prisma/prisma.service');
    const { AgentRunsService } =
      require('../src/agent-runs/agent-runs.service') as typeof import('../src/agent-runs/agent-runs.service');
    /* eslint-enable @typescript-eslint/no-require-imports */
    app = await NestFactory.create(AppModule, {
      bufferLogs: true,
      rawBody: true,
    });
    configureApp(app);
    await app.listen(0);
    const port = (
      (
        app.getHttpServer() as import('node:http').Server
      ).address() as AddressInfo
    ).port;
    const base = `http://127.0.0.1:${port}`;
    const prisma = app.get(PrismaService);
    const runs = app.get(AgentRunsService, { strict: false });

    const api = async <T>(
      method: string,
      path: string,
      body?: unknown,
    ): Promise<T> => {
      const res = await fetch(base + path, {
        method,
        headers: { 'x-api-key': API_KEY, 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (!res.ok)
        throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
      return (await res.json()) as T;
    };

    /** Fresh database, the fixture, the guest message: returns what the agent is run on. */
    async function seed(c: EvalCase, f: Fixture) {
      await prisma.$executeRawUnsafe(
        'TRUNCATE "Property", "OutboxEvent", "ProcessedEvent", "GuestMessage", "AgentRun", "AgentToolCall", "AgentProposal" CASCADE',
      );
      const property = await api<{ id: string; icalToken: string }>(
        'POST',
        '/properties',
        f.property,
      );
      for (const r of f.rules)
        await api('POST', `/properties/${property.id}/pricing-rules`, r);
      const stayIds: Record<string, string> = {};
      for (const { key, ...s } of f.stays) {
        stayIds[key] = (
          await api<{ id: string }>(
            'POST',
            `/properties/${property.id}/stays`,
            s,
          )
        ).id;
      }
      const message = await api<{ id: string }>(
        'POST',
        `/properties/${property.id}/guest-messages`,
        {
          fromName: c.message.fromName,
          body: c.message.body,
          ...(c.message.stay && { stayId: stayIds[c.message.stay] }),
        },
      );
      const q = c.expect.reply.quote;
      const quote = q
        ? await api<{ totalCents: number }>(
            'GET',
            `/properties/${property.id}/quote?checkIn=${q.checkIn}&checkOut=${q.checkOut}${q.guests ? `&guests=${q.guests}` : ''}`,
          )
        : undefined;
      const facts: Facts = {
        stayIds,
        quoteCents: quote?.totalCents,
        icalToken: property.icalToken,
      };
      return { messageId: message.id, facts };
    }

    let spent = 0; // micros
    const results: CaseResult[] = [];
    let stopped = false;

    /** One span per case run, so the report's trace id opens the whole run in Jaeger. */
    const runOnce = (c: EvalCase) =>
      inSpan(`eval ${c.id}`, SpanKind.INTERNAL, ROOT_CONTEXT, (span) =>
        runCase(c, span.spanContext().traceId),
      );

    async function runCase(c: EvalCase, traceId: string): Promise<RunResult> {
      const { messageId, facts } = await seed(c, fixture);
      const run = await prisma.agentRun.create({
        data: { guestMessageId: messageId, agent, model, traceId },
      });
      const started = Date.now();
      const r = await runAgent({
        runId: run.id,
        model,
        mcpUrl: `${base}/mcp`,
        apiKey: API_KEY,
        today: TODAY,
        timeoutMs: RUN_TIMEOUT_MS,
        maxBudgetUsd: Math.max(0.001, budgetUsd - spent / 1e6),
        systemPrompt,
      }).catch((e: Error) => ({
        status: 'FAILED' as const,
        inputTokens: 0,
        outputTokens: 0,
        costMicros: 0,
        error: e.message,
      }));
      await runs.finish(run.id, r.status, {
        inputTokens: r.inputTokens,
        outputTokens: r.outputTokens,
        costMicros: r.costMicros,
        durationMs: Date.now() - started,
        error: r.error,
      });
      spent += r.costMicros;

      const final = await prisma.agentRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      const [message, proposals, toolCalls] = await Promise.all([
        prisma.guestMessage.findUniqueOrThrow({ where: { id: messageId } }),
        prisma.agentProposal.findMany({ where: { agentRunId: run.id } }),
        prisma.agentToolCall.findMany({
          where: { agentRunId: run.id },
          orderBy: { createdAt: 'asc' },
        }),
      ]);
      const observed: Observed = {
        run: {
          status: final.status,
          costMicros: final.costMicros,
          durationMs: final.durationMs,
          inputTokens: final.inputTokens,
          outputTokens: final.outputTokens,
          traceId: final.traceId,
          error: final.error,
        },
        draft: message.replyDraft,
        proposals: proposals.map((p) => ({
          type: p.type,
          params: p.params as Record<string, unknown>,
        })),
        toolCalls: toolCalls.map((t) => ({ tool: t.tool, ok: t.ok })),
      };
      const checks = grade(c, observed, facts);
      return {
        pass: passed(checks),
        checks,
        costMicros: final.costMicros,
        durationMs: final.durationMs,
        inputTokens: final.inputTokens,
        outputTokens: final.outputTokens,
        traceId: final.traceId,
      };
    }

    for (const c of cases) {
      const runsOfCase: RunResult[] = [];
      for (let i = 0; i < repeat; i++) {
        if (spent / 1e6 >= budgetUsd) {
          stopped = true;
          break;
        }
        if (pauseMs && (runsOfCase.length || results.length))
          await new Promise((r) => setTimeout(r, pauseMs));
        runsOfCase.push(await runOnce(c));
        console.error(
          `${c.id} #${i + 1}: ${runsOfCase[i].pass ? 'pass' : 'FAIL'}  ($${(spent / 1e6).toFixed(4)} of $${budgetUsd})`,
        );
      }
      if (stopped) break; // an incomplete case would make pass^k meaningless, so it is dropped
      results.push({ id: c.id, kind: c.kind, runs: runsOfCase });
    }

    const out: EvalResults = {
      agent,
      model,
      repeat,
      date: new Date().toISOString().slice(0, 10),
      cases: results,
    };
    if (stopped)
      console.error(
        `budget of $${budgetUsd} reached: ${results.length} of ${cases.length} cases finished`,
      );

    // The baseline is only comparable for the same agent and model.
    let regressions: string[] = [];
    let baselineNote = '';
    if (existsSync(args.baseline)) {
      const b = JSON.parse(readFileSync(args.baseline, 'utf8')) as EvalResults;
      if (b.agent === agent && b.model === model)
        regressions = compare(summarize(out), summarize(b));
      else
        baselineNote = `baseline is for ${b.agent} / ${b.model}; not compared`;
    } else
      baselineNote =
        'no baseline yet; run with --update-baseline to record one';

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const file = join(args.out, `${stamp}-${agent}-${model}`);
    mkdirSync(args.out, { recursive: true });
    writeFileSync(`${file}.json`, JSON.stringify(out, null, 2) + '\n');
    const md = toMarkdown(out, regressions);
    writeFileSync(`${file}.md`, md);
    console.log(md);
    if (baselineNote) console.log(baselineNote);
    console.error(`written to ${file}.json and .md`);

    if (args['update-baseline']) {
      if (stopped) fail('not recording a baseline from an incomplete run');
      writeFileSync(args.baseline, JSON.stringify(out, null, 2) + '\n');
      console.error(`baseline recorded in ${args.baseline}`);
    }
    if (regressions.length) {
      console.error(
        `eval: ${regressions.length} regression(s) against the baseline`,
      );
      process.exitCode = 1;
    } else if (stopped) process.exitCode = 2;
  } finally {
    await app?.close();
    await tracing.shutdown(); // flushes the spans
    await Promise.all([pg.stop(), kafka.stop()]);
  }
}

void main().catch((e) => {
  console.error(e);
  process.exit(1);
});
