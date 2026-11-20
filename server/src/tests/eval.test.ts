/**
 * eval.test.ts — GET /api/eval
 *
 * 200 with the committed holdout results, or 200 { available: false } when
 * that file is missing. A file that is not usable is 500 with a fixed error.
 * The site password gates this path. /api/health stays open.
 *
 * A mock results file is re-scored against holdout.csv. That check uses a
 * fixture, so it still runs when the committed file is a Grok run. The
 * committed file is re-scored only when its provider is mock. A Grok file
 * must parse, its counts must agree with correct/total and the holdout row
 * count, and each listed miss must be a real holdout row.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';
import express from 'express';
import request from 'supertest';
import { sitePassword } from '../middleware/sitePassword.js';
import { createEvalRouter } from '../routes/eval.js';
import { buildResultsFile, loadLabeledSet, scoreLabeledRows, type LabeledCommit } from '../ai/eval/measure.js';
import { accuracyPercent, committedResultsPath, parseEvalResults, type AccuracyCount, type ConfusionPair, type EvalResults } from '../ai/eval/results.js';
import { modelVersion } from '../ai/classifier.js';

const mockFixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'mock-holdout-results.json');

process.env.AI_PROVIDER = 'mock';

const tmpDir = mkdtempSync(join(tmpdir(), 'eval-'));

function appAt(resultsPath: string, password?: string) {
  const app = express();
  app.use(sitePassword(password));
  app.use(express.json());
  app.use('/api/eval', createEvalRouter(resultsPath));
  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  return app;
}

const basic = (user: string, password: string) =>
  'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

const usable = {
  provider: 'mock',
  model: 'mock:prompt-v2',
  evaluatedAt: '2026-11-20T14:23:17.306Z',
  date: '2026-11-20',
  set: 'holdout',
  holdoutSize: 2,
  workType: { correct: 1, total: 2, accuracy: 50 },
  substance: { correct: 2, total: 2, accuracy: 100 },
  confusion: {
    workType: [{ expected: 'fix', got: 'feature', count: 1 }],
    substance: [],
  },
};

afterAll(() => {
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
});

describe('GET /api/eval', () => {
  it('returns 401 when the site password is set and no credentials are sent', async () => {
    const app = appAt(join(tmpDir, 'none.json'), 's3cret');
    const res = await request(app).get('/api/eval');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/Basic/);
    expect((await request(app).get('/api/health')).status).toBe(200);
  });

  it('returns the recorded results when the password matches', async () => {
    const path = join(tmpDir, 'ok.json');
    writeFileSync(path, `${JSON.stringify(usable)}\n`);
    const res = await request(appAt(path, 's3cret'))
      .get('/api/eval')
      .set('Authorization', basic('maestro', 's3cret'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true, ...usable });
  });

  it('returns 200 { available: false } when the results file is missing', async () => {
    const res = await request(appAt(join(tmpDir, 'missing.json'))).get('/api/eval');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual({ available: false });
    expect(res.text).not.toContain(tmpDir);
  });

  it('returns 500 when the results file is not usable', async () => {
    const bad = join(tmpDir, 'bad.json');
    writeFileSync(bad, '{ "provider": "mock", "accuracy": 99 }');
    const mismatched = await request(appAt(bad)).get('/api/eval');
    expect(mismatched.status).toBe(500);
    expect(mismatched.body).toEqual({ error: 'Eval results could not be read.' });
    expect(mismatched.text).not.toContain(tmpDir);
    expect(mismatched.text).not.toContain('99');

    const broken = join(tmpDir, 'broken.json');
    writeFileSync(broken, 'not json');
    const invalid = await request(appAt(broken)).get('/api/eval');
    expect(invalid.status).toBe(500);
    expect(invalid.body).toEqual({ error: 'Eval results could not be read.' });
    expect(invalid.text).not.toContain(tmpDir);
  });

  it('serves the committed results file', async () => {
    const parsed = parseEvalResults(JSON.parse(readFileSync(committedResultsPath(), 'utf8')));
    expect(parsed).not.toBeNull();
    const res = await request(appAt(committedResultsPath())).get('/api/eval');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ available: true, ...parsed });
  });

  it('matches a fresh mock run of the holdout fixture', async () => {
    const fixture = readResults(mockFixturePath);
    expect(fixture.provider).toBe('mock');
    await expectFreshMock(fixture);
  });

  it('re-scores the committed file only when its provider is mock', async () => {
    const committed = readResults(committedResultsPath());
    const rows = loadLabeledSet('holdout.csv');
    if (committed.provider === 'mock') {
      await expectFreshMock(committed);
      return;
    }
    expect(committed.provider).toBe('grok');
    expectGrokCounts(committed, rows);
  });

  it('rejects a listed miss that is not a holdout row', () => {
    const rows = loadLabeledSet('holdout.csv');
    const problem = missProblem(
      [{ expected: 'not-a-label', got: 'feature', count: 1 }],
      rows.map(row => row.expected_work_type),
      9,
      rows.length,
    );
    expect(problem).toMatch(/holdout/);
  });
});

function readResults(path: string): EvalResults {
  const parsed = parseEvalResults(JSON.parse(readFileSync(path, 'utf8')));
  if (!parsed) throw new Error(`${path} failed to parse`);
  return parsed;
}

async function expectFreshMock(recorded: EvalResults): Promise<void> {
  expect(recorded.provider).toBe('mock');
  expect(recorded.model).toBe(modelVersion());
  const rows = loadLabeledSet('holdout.csv');
  const fresh = buildResultsFile(await scoreLabeledRows(rows), {
    provider: 'mock',
    model: modelVersion(),
    evaluatedAt: recorded.evaluatedAt,
  });
  expect(recorded).toEqual(fresh);
  expect(recorded.holdoutSize).toBe(rows.length);
}

function expectGrokCounts(recorded: EvalResults, rows: LabeledCommit[]): void {
  expect(recorded.holdoutSize).toBe(rows.length);
  expectCountAgrees(recorded.workType, rows.length);
  expectCountAgrees(recorded.substance, rows.length);
  expect(missProblem(
    recorded.confusion.workType,
    rows.map(row => row.expected_work_type),
    recorded.workType.correct,
    recorded.workType.total,
  )).toBeNull();
  expect(missProblem(
    recorded.confusion.substance,
    rows.map(row => row.expected_substance),
    recorded.substance.correct,
    recorded.substance.total,
  )).toBeNull();
}

function expectCountAgrees(count: AccuracyCount, holdoutSize: number): void {
  expect(count.total).toBe(holdoutSize);
  expect(count.correct).toBeGreaterThanOrEqual(0);
  expect(count.correct).toBeLessThanOrEqual(count.total);
  expect(count.accuracy).toBe(Number(accuracyPercent(count.correct, count.total)));
  expect(count.accuracy).toBe(Number(((count.correct / count.total) * 100).toFixed(1)));
}

/**
 * Confusion pairs are the misses the results file lists.
 * Each expected label has to be the expected label of that many holdout rows,
 * and the listed counts have to add up to total - correct.
 */
function missProblem(
  pairs: ConfusionPair[],
  labels: string[],
  correct: number,
  total: number,
): string | null {
  const listed = pairs.reduce((sum, pair) => sum + pair.count, 0);
  if (listed !== total - correct) return `listed ${listed} misses, expected ${total - correct}`;
  const remaining = new Map<string, number>();
  for (const label of labels) remaining.set(label, (remaining.get(label) ?? 0) + 1);
  for (const pair of pairs) {
    const available = remaining.get(pair.expected) ?? 0;
    if (pair.count > available) {
      return `"${pair.expected}" is not the expected label of ${pair.count} holdout row(s)`;
    }
    remaining.set(pair.expected, available - pair.count);
  }
  return null;
}
