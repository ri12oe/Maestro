/**
 * Shape of server/src/ai/eval/results.json.
 *
 * The file is the output of one real holdout run (`npm run eval:results`).
 * GET /api/eval serves it. The card shows these figures and the provider
 * that produced them. It does not recompute them.
 */

import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

export interface ConfusionPair {
  expected: string;
  got: string;
  count: number;
}

export interface AccuracyCount {
  correct: number;
  total: number;
  /** One decimal, the same rounding the eval script prints. */
  accuracy: number;
}

/** One holdout row the classifier labeled wrong. `field` selects work type or substance. */
export interface RecordedMiss {
  field: 'workType' | 'substance';
  title: string;
  expected: string;
  got: string;
}

export interface EvalResults {
  provider: string;
  model: string;
  /** ISO-8601 timestamp of the run. */
  evaluatedAt: string;
  /** UTC calendar day of `evaluatedAt`, YYYY-MM-DD. */
  date: string;
  set: 'holdout';
  holdoutSize: number;
  workType: AccuracyCount;
  substance: AccuracyCount;
  confusion: {
    workType: ConfusionPair[];
    substance: ConfusionPair[];
  };
  misses: RecordedMiss[];
}

/** Percent string the eval script prints, e.g. "80.0". */
export function accuracyPercent(correct: number, total: number): string {
  return ((correct / total) * 100).toFixed(1);
}

export function accuracyCount(correct: number, total: number): AccuracyCount {
  return { correct, total, accuracy: Number(accuracyPercent(correct, total)) };
}

/** results.json beside this module. Dev reads src/; production reads the postbuild copy in dist/. */
export function committedResultsPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), 'results.json');
}

function isPair(value: unknown): value is ConfusionPair {
  if (!value || typeof value !== 'object') return false;
  const pair = value as Record<string, unknown>;
  return typeof pair.expected === 'string' && pair.expected.length > 0
    && typeof pair.got === 'string' && pair.got.length > 0
    && Number.isInteger(pair.count) && (pair.count as number) > 0;
}

function isCount(value: unknown, total: number): value is AccuracyCount {
  if (!value || typeof value !== 'object') return false;
  const count = value as Record<string, unknown>;
  if (count.total !== total) return false;
  if (!Number.isInteger(count.correct)) return false;
  const correct = count.correct as number;
  if (correct < 0 || correct > total) return false;
  return count.accuracy === Number(accuracyPercent(correct, total));
}

function isPairList(value: unknown): value is ConfusionPair[] {
  return Array.isArray(value) && value.every(isPair);
}

function isMiss(value: unknown): value is RecordedMiss {
  if (!value || typeof value !== 'object') return false;
  const miss = value as Record<string, unknown>;
  return (miss.field === 'workType' || miss.field === 'substance')
    && typeof miss.title === 'string' && miss.title.length > 0
    && typeof miss.expected === 'string' && miss.expected.length > 0
    && typeof miss.got === 'string' && miss.got.length > 0;
}

function isMissList(value: unknown): value is RecordedMiss[] {
  return Array.isArray(value) && value.every(isMiss);
}

/** Accept only a holdout file whose percentages match its counts. */
export function parseEvalResults(value: unknown): EvalResults | null {
  if (!value || typeof value !== 'object') return null;
  const row = value as Record<string, unknown>;
  if (typeof row.provider !== 'string' || row.provider.length === 0) return null;
  if (typeof row.model !== 'string' || row.model.length === 0) return null;
  if (typeof row.evaluatedAt !== 'string' || Number.isNaN(Date.parse(row.evaluatedAt))) return null;
  if (typeof row.date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return null;
  if (row.date !== row.evaluatedAt.slice(0, 10)) return null;
  if (row.set !== 'holdout') return null;
  if (!Number.isInteger(row.holdoutSize) || (row.holdoutSize as number) < 1) return null;
  const total = row.holdoutSize as number;
  if (!isCount(row.workType, total) || !isCount(row.substance, total)) return null;
  if (!row.confusion || typeof row.confusion !== 'object') return null;
  const confusion = row.confusion as Record<string, unknown>;
  if (!isPairList(confusion.workType) || !isPairList(confusion.substance)) return null;
  if (!isMissList(row.misses)) return null;
  return row as unknown as EvalResults;
}

export function readEvalResults(path: string): { ok: true; results: EvalResults | null } | { ok: false } {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return { ok: true, results: null };
    return { ok: false };
  }
  try {
    const parsed = parseEvalResults(JSON.parse(raw));
    if (!parsed) return { ok: false };
    return { ok: true, results: parsed };
  } catch {
    return { ok: false };
  }
}
