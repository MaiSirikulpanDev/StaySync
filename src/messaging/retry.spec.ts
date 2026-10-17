import { attemptCount, notBefore } from './retry';

describe('attemptCount', () => {
  it('is 0 for a first delivery', () => {
    expect(attemptCount(undefined)).toBe(0);
    expect(attemptCount({})).toBe(0);
  });

  it('reads the x-attempt header whether it arrives as a Buffer or a string', () => {
    expect(attemptCount({ 'x-attempt': Buffer.from('3') })).toBe(3);
    expect(attemptCount({ 'x-attempt': '2' })).toBe(2);
  });

  it('treats garbage as 0', () => {
    expect(attemptCount({ 'x-attempt': 'abc' })).toBe(0);
  });
});

describe('notBefore', () => {
  it('reads the timestamp, 0 when absent', () => {
    expect(notBefore({ 'x-not-before': Buffer.from('1700000000000') })).toBe(
      1700000000000,
    );
    expect(notBefore({})).toBe(0);
  });
});
