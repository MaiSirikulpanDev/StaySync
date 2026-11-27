/** `npm run eval:compare -- evals/results/a.json evals/results/b.json`: the README comparison table. */
import { readFileSync } from 'node:fs';
import { comparisonTable, EvalResults } from './report';

const files = process.argv.slice(2);
if (!files.length) {
  console.error(
    'usage: npm run eval:compare -- <results.json> [<results.json> ...]',
  );
  process.exit(1);
}
console.log(
  comparisonTable(
    files.map((f) => JSON.parse(readFileSync(f, 'utf8')) as EvalResults),
  ),
);
