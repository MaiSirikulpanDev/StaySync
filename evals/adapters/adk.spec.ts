import { parseResult } from './adk';

describe('parseResult', () => {
  const ok = {
    status: 'SUCCEEDED',
    inputTokens: 1,
    outputTokens: 2,
    costMicros: 0,
  };

  it('takes the last JSON line and skips the log lines before it', () => {
    const out = [
      '[ADK] connecting',
      '{"not":"a result"}',
      JSON.stringify(ok),
      '',
    ].join('\n');
    expect(parseResult(out)).toEqual(ok);
  });

  it('prefers a later result over an earlier one', () => {
    const out = `${JSON.stringify(ok)}\n${JSON.stringify({ ...ok, status: 'FAILED', error: 'x' })}\n`;
    expect(parseResult(out)?.status).toBe('FAILED');
  });

  it('gives nothing when there is no result line', () => {
    expect(parseResult('only logs\nmore logs')).toBeUndefined();
    expect(parseResult('')).toBeUndefined();
  });
});
