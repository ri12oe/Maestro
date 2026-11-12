import Database from 'better-sqlite3';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runMigration } from './migrate.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function createDb(): Database.Database {
  const dbPath = process.env.DB_PATH ?? join(__dirname, '..', '..', '..', 'dev.db');
  runMigration(dbPath);
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

// Singleton instance
const db = createDb();

export default db;
