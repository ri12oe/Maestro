import '../loadEnv.js';
import Database from 'better-sqlite3';
import { runMigration } from './migrate.js';
import { resolveDbPath } from './paths.js';

function createDb(): Database.Database {
  const dbPath = resolveDbPath();
  runMigration(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

// Singleton instance. loadEnv is imported above so DB_PATH is set before this runs.
const db = createDb();

export default db;
