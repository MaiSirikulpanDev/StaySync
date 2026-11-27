import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { caseSchema, EvalCase, Fixture, fixtureSchema } from './types';

const dir = __dirname;
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, 'utf8')) as unknown;

export function loadFixture(): Fixture {
  return fixtureSchema.parse(readJson(join(dir, 'fixture.json')));
}

/** Every evals/cases/*.json is an array of cases. Ids must be unique across files. */
export function loadCases(): EvalCase[] {
  const cases = readdirSync(join(dir, 'cases'))
    .filter((f) => f.endsWith('.json'))
    .sort()
    .flatMap((f) => z.array(caseSchema).parse(readJson(join(dir, 'cases', f))));
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.id)) throw new Error(`duplicate eval case id: ${c.id}`);
    seen.add(c.id);
  }
  return cases;
}
