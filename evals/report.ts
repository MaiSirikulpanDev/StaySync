import type { Check } from './types';

export interface RunResult {
  pass: boolean;
  checks: Check[];
  costMicros: number;
  durationMs: number | null;
  inputTokens: number;
  outputTokens: number;
  traceId: string | null;
}

export interface CaseResult {
  id: string;
  kind: string;
  runs: RunResult[]; // one per repeat
}

export interface EvalResults {
  agent: string;
  model: string;
  repeat: number;
  date: string;
  cases: CaseResult[];
}

export interface Summary {
  passRate: number; // share of single runs that passed
  passAll: number; // share of cases that passed on every repeat (pass^k)
  costMicros: number;
  p50Ms: number;
  p95Ms: number;
  perCase: Record<string, { passes: number; runs: number; passAll: boolean }>;
}

/** Nearest-rank percentile; 0 for no data. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
}

export function summarize(r: EvalResults): Summary {
  const runs = r.cases.flatMap((c) => c.runs);
  const durations = runs.flatMap((x) =>
    x.durationMs === null ? [] : [x.durationMs],
  );
  const perCase = Object.fromEntries(
    r.cases.map((c) => {
      const passes = c.runs.filter((x) => x.pass).length;
      return [
        c.id,
        {
          passes,
          runs: c.runs.length,
          passAll: c.runs.length > 0 && passes === c.runs.length,
        },
      ];
    }),
  );
  return {
    passRate: runs.length ? runs.filter((x) => x.pass).length / runs.length : 0,
    passAll: r.cases.length
      ? Object.values(perCase).filter((c) => c.passAll).length / r.cases.length
      : 0,
    costMicros: runs.reduce((n, x) => n + x.costMicros, 0),
    p50Ms: percentile(durations, 50),
    p95Ms: percentile(durations, 95),
    perCase,
  };
}

/** Allowed drop in the share of passing runs before the comparison fails (5 points). */
export const PASS_RATE_TOLERANCE = 0.05;

/**
 * A regression is a case that passed on every repeat in the baseline and does not now, or a
 * drop of more than PASS_RATE_TOLERANCE in the share of passing runs. Cases that are new, or
 * that failed in the baseline already, never count.
 */
export function compare(now: Summary, baseline: Summary): string[] {
  const problems: string[] = [];
  for (const [id, b] of Object.entries(baseline.perCase)) {
    const n = now.perCase[id];
    if (b.passAll && n && !n.passAll)
      problems.push(
        `${id}: passed ${b.passes}/${b.runs} before, ${n.passes}/${n.runs} now`,
      );
  }
  // The rate is compared over the cases both runs have, so adding a case never moves it.
  const shared = Object.keys(baseline.perCase).filter(
    (id) => id in now.perCase,
  );
  const rate = (x: Summary) => {
    const runs = shared.reduce((n, id) => n + x.perCase[id].runs, 0);
    const passes = shared.reduce((n, id) => n + x.perCase[id].passes, 0);
    return runs ? passes / runs : 0;
  };
  if (rate(now) < rate(baseline) - PASS_RATE_TOLERANCE)
    problems.push(
      `pass rate ${pct(rate(now))} is more than ${PASS_RATE_TOLERANCE * 100} points below the baseline ${pct(rate(baseline))}`,
    );
  return problems;
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const usd = (micros: number) => `$${(micros / 1e6).toFixed(4)}`;
const sec = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/** Markdown report: headline numbers, a by-kind table, then one row per case. */
export function toMarkdown(r: EvalResults, regressions: string[] = []): string {
  const s = summarize(r);
  const lines = [
    `# Eval: ${r.agent} / ${r.model}`,
    '',
    `${r.date} · ${r.cases.length} cases × ${r.repeat} runs`,
    '',
    `- pass rate: **${pct(s.passRate)}** of runs`,
    `- pass^${r.repeat}: **${pct(s.passAll)}** of cases passed on every run`,
    `- cost: ${usd(s.costMicros)} total, ${usd(s.costMicros / Math.max(1, r.cases.length * r.repeat))} per run`,
    `- latency: p50 ${sec(s.p50Ms)}, p95 ${sec(s.p95Ms)}`,
    '',
  ];
  if (regressions.length)
    lines.push(
      '## Regressions against the baseline',
      '',
      ...regressions.map((x) => `- ${x}`),
      '',
    );

  lines.push('## By kind', '', '| kind | cases | pass^k |', '|---|---|---|');
  for (const kind of [...new Set(r.cases.map((c) => c.kind))]) {
    const cs = r.cases.filter((c) => c.kind === kind);
    const ok = cs.filter((c) => s.perCase[c.id].passAll).length;
    lines.push(`| ${kind} | ${cs.length} | ${ok}/${cs.length} |`);
  }

  lines.push(
    '',
    '## Cases',
    '',
    '| case | passed | cost | p50 | first failing check | trace |',
    '|---|---|---|---|---|---|',
  );
  for (const c of r.cases) {
    const p = s.perCase[c.id];
    const failing = c.runs.flatMap((x) => x.checks.filter((k) => !k.pass))[0];
    const cost = c.runs.reduce((n, x) => n + x.costMicros, 0);
    const p50 = percentile(
      c.runs.flatMap((x) => (x.durationMs === null ? [] : [x.durationMs])),
      50,
    );
    const trace = c.runs.find((x) => x.traceId)?.traceId ?? '';
    lines.push(
      `| ${c.id} | ${p.passes}/${p.runs} | ${usd(cost)} | ${sec(p50)} | ${failing ? `${failing.name}${failing.detail ? ` (${failing.detail})` : ''}`.replace(/\|/g, '\\|') : ''} | ${trace} |`,
    );
  }
  return lines.join('\n') + '\n';
}
