/** True once today's spend has reached the daily limit. Pure, so the guard is testable without a clock or DB. */
export const overBudget = (spentMicros: number, limitUsd: number): boolean =>
  spentMicros >= Math.round(limitUsd * 1_000_000);

/** What is left of the daily limit, in USD; never negative. */
export const remainingUsd = (spentMicros: number, limitUsd: number): number =>
  Math.max(0, limitUsd - spentMicros / 1_000_000);
