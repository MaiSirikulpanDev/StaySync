import {
  comparisonTable,
  compare,
  EvalResults,
  PASS_RATE_TOLERANCE,
  percentile,
  summarize,
  toMarkdown,
} from './report';

const run = (pass: boolean, extra = {}) => ({
  pass,
  checks: pass
    ? []
    : [{ name: 'filed no proposal', pass: false, detail: 'CANCEL_STAY' }],
  costMicros: 2000,
  durationMs: 4000,
  inputTokens: 100,
  outputTokens: 10,
  traceId: null,
  ...extra,
});

const results = (cases: Record<string, boolean[]>): EvalResults => ({
  agent: 'claude',
  model: 'claude-haiku-5-5',
  repeat: 3,
  date: '2026-11-27',
  cases: Object.entries(cases).map(([id, passes]) => ({
    id,
    kind: id.startsWith('i-') ? 'injection' : 'happy',
    runs: passes.map((p) => run(p)),
  })),
});

describe('percentile', () => {
  it('uses the nearest rank and copes with no data', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });
});

describe('summarize', () => {
  it('reports the pass rate of runs and pass^k of cases separately', () => {
    const s = summarize(
      results({
        a: [true, true, true],
        b: [true, false, true],
        c: [false, false, false],
      }),
    );
    expect(s.passRate).toBeCloseTo(5 / 9);
    expect(s.passAll).toBeCloseTo(1 / 3);
    expect(s.perCase.b).toEqual({ passes: 2, runs: 3, passAll: false });
    expect(s.costMicros).toBe(9 * 2000);
  });

  it('handles an empty run', () => {
    expect(summarize({ ...results({}), cases: [] })).toMatchObject({
      passRate: 0,
      passAll: 0,
    });
  });
});

describe('compare against a baseline', () => {
  const base = summarize(
    results({
      a: [true, true, true],
      b: [true, true, true],
      c: [false, false, false],
    }),
  );

  it('is quiet when nothing got worse', () => {
    expect(compare(base, base)).toEqual([]);
  });

  it('flags a case that passed every run before and does not now', () => {
    const now = summarize(
      results({
        a: [true, true, true],
        b: [true, false, true],
        c: [false, false, false],
      }),
    );
    // one lost run of nine is also more than 5 points, so the rate is flagged too
    expect(compare(now, base)).toEqual([
      'b: passed 3/3 before, 2/3 now',
      expect.stringContaining('pass rate'),
    ]);
  });

  it('does not flag a case that already failed, or a new one', () => {
    const now = summarize(
      results({
        a: [true, true, true],
        b: [true, true, true],
        c: [false, true, false],
        d: [false, false, false],
      }),
    );
    expect(compare(now, base)).toEqual([]);
  });

  it('flags a pass-rate drop beyond the tolerance even with no single regression', () => {
    const wide = summarize(
      results(
        Object.fromEntries(
          Array.from({ length: 10 }, (_, i) => [`c${i}`, [true, true, true]]),
        ),
      ),
    );
    const worse = summarize(
      results(
        Object.fromEntries(
          Array.from({ length: 10 }, (_, i) => [
            `c${i}`,
            i < 3 ? [true, true, false] : [true, true, true],
          ]),
        ),
      ),
    );
    // 3 of 30 runs lost = 10 points, above the 5 point tolerance (and the 3 cases regressed too)
    expect(compare(worse, wide).some((p) => p.includes('pass rate'))).toBe(
      true,
    );
    expect(PASS_RATE_TOLERANCE).toBe(0.05);
  });
});

describe('toMarkdown', () => {
  it('lists every case with its first failing check and the regressions', () => {
    const md = toMarkdown(
      results({ a: [true, true, true], 'i-x': [false, false, false] }),
      ['i-x: passed 3/3 before, 0/3 now'],
    );
    expect(md).toContain('# Eval: claude / claude-haiku-5-5');
    expect(md).toContain('## Regressions against the baseline');
    expect(md).toContain('| a | 3/3 |');
    expect(md).toContain('| i-x | 0/3 |');
    expect(md).toContain('filed no proposal (CANCEL_STAY)');
    expect(md).toContain('| injection | 1 | 0/1 |');
  });
});

describe('comparisonTable', () => {
  it('has one row per agent with rates, cost per run and median latency', () => {
    const a = results({ x: [true, true, true], y: [true, false, true] });
    const b = {
      ...results({ x: [true, true, true], y: [true, true, true] }),
      agent: 'adk',
      model: 'gemini-test',
    };
    const md = comparisonTable([a, b]);
    expect(md).toContain(
      '| claude | claude-haiku-5-5 | 2 × 3 | 83.3% | 50.0% | $0.0020 | 4.0s |',
    );
    expect(md).toContain(
      '| adk | gemini-test | 2 × 3 | 100.0% | 100.0% | $0.0020 | 4.0s |',
    );
  });
});
