/**
 * Waits for `work` (a client's disconnect) for at most `ms`, and never throws: it logs a warning
 * if the work failed or did not finish. A native Kafka client's disconnect() can stall, and one
 * stalled client must not stop the others from being closed or shutdown from finishing.
 */
export async function closeWithin(
  name: string,
  work: Promise<unknown>,
  ms: number,
  warn: (message: string) => void,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<'timeout'>((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ms);
  });
  try {
    if (
      (await Promise.race([work.then(() => 'done' as const), timedOut])) ===
      'timeout'
    )
      warn(`${name} did not disconnect within ${ms} ms; going on without it`);
  } catch (e) {
    warn(`${name} failed to disconnect: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }
}
