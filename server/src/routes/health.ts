/**
 * GET /api/health
 *
 * Liveness probe. Runs `SELECT 1` and answers `{ ok: true }`.
 * A thrown query answers 503 `{ ok: false, error }` with a fixed message,
 * so the body never includes the database path, environment values, or secrets.
 * The site-password middleware lets this exact path through with no credentials.
 */

import { Router } from 'express';
import type { Database } from 'better-sqlite3';
import db from '../db/client.js';

type HealthDb = Pick<Database, 'prepare'>;

export function createHealthRouter(database: HealthDb = db): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    try {
      database.prepare('SELECT 1').get();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false, error: 'Database check failed' });
    }
  });

  return router;
}

export default createHealthRouter();
