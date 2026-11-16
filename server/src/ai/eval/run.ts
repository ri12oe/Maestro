/**
 * eval/run.ts — measure mock/Grok classifier accuracy against labeled CSV sets.
 *
 * Run with: npm run eval
 *           npm run eval -- --limit 10
 *           npm run eval -- --set holdout
 *           npm run eval -- --set all
 *
 * Prints per-set:
 *   - Provider and model
 *   - work_type accuracy (% correct)
 *   - substance accuracy (% correct)
 *   - List of misses (title, expected, got)
 */

import '../../loadEnv.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { classifyOne, modelVersion } from '../classifier.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── CLI flags ─────────────────────────────────────────────────────────────────

function parseArgs(): { limit: number | null; set: 'main' | 'holdout' | 'all' } {
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

  return { limit, set };
}

const { limit, set: evalSet } = parseArgs();

// ── Provider / model banner ───────────────────────────────────────────────────

const provider = process.env.AI_PROVIDER ?? 'mock';
const mv = modelVersion();
console.log(`=== Classifier Eval ===`);
console.log(`Provider: ${provider}  Model: ${mv}`);

// ── CSV parsing ───────────────────────────────────────────────────────────────

interface LabeledCommit {
  title: string;
  diff_summary: string;
  files_changed: string;
  additions: string;
  deletions: string;
  expected_work_type: string;
  expected_substance: string;
}

function parseCsv(content: string): LabeledCommit[] {
  const lines = content.trim().split('\n');
  const header = lines[0].split(',');

  return lines.slice(1).map(line => {
    const fields: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    fields.push(current);

    const row: Record<string, string> = {};
    header.forEach((h, i) => { row[h.trim()] = (fields[i] ?? '').trim(); });
    return row as unknown as LabeledCommit;
  });
}

function loadSet(filename: string): LabeledCommit[] {
  const csvPath = join(__dirname, filename);
  return parseCsv(readFileSync(csvPath, 'utf-8'));
}

// ── Evaluation runner ─────────────────────────────────────────────────────────

interface Miss {
  title: string;
  field: 'work_type' | 'substance';
  expected: string;
  got: string;
}

async function runEval(label: string, rows: LabeledCommit[]): Promise<void> {
  let wtCorrect = 0;
  let subCorrect = 0;
  const misses: Miss[] = [];

  for (const row of rows) {
    const diff = row.diff_summary.replace(/\\n/g, '\n');
    const stats = {
      filesChanged: Number(row.files_changed) || null,
      additions:    Number(row.additions)    || null,
      deletions:    Number(row.deletions)    || null,
    };
    const result = await classifyOne(row.title, diff, [], stats);

    if (result.work_type === row.expected_work_type) {
      wtCorrect++;
    } else {
      misses.push({ title: row.title, field: 'work_type', expected: row.expected_work_type, got: result.work_type });
    }

    if (result.substance === row.expected_substance) {
      subCorrect++;
    } else {
      misses.push({ title: row.title, field: 'substance', expected: row.expected_substance, got: result.substance });
    }
  }

  const total  = rows.length;
  const wtAcc  = ((wtCorrect  / total) * 100).toFixed(1);
  const subAcc = ((subCorrect / total) * 100).toFixed(1);

  console.log(`\n--- ${label} (${total} commits) ---`);
  console.log(`work_type  accuracy: ${wtAcc}%  (${wtCorrect}/${total})`);
  console.log(`substance  accuracy: ${subAcc}%  (${subCorrect}/${total})`);

  if (misses.length === 0) {
    console.log('✅ No misses!');
  } else {
    console.log(`Misses (${misses.length}):`);
    for (const m of misses) {
      console.log(`  [${m.field}] "${m.title.slice(0, 60)}"`);
      console.log(`    expected: ${m.expected}  got: ${m.got}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (evalSet === 'main' || evalSet === 'all') {
  let mainRows = loadSet('commits.csv');
  if (limit !== null) mainRows = mainRows.slice(0, limit);
  await runEval('main set (commits.csv)', mainRows);
}

if (evalSet === 'holdout' || evalSet === 'all') {
  let holdoutRows = loadSet('holdout.csv');
  if (limit !== null) holdoutRows = holdoutRows.slice(0, limit);
  await runEval('holdout set (holdout.csv)', holdoutRows);
}
