import '../loadEnv.js';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { resolveDbPath } from './paths.js';

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
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
    console.warn(
      `Created missing database folder ${dbDir}. If this is a hosted deploy, ` +
        'attach a persistent volume there or the data will be lost on redeploy.',
    );
  }
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

  /**
   * migration_002: Add files_changed, additions, deletions to contributions.
   *
   * ALTER TABLE … ADD COLUMN is safe on SQLite — the new columns default to NULL
   * and do not rewrite existing rows.  We run each statement separately and
   * ignore "duplicate column" errors so the migration is idempotent.
   */
  if (!appliedSet.has('migration_002_contributions_diff_stats')) {
    db.transaction(() => {
      for (const col of [
        'ALTER TABLE contributions ADD COLUMN files_changed INTEGER',
        'ALTER TABLE contributions ADD COLUMN additions INTEGER',
        'ALTER TABLE contributions ADD COLUMN deletions INTEGER',
      ]) {
        try { db.exec(col); } catch { /* column already exists — idempotent */ }
      }
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(
        'migration_002_contributions_diff_stats',
      );
    })();
  }

  /**
   * migration_003: Add `paths` JSON column to contributions.
   *
   * Stores the array of file paths changed by a commit, as a JSON string.
   * NULL for manual entries or commits fetched before this migration.
   */
  if (!appliedSet.has('migration_003_contributions_paths')) {
    db.transaction(() => {
      try {
        db.exec('ALTER TABLE contributions ADD COLUMN paths TEXT');
      } catch { /* column already exists — idempotent */ }
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(
        'migration_003_contributions_paths',
      );
    })();
  }

  /**
   * migration_004: re-linking commits to Issues created later, and sync status.
   *  - contributions.match_checked_task_id: highest task id this commit has been
   *    checked against, so new Issues can be matched against older commits.
   *  - teams.last_synced_at / teams.is_demo: shown on the overview.
   */
  if (!appliedSet.has('migration_004_rematch_and_sync_status')) {
    db.transaction(() => {
      for (const col of [
        'ALTER TABLE contributions ADD COLUMN match_checked_task_id INTEGER',
        'ALTER TABLE teams ADD COLUMN last_synced_at TEXT',
        'ALTER TABLE teams ADD COLUMN is_demo INTEGER NOT NULL DEFAULT 0',
      ]) {
        try { db.exec(col); } catch { /* column already exists — idempotent */ }
      }
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run('migration_004_rematch_and_sync_status');
    })();
  }

  /**
   * migration_005: teams.deadline — a YYYY-MM-DD date the team sets.
   *
   * Null means "keep using GitHub milestone due dates". ALTER TABLE … ADD COLUMN
   * leaves existing rows in place; the new column is NULL on those rows.
   */
  if (!appliedSet.has('migration_005_teams_deadline')) {
    db.transaction(() => {
      try {
        db.exec('ALTER TABLE teams ADD COLUMN deadline TEXT');
      } catch { /* column already exists — idempotent */ }
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run('migration_005_teams_deadline');
    })();
  }

  /**
   * migration_006: teams.report_enabled — the team's opt-in for the project report.
   *
   * One team-wide setting; 0 (off) on existing rows.
   */
  if (!appliedSet.has('migration_006_teams_report_enabled')) {
    db.transaction(() => {
      try {
        db.exec('ALTER TABLE teams ADD COLUMN report_enabled INTEGER NOT NULL DEFAULT 0');
      } catch { /* column already exists — idempotent */ }
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run('migration_006_teams_report_enabled');
    })();
  }

  db.close();

  console.log(`Migration complete: ${dbPath}`);
}

// Run directly when invoked as a script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigration(resolveDbPath());
}
