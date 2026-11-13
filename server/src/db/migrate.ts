import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Run the schema migration against the given database file.
 *
 * The base migration applies schema.sql (idempotent via CREATE TABLE IF NOT EXISTS).
 * Additional incremental migrations are applied in order and tracked in a
 * schema_migrations table so they run only once per database.
 */
export function runMigration(dbPath: string): void {
  const schemaPath = join(__dirname, 'schema.sql');
  const sql = readFileSync(schemaPath, 'utf-8');
  const db = new Database(dbPath);

  // Apply base schema
  db.exec(sql);

  // ── Incremental migrations ────────────────────────────────────────────────
  // Track which migrations have been applied
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id    INTEGER PRIMARY KEY AUTOINCREMENT,
      name  TEXT NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);

  const applied = db
    .prepare('SELECT name FROM schema_migrations')
    .all() as Array<{ name: string }>;
  const appliedSet = new Set(applied.map(r => r.name));

  /**
   * migration_001: Add 'design' and 'other' to classifications.work_type CHECK constraint.
   *
   * SQLite does not support ALTER TABLE … DROP CONSTRAINT, so we recreate the
   * table.  The recreation is wrapped in a transaction so it is atomic.
   * This migration is safe on databases that already have rows — data is
   * copied before the old table is dropped.
   */
  if (!appliedSet.has('migration_001_work_type_design_other')) {
    db.transaction(() => {
      // Check whether the constraint already includes 'design' by inspecting
      // the CREATE TABLE statement stored in sqlite_master.
      const row = db
        .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='classifications'")
        .get() as { sql: string } | undefined;

      const alreadyNew = row?.sql?.includes("'design'") ?? false;

      if (!alreadyNew) {
        db.exec(`
          -- Recreate classifications with the extended work_type constraint
          ALTER TABLE classifications RENAME TO classifications_old;

          CREATE TABLE classifications (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            contribution_id  INTEGER NOT NULL UNIQUE REFERENCES contributions(id) ON DELETE CASCADE,
            work_type        TEXT    NOT NULL CHECK (work_type IN ('feature','fix','test','refactor','docs','formatting','generated','design','other')),
            substance        TEXT    NOT NULL CHECK (substance IN ('low','medium','high')),
            summary          TEXT    NOT NULL,
            disputed         INTEGER NOT NULL DEFAULT 0 CHECK (disputed IN (0, 1)),
            dispute_note     TEXT,
            classified_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
            model_version    TEXT
          );

          INSERT INTO classifications SELECT * FROM classifications_old;

          DROP TABLE classifications_old;
        `);
      }

      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(
        'migration_001_work_type_design_other',
      );
    })();
  }

  db.close();

  console.log(`Migration complete: ${dbPath}`);
}

// Run directly when invoked as a script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const dbPath = process.env.DB_PATH ?? join(__dirname, '..', '..', '..', 'dev.db');
  runMigration(dbPath);
}
