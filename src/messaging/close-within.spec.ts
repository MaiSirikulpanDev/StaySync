import { closeWithin } from './close-within';

describe('closeWithin', () => {
  const never = () => new Promise<void>(() => undefined);
  const logs = () => {
    const seen: string[] = [];
    return { seen, warn: (m: string) => void seen.push(m) };
  };

  it('is quiet when the work finishes in time', async () => {
    const { seen, warn } = logs();
    await closeWithin('producer', Promise.resolve(), 1000, warn);
    expect(seen).toEqual([]);
  });

  it('gives up on work that never finishes, and says which one', async () => {
    const { seen, warn } = logs();
    const started = Date.now();
    await closeWithin('consumer', never(), 50, warn);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(seen).toEqual([
      'consumer did not disconnect within 50 ms; going on without it',
    ]);
  });

  it('turns a rejection into a warning instead of throwing', async () => {
    const { seen, warn } = logs();
    await expect(
      closeWithin('admin', Promise.reject(new Error('boom')), 1000, warn),
    ).resolves.toBeUndefined();
    expect(seen).toEqual(['admin failed to disconnect: boom']);
  });

  it('lets the others finish when one is stuck', async () => {
    const { seen, warn } = logs();
    let closed = 0;
    await Promise.all([
      closeWithin('stuck', never(), 50, warn),
      closeWithin(
        'ok',
        Promise.resolve().then(() => void closed++),
        1000,
        warn,
      ),
    ]);
    expect(closed).toBe(1);
    expect(seen).toHaveLength(1);
  });

  it('leaves no timer behind when the work finishes first', async () => {
    jest.useFakeTimers();
    try {
      const p = closeWithin('x', Promise.resolve(), 60_000, () => undefined);
      await p;
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
