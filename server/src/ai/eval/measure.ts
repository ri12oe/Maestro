/**
 * Score labeled commits with the same classifier the app uses.
 * run.ts prints this. `npm run eval:results` writes the holdout score to results.json.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { classifyOne } from '../classifier.js';
import { accuracyCount, type ConfusionPair, type EvalResults } from './results.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface LabeledCommit {
  title: string;
  diff_summary: string;
  files_changed: string;
  additions: string;
  deletions: string;
  expected_work_type: string;
  expected_substance: string;
}

export interface Miss {
  title: string;
  field: 'work_type' | 'substance';
  expected: string;
  got: string;
}

export interface Score {
  total: number;
  workTypeCorrect: number;
  substanceCorrect: number;
  misses: Miss[];
}

export function parseCsv(content: string): LabeledCommit[] {
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

export function loadLabeledSet(filename: string): LabeledCommit[] {
  return parseCsv(readFileSync(join(__dirname, filename), 'utf8'));
}

export async function scoreLabeledRows(rows: LabeledCommit[]): Promise<Score> {
  let workTypeCorrect = 0;
  let substanceCorrect = 0;
  const misses: Miss[] = [];

  for (const row of rows) {
    const diff = row.diff_summary.replace(/\\n/g, '\n');
    const stats = {
      filesChanged: Number(row.files_changed) || null,
      additions: Number(row.additions) || null,
      deletions: Number(row.deletions) || null,
    };
    const result = await classifyOne(row.title, diff, [], stats);

    if (result.work_type === row.expected_work_type) {
      workTypeCorrect++;
    } else {
      misses.push({ title: row.title, field: 'work_type', expected: row.expected_work_type, got: result.work_type });
    }

    if (result.substance === row.expected_substance) {
      substanceCorrect++;
    } else {
      misses.push({ title: row.title, field: 'substance', expected: row.expected_substance, got: result.substance });
    }
  }

  return { total: rows.length, workTypeCorrect, substanceCorrect, misses };
}

function confusionPairs(misses: Miss[], field: Miss['field']): ConfusionPair[] {
  const counts = new Map<string, ConfusionPair>();
  for (const miss of misses) {
    if (miss.field !== field) continue;
    const key = `${miss.expected}\0${miss.got}`;
    const current = counts.get(key);
    if (current) current.count += 1;
    else counts.set(key, { expected: miss.expected, got: miss.got, count: 1 });
  }
  return [...counts.values()].sort((a, b) =>
    b.count - a.count || a.expected.localeCompare(b.expected) || a.got.localeCompare(b.got));
}

/** Holdout results file. `evaluatedAt` is the run time; counts come from `score`. */
export function buildResultsFile(
  score: Score,
  meta: { provider: string; model: string; evaluatedAt: string },
): EvalResults {
  return {
    provider: meta.provider,
    model: meta.model,
    evaluatedAt: meta.evaluatedAt,
    date: meta.evaluatedAt.slice(0, 10),
    set: 'holdout',
    holdoutSize: score.total,
    workType: accuracyCount(score.workTypeCorrect, score.total),
    substance: accuracyCount(score.substanceCorrect, score.total),
    confusion: {
      workType: confusionPairs(score.misses, 'work_type'),
      substance: confusionPairs(score.misses, 'substance'),
    },
  };
}
