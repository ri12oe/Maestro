import { isAbsolute, join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const moduleDir = dirname(fileURLToPath(import.meta.url));

/**
 * Repository root.
 * This file lives at server/src/db/paths.ts and, after `tsc`, at server/dist/db/paths.js.
 * Both are three directories below the repo root.
 */
export function repoRoot(): string {
  return join(moduleDir, '..', '..', '..');
}

/** SQLite file used when DB_PATH is unset: `<repo>/dev.db`. */
export function defaultDbPath(): string {
  return join(repoRoot(), 'dev.db');
}

/**
 * Resolve the SQLite file for this process.
 *
 * A relative DB_PATH is resolved from the repo root, so `npm run dev:server`
 * (cwd: server/) and `npm run seed --workspace=server` (cwd: server/) open the
 * same file. An absolute path is returned unchanged, which is what Railway
 * sets (`DB_PATH=/data/maestro.db`).
 */
export function resolveDbPath(dbPath: string | undefined = process.env.DB_PATH): string {
  if (dbPath == null) return defaultDbPath();
  if (isAbsolute(dbPath)) return dbPath;
  return resolve(repoRoot(), dbPath);
}
