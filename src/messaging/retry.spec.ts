import { deathCount } from './retry';

const death = (queue: string, reason: string, count: number) => ({
  queue,
  reason,
  count,
});

describe('deathCount', () => {
  it('is 0 for a first delivery', () => {
    expect(deathCount(undefined, 'ota-sync')).toBe(0);
    expect(deathCount({}, 'ota-sync')).toBe(0);
  });

  it('counts only rejections from the given queue, not TTL expiry in the retry queue', () => {
    const headers = {
      'x-death': [
        death('ota-sync.retry', 'expired', 3),
        death('ota-sync', 'rejected', 3),
        death('other', 'rejected', 9),
      ],
    };
    expect(deathCount(headers, 'ota-sync')).toBe(3);
  });
});
