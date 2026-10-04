import type { StartedTestContainer } from 'testcontainers';

export default async function teardown() {
  const cs = (globalThis as { __containers?: StartedTestContainer[] })
    .__containers;
  await Promise.all((cs ?? []).map((c) => c.stop()));
}
