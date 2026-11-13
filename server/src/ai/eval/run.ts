/**
 * eval/run.ts — measure mock/Grok classifier accuracy against the hand-labeled CSV.
 *
 * Run with: npm run eval
 *           npm run eval -- --limit 10
 *
 * Prints:
 *   - Provider and model
 *   - work_type accuracy (% correct)
 *   - substance accuracy (% correct)
 *   - List of misses (title, expected, got)
 */

import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { classifyOne, modelVersion } from '../classifier.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load .env from the repo root — works from both src/ (tsx dev) and dist/ (compiled)
dotenv.config({ path: join(__dirname, '..', '..', '..', '..', '.env') });

// ── CLI flags ─────────────────────────────────────────────────────────────────

function parseArgs(): { limit: number | null } {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf('--limit');
  if (limitIdx !== -1 && args[limitIdx + 1] !== undefined) {
    const n = Number(args[limitIdx + 1]);
    if (Number.isInteger(n) && n > 0) return { limit: n };
  }
  return { limit: null };
}

const { limit } = parseArgs();

// ── Provider / model banner ───────────────────────────────────────────────────

const provider = process.env.AI_PROVIDER ?? 'mock';
const mv = modelVersion();
console.log(`=== Classifier Eval ===`);
console.log(`Provider: ${provider}  Model: ${mv}`);

// ── Load CSV ──────────────────────────────────────────────────────────────────

interface LabeledCommit {
  title: string;
  diff_summary: string;
  expected_work_type: string;
  expected_substance: string;
}

function parseCsv(content: string): LabeledCommit[] {
  const lines = content.trim().split('\n');
  const header = lines[0].split(',');

  return lines.slice(1).map(line => {
    // Parse CSV respecting quoted fields
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

const csvPath = join(__dirname, 'commits.csv');
let rows = parseCsv(readFileSync(csvPath, 'utf-8'));
if (limit !== null) {
  rows = rows.slice(0, limit);
}

// ── Run evaluation ────────────────────────────────────────────────────────────

interface Miss {
  title: string;
  field: 'work_type' | 'substance';
  expected: string;
  got: string;
}

let wtCorrect = 0;
let subCorrect = 0;
const misses: Miss[] = [];

for (const row of rows) {
  const diff = row.diff_summary.replace(/\\n/g, '\n');
  // classifyOne is pure — no DB access; pass empty task list for the eval
  const result = await classifyOne(row.title, diff, []);

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

const total = rows.length;
const wtAcc  = ((wtCorrect  / total) * 100).toFixed(1);
const subAcc = ((subCorrect / total) * 100).toFixed(1);

console.log(`Total commits evaluated: ${total}`);
console.log(`work_type  accuracy: ${wtAcc}%  (${wtCorrect}/${total})`);
console.log(`substance  accuracy: ${subAcc}%  (${subCorrect}/${total})`);

if (misses.length === 0) {
  console.log('\n✅ No misses!');
} else {
  console.log(`\nMisses (${misses.length}):`);
  for (const m of misses) {
    console.log(`  [${m.field}] "${m.title.slice(0, 60)}"`);
    console.log(`    expected: ${m.expected}  got: ${m.got}`);
  }
}
