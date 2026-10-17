import type { IHeaders } from '@confluentinc/kafka-javascript/types/kafkajs';

export const ATTEMPT_HEADER = 'x-attempt';
export const NOT_BEFORE_HEADER = 'x-not-before';

const text = (v: IHeaders[string]) =>
  Array.isArray(v) ? String(v[0] ?? '') : (v?.toString() ?? '');

/** How many times this event has already failed; 0 for a first delivery from the main topic. */
export function attemptCount(headers: IHeaders | undefined): number {
  const n = Number(text(headers?.[ATTEMPT_HEADER]));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Epoch ms before which a retry must not be processed; 0 when absent. */
export function notBefore(headers: IHeaders | undefined): number {
  const n = Number(text(headers?.[NOT_BEFORE_HEADER]));
  return Number.isFinite(n) ? n : 0;
}
