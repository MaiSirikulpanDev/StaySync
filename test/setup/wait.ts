/** Polls until fn returns a truthy value; fails with the last value after timeoutMs. */
export async function waitFor<T>(
  fn: () => T | Promise<T>,
  timeoutMs = 10000,
): Promise<NonNullable<T>> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end)
      throw new Error(`waitFor timed out (last value: ${String(v)})`);
    await new Promise((r) => setTimeout(r, 50));
  }
}
