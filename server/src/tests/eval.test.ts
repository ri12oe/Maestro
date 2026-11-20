/**
 * eval.test.ts — GET /api/eval
 *
 * 200 with the committed holdout results, or 200 { available: false } when
 * that file is missing. A file that is not usable is 500 with a fixed error.
 * The site password gates this path. /api/health stays open.
 *
 * The committed file's counts must match a fresh mock run. The card shows
 * those counts, so a hand-edited number fails this test.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import request from 'supertest';
import { sitePassword } from '../middleware/sitePassword.js';
import { createEvalRouter } from '../routes/eval.js';
import { buildResultsFile, loadLabeledSet, scoreLabeledRows } from '../ai/eval/measure.js';
import { committedResultsPath, parseEvalResults } from '../ai/eval/results.js';
import { modelVersion } from '../ai/classifier.js';

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

  it('matches a fresh mock run of the holdout set', async () => {
    const committed = parseEvalResults(JSON.parse(readFileSync(committedResultsPath(), 'utf8')));
    if (!committed) throw new Error('committed results.json failed to parse');
    expect(committed.provider).toBe('mock');
    expect(committed.model).toBe(modelVersion());

    const rows = loadLabeledSet('holdout.csv');
    const fresh = buildResultsFile(await scoreLabeledRows(rows), {
      provider: 'mock',
      model: modelVersion(),
      evaluatedAt: committed.evaluatedAt,
    });
    expect(committed).toEqual(fresh);
    expect(committed.holdoutSize).toBe(rows.length);
  });
});
