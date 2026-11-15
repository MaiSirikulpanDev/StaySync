import { overBudget, remainingUsd } from './budget';

describe('daily budget guard', () => {
  it('lets a run start while spend is under the limit', () => {
    expect(overBudget(0, 1)).toBe(false);
    expect(overBudget(999_999, 1)).toBe(false);
  });

  it('blocks at the limit and above it', () => {
    expect(overBudget(1_000_000, 1)).toBe(true);
    expect(overBudget(2_500_000, 1)).toBe(true);
  });

  it('blocks everything when the limit is zero', () => {
    expect(overBudget(0, 0)).toBe(true);
  });

  it('reports what is left, never below zero', () => {
    expect(remainingUsd(250_000, 1)).toBeCloseTo(0.75);
    expect(remainingUsd(3_000_000, 1)).toBe(0);
  });
});
