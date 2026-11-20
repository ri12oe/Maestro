/**
 * eval/run.ts — measure mock/Grok classifier accuracy against labeled CSV sets.
 *
 * Run with: npm run eval
 *           npm run eval -- --limit 10
 *           npm run eval -- --set holdout
 *           npm run eval -- --set all
 *           npm run eval:results
 *
 * Prints per-set:
 *   - Provider and model
 *   - work_type accuracy (% correct)
 *   - substance accuracy (% correct)
 *   - List of misses (title, expected, got)
 *
 * `npm run eval:results` is `--set holdout --out src/ai/eval/results.json`.
 * That file is what GET /api/eval and the "Is the AI right?" card show.
 * The provider written there is the one that scored the rows.
 */

import '../../loadEnv.js';
import { writeFileSync } from 'fs';
import { modelVersion } from '../classifier.js';
import { buildResultsFile, loadLabeledSet, scoreLabeledRows, type Score } from './measure.js';
import { parseEvalResults } from './results.js';

function parseArgs(): { limit: number | null; set: 'main' | 'holdout' | 'all'; out: string | null } {
  const args = process.argv.slice(2);

  const limitIdx = args.indexOf('--limit');
  let limit: number | null = null;
  if (limitIdx !== -1 && args[limitIdx + 1] !== undefined) {
    const n = Number(args[limitIdx + 1]);
    if (Number.isInteger(n) && n > 0) limit = n;
  }

  const setIdx = args.indexOf('--set');
  let set: 'main' | 'holdout' | 'all' = 'main';
  if (setIdx !== -1) {
    const val = args[setIdx + 1];
    if (val === 'holdout' || val === 'all' || val === 'main') set = val;
  }

  const outIdx = args.indexOf('--out');
  let out: string | null = null;
  if (outIdx !== -1) {
    const val = args[outIdx + 1];
    if (!val || val.startsWith('--')) {
      console.error('--out needs a file path');
      process.exit(1);
    }
    out = val;
  }

  return { limit, set, out };
}

const { limit, set: evalSet, out } = parseArgs();

const provider = process.env.AI_PROVIDER ?? 'mock';
const mv = modelVersion();
console.log(`=== Classifier Eval ===`);
console.log(`Provider: ${provider}  Model: ${mv}`);

function printScore(label: string, score: Score): void {
  const wtAcc = ((score.workTypeCorrect / score.total) * 100).toFixed(1);
  const subAcc = ((score.substanceCorrect / score.total) * 100).toFixed(1);

  console.log(`\n--- ${label} (${score.total} commits) ---`);
  console.log(`work_type  accuracy: ${wtAcc}%  (${score.workTypeCorrect}/${score.total})`);
  console.log(`substance  accuracy: ${subAcc}%  (${score.substanceCorrect}/${score.total})`);

  if (score.misses.length === 0) {
    console.log('✅ No misses!');
  } else {
    console.log(`Misses (${score.misses.length}):`);
    for (const m of score.misses) {
      console.log(`  [${m.field}] "${m.title.slice(0, 60)}"`);
      console.log(`    expected: ${m.expected}  got: ${m.got}`);
    }
  }
}

async function runSet(label: string, filename: string): Promise<Score> {
  let rows = loadLabeledSet(filename);
  if (limit !== null) rows = rows.slice(0, limit);
  const score = await scoreLabeledRows(rows);
  printScore(label, score);
  return score;
}

let holdoutScore: Score | null = null;

if (evalSet === 'main' || evalSet === 'all') {
  await runSet('main set (commits.csv)', 'commits.csv');
}

if (evalSet === 'holdout' || evalSet === 'all') {
  holdoutScore = await runSet('holdout set (holdout.csv)', 'holdout.csv');
}

if (out) {
  if (limit !== null) {
    console.error('Refusing to write results for a limited run.');
    process.exit(1);
  }
  if (!holdoutScore) {
    console.error('Refusing to write results without the holdout set. Pass --set holdout.');
    process.exit(1);
  }
  const file = buildResultsFile(holdoutScore, {
    provider,
    model: mv,
    evaluatedAt: new Date().toISOString(),
  });
  if (!parseEvalResults(file)) {
    console.error('Refusing to write results that failed validation.');
    process.exit(1);
  }
  writeFileSync(out, `${JSON.stringify(file, null, 2)}\n`);
  console.log(`\nWrote ${out}`);
}
