import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Temp directories created for Vitest workers. The name is stable so the
 * global teardown can remove one if a worker is killed before its exit hook.
 */
export const WORKER_DB_PREFIX = 'maestro-vitest-';

interface WorkerDbState {
  dir: string | null;
  seq: number;
  hooked: boolean;
}

const stateKey = '__maestroVitestDb' as const;

type ProcessWithDb = NodeJS.Process & { [stateKey]?: WorkerDbState };

// Stored on the process: Vitest clears this module between test files, so a
// module-level variable would not survive the next setup run.
function state(): WorkerDbState {
  const proc = process as ProcessWithDb;
  if (proc[stateKey] == null) {
    proc[stateKey] = { dir: null, seq: 0, hooked: false };
  }
  const current = proc[stateKey];
  if (!current.hooked) {
    current.hooked = true;
    process.on('exit', () => {
      if (current.dir == null) return;
      try {
        rmSync(current.dir, { recursive: true, force: true });
      } catch {
        // The worker is exiting. The directory lives under the OS temp dir.
      }
    });
  }
  return current;
}

function workerId(): string {
  const id = process.env.VITEST_POOL_ID ?? process.env.VITEST_WORKER_ID;
  if (id != null && id !== '') return id;
  return String(process.pid);
}

/**
 * Set `DB_PATH` to a temp file that belongs to this worker.
 * Call this before any test file imports `db/client.ts`.
 * Each call (once per test file) uses a new file in the worker directory.
 */
export function assignWorkerDbPath(): void {
  const current = state();
  let dir = current.dir;
  if (dir == null) {
    dir = mkdtempSync(join(tmpdir(), `${WORKER_DB_PREFIX}${workerId()}-`));
    current.dir = dir;
  }
  current.seq += 1;
  process.env.DB_PATH = join(dir, `${current.seq}.db`);
}

/** Remove every worker temp directory under the OS temp dir. */
export function removeWorkerDbDirs(): void {
  const root = tmpdir();
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    // Nothing to clean when the temp dir cannot be read.
    return;
  }
  for (const name of names) {
    if (!name.startsWith(WORKER_DB_PREFIX)) continue;
    rmSync(join(root, name), { recursive: true, force: true });
  }
}
