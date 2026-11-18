import { removeWorkerDbDirs } from './workerDb.js';

/**
 * Runs in the Vitest main process after every worker has finished.
 * Workers also delete their own directory on exit. This catches a worker
 * that was killed before that hook ran.
 */
export function teardown(): void {
  removeWorkerDbDirs();
}
