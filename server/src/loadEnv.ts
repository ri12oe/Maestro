import dotenv from 'dotenv';
import { join } from 'path';
import { repoRoot } from './db/paths.js';

/**
 * Load `<repo>/.env` before any entry point opens SQLite.
 * Import this module first. A variable already set on the process is left as-is,
 * so Railway's environment and test fixtures win over the file.
 */
dotenv.config({ path: join(repoRoot(), '.env') });
