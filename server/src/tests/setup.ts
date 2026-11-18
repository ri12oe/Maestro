import { assignWorkerDbPath } from './workerDb.js';

/**
 * Runs in the Vitest worker before the test file is imported.
 *
 * `db/client.ts` opens `DB_PATH` and migrates it at import. Parallel test files
 * were doing that to the shared `<repo>/dev.db` and hitting
 * `SqliteError: database is locked`. `assignWorkerDbPath` points this file at
 * its own temp database first. `loadEnv.ts` does not override a path already
 * set, and `client.ts` is unchanged.
 */
assignWorkerDbPath();
