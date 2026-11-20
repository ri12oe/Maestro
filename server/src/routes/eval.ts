/**
 * GET /api/eval
 *
 * The classifier's measured accuracy on the hand-labeled holdout.
 * 200 with the committed results, or 200 { available: false } when that
 * file has not been written. A file that is not usable is 500 with a fixed
 * error, so the body never includes a path or a partial number.
 * Same site-password gate as the other API routes. /api/health stays the
 * only path that skips it.
 */

import { Router } from 'express';
import { committedResultsPath, readEvalResults } from '../ai/eval/results.js';

export function createEvalRouter(resultsPath = committedResultsPath()): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const read = readEvalResults(resultsPath);
    if (!read.ok) {
      res.status(500).json({ error: 'Eval results could not be read.' });
      return;
    }
    if (!read.results) {
      res.json({ available: false });
      return;
    }
    res.json({ available: true, ...read.results });
  });

  return router;
}

export default createEvalRouter();
