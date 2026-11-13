/**
 * eval/run.ts — measure mock classifier accuracy against the hand-labeled CSV.
 *
 * Run with: npm run eval
 *
 * Prints:
 *   - work_type accuracy (% correct)
 *   - substance accuracy (% correct)
 *   - List of misses (title, expected, got)
 */

import 'dotenv/config';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
const rows = parseCsv(readFileSync(csvPath, 'utf-8'));

// ── Inline mock classifier (no DB dependency) ─────────────────────────────────

const WORK_TYPE_KEYWORDS: Record<string, string[]> = {
  test:       ['test', 'spec', 'jest', 'vitest', 'coverage', 'assert'],
  fix:        ['fix', 'bug', 'patch', 'hotfix', 'repair', 'resolve', 'revert'],
  refactor:   ['refactor', 'rename', 'restructure', 'reorganize', 'cleanup', 'extract', 'move'],
  docs:       ['doc', 'readme', 'comment', 'changelog', 'docs', 'licence', 'license'],
  formatting: ['format', 'lint', 'style', 'indent', 'whitespace', 'prettier', 'eslint'],
  generated:  ['generated', 'auto-generated', 'scaffold', 'boilerplate', 'codegen', 'lock', 'package-lock'],
  feature:    ['add', 'implement', 'create', 'build', 'feature', 'new', 'introduce', 'support'],
};

function mockWorkType(title: string, diff: string): string {
  const text = `${title} ${diff}`.toLowerCase();
  for (const [type, keywords] of Object.entries(WORK_TYPE_KEYWORDS)) {
    if (keywords.some(k => text.includes(k))) return type;
  }
  return 'feature';
}

function mockSubstance(diff: string): string {
  const lines = diff.split('\\n').filter(l => l.startsWith('+') || l.startsWith('-')).length;
  if (lines >= 50) return 'high';
  if (lines >= 10) return 'medium';
  return 'low';
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
  const gotWt = mockWorkType(row.title, diff);
  const gotSub = mockSubstance(diff);

  if (gotWt === row.expected_work_type) {
    wtCorrect++;
  } else {
    misses.push({ title: row.title, field: 'work_type', expected: row.expected_work_type, got: gotWt });
  }

  if (gotSub === row.expected_substance) {
    subCorrect++;
  } else {
    misses.push({ title: row.title, field: 'substance', expected: row.expected_substance, got: gotSub });
  }
}

const total = rows.length;
const wtAcc  = ((wtCorrect  / total) * 100).toFixed(1);
const subAcc = ((subCorrect / total) * 100).toFixed(1);

console.log('=== Classifier Eval ===');
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
