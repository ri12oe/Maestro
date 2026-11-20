import '../loadEnv.js';
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import { resolveDbPath } from './paths.js';

/** Row in demo_seed that means the StudyBuddy demo has finished seeding. */
export const STUDYBUDDY_DEMO_SLUG = 'studybuddy';

/**
 * Teams the old seed inserted: name StudyBuddy, repo studybuddy-org/studybuddy-app,
 * is_demo = 1. Production's copy is team id 3. A real team named StudyBuddy is
 * stored with is_demo = 0 and its own repo. Rows come back lowest id first.
 * When more than one matches, the marker uses the first and a warning is logged.
 */
const EXISTING_DEMO_TEAMS = `
  SELECT id FROM teams
  WHERE name = 'StudyBuddy'
    AND repo_owner = 'studybuddy-org'
    AND repo_name = 'studybuddy-app'
    AND is_demo = 1
  ORDER BY id
`;

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Add a column when this database does not have it yet.
 *
 * schema.sql already declares every column, so a fresh database skips ALTER.
 * An older database gets ALTER TABLE … ADD COLUMN, which leaves existing rows
 * in place (new columns are NULL, or the DEFAULT written here). A duplicate
 * column is ignored so a database that already has the column — because
 * schema.sql created it, or a previous attempt added it — still records the
 * migration.
 */
function addColumnIfMissing(
  db: Database.Database,
  table: string,
  column: string,
  definition: string,
): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (cols.some(c => c.name === column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/duplicate column name/i.test(message)) throw err;
  }
}

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
  // The view references correction columns. On an older database those columns
  // are added below, so the view is applied after the incremental migrations.
  // `-- @view` is a SQL comment, so executing the whole file is still valid
  // once the columns exist (a fresh schema.sql, or this function's last step).
  const viewMark = '\n-- @view\n';
  const viewAt = sql.indexOf(viewMark);
  if (viewAt === -1) throw new Error('schema.sql is missing the effective_classifications view');
  const tableSql = sql.slice(0, viewAt);
  const viewSql = sql.slice(viewAt + viewMark.length);
  const dbDir = dirname(dbPath);
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
    console.warn(
      `Created missing database folder ${dbDir}. If this is a hosted deploy, ` +
        'attach a persistent volume there or the data will be lost on redeploy.',
    );
  }
  const db = new Database(dbPath);

  // Apply base schema (tables). The effective-label view runs after migrations.
  db.exec(tableSql);

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
   * ALTER TABLE … ADD COLUMN leaves existing rows in place. The new columns
   * are NULL. schema.sql already declares them, so a fresh database skips
   * the ALTER.
   */
  if (!appliedSet.has('migration_002_contributions_diff_stats')) {
    db.transaction(() => {
      addColumnIfMissing(db, 'contributions', 'files_changed', 'INTEGER');
      addColumnIfMissing(db, 'contributions', 'additions', 'INTEGER');
      addColumnIfMissing(db, 'contributions', 'deletions', 'INTEGER');
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
      addColumnIfMissing(db, 'contributions', 'paths', 'TEXT');
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
      addColumnIfMissing(db, 'contributions', 'match_checked_task_id', 'INTEGER');
      addColumnIfMissing(db, 'teams', 'last_synced_at', 'TEXT');
      addColumnIfMissing(db, 'teams', 'is_demo', 'INTEGER NOT NULL DEFAULT 0');
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
      addColumnIfMissing(db, 'teams', 'deadline', 'TEXT');
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
      addColumnIfMissing(db, 'teams', 'report_enabled', 'INTEGER NOT NULL DEFAULT 0');
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run('migration_006_teams_report_enabled');
    })();
  }

  /**
   * migration_007: demo_seed done marker, and recognize a StudyBuddy demo the
   * old seed already inserted.
   *
   * schema.sql creates demo_seed. This migration records that the table is in
   * place and, when the old demo team is already in the file, writes the marker
   * for that team. The public database's copy is id 3. Startup finds the marker
   * and leaves that team as the only StudyBuddy demo. The marker is not a
   * foreign key; deleting the team later leaves it set.
   */
  if (!appliedSet.has('migration_007_demo_seed_marker')) {
    let adopted: number | null = null;
    db.transaction(() => {
      adopted = backfillStudyBuddyDemo(db);
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(
        'migration_007_demo_seed_marker',
      );
    })();
    if (adopted != null) {
      console.log(
        `Recognized existing StudyBuddy demo (id=${adopted}). It will not be seeded again.`,
      );
    }
  }

  /**
   * migration_008: keep a human label correction reversible.
   *
   * original_work_type and original_substance store the AI label while a
   * correction is active. corrected_at is the timestamp of that correction.
   * work_type and substance stay the effective label (the correction, or the
   * AI label when corrected_at is NULL). ALTER TABLE … ADD COLUMN leaves
   * existing rows in place; the new columns are NULL, which means "still the
   * AI label". schema.sql already declares them, so a fresh database skips
   * the ALTER.
   */
  if (!appliedSet.has('migration_008_classification_corrections')) {
    db.transaction(() => {
      addColumnIfMissing(
        db,
        'classifications',
        'original_work_type',
        `TEXT CHECK (original_work_type IS NULL OR original_work_type IN ('feature','fix','test','refactor','docs','formatting','generated','design','other'))`,
      );
      addColumnIfMissing(
        db,
        'classifications',
        'original_substance',
        `TEXT CHECK (original_substance IS NULL OR original_substance IN ('low','medium','high'))`,
      );
      addColumnIfMissing(db, 'classifications', 'corrected_at', 'TEXT');
      db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(
        'migration_008_classification_corrections',
      );
    })();
  }

  /**
   * migration_009: a commit sha is unique per team, not across the whole file.
   *
   * The old column constraint `github_sha TEXT UNIQUE` kept a fork, or any
   * shared sha, from storing that commit on a second team. SQLite cannot drop
   * a column UNIQUE, so the table is rebuilt. schema.sql already declares
   * UNIQUE (team_id, github_sha); a fresh file skips the rebuild. NULL shas
   * (manual log rows) stay allowed more than once. Ids are copied, so
   * classifications and task matches keep pointing at the same rows.
   * Running this twice is a no-op: the migration name is recorded, and a
   * database that already has the composite unique is not rebuilt.
   */
  if (!appliedSet.has('migration_009_contribution_sha_per_team')) {
    const defined = db
      .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'contributions'")
      .get() as { sql: string } | undefined;
    const alreadyPerTeam = /UNIQUE\s*\(\s*team_id\s*,\s*github_sha\s*\)/i.test(defined?.sql ?? '');
    if (!alreadyPerTeam) {
      // foreign_keys cannot change inside a transaction. Turn them off so the
      // drop does not fail while classifications still reference this table.
      db.pragma('foreign_keys = OFF');
      try {
        const present = new Set(
          (db.prepare('PRAGMA table_info(contributions)').all() as Array<{ name: string }>).map(col => col.name),
        );
        const copyCols = [
          'id', 'team_id', 'member_id', 'source', 'github_sha', 'github_pr_number',
          'title', 'body', 'kind', 'link', 'diff_summary', 'files_changed', 'additions', 'deletions',
          'paths', 'url', 'embedding', 'authored_at', 'synced_at', 'match_checked_task_id',
        ].filter(name => present.has(name));
        const colList = copyCols.join(', ');
        db.transaction(() => {
          db.exec(`
            CREATE TABLE contributions_new (
              id                INTEGER PRIMARY KEY AUTOINCREMENT,
              team_id           INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              member_id         INTEGER NOT NULL REFERENCES members(id),
              source            TEXT    NOT NULL CHECK (source IN ('commit', 'manual')),
              github_sha        TEXT,
              github_pr_number  INTEGER,
              title             TEXT    NOT NULL,
              body              TEXT,
              kind              TEXT,
              link              TEXT,
              diff_summary      TEXT,
              files_changed     INTEGER,
              additions         INTEGER,
              deletions         INTEGER,
              paths             TEXT,
              url               TEXT,
              embedding         BLOB,
              authored_at       TEXT    NOT NULL,
              synced_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
              match_checked_task_id INTEGER,
              UNIQUE (team_id, github_sha)
            );
            INSERT INTO contributions_new (${colList})
            SELECT ${colList} FROM contributions;
            DROP TABLE contributions;
            ALTER TABLE contributions_new RENAME TO contributions;
          `);
          const sequence = db
            .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'")
            .get();
          if (sequence) {
            db.exec(`
              UPDATE sqlite_sequence
              SET seq = IFNULL((SELECT MAX(id) FROM contributions), 0)
              WHERE name = 'contributions'
            `);
          }
        })();
      } finally {
        db.pragma('foreign_keys = ON');
      }
    }
    db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(
      'migration_009_contribution_sha_per_team',
    );
  }

  // Recreate the view after correction columns exist and the sha migration
  // has finished. DROP is safe when the view is missing.
  db.exec(viewSql);

  db.close();

  console.log(`Migration complete: ${dbPath}`);
}

/**
 * Write the StudyBuddy done marker when the old seed's team is already stored.
 * Returns that team's id, or null when this database has no such team.
 * Creates demo_seed when schema.sql has not run yet. The caller wraps this in
 * a transaction with the migration record, or with nothing else when the seed
 * adopts an existing team before inserting.
 */
export function backfillStudyBuddyDemo(db: Database.Database): number | null {
  db.exec(`
    CREATE TABLE IF NOT EXISTS demo_seed (
      slug       TEXT PRIMARY KEY,
      team_id    INTEGER,
      seeded_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    )
  `);
  const matches = db.prepare(EXISTING_DEMO_TEAMS).all() as Array<{ id: number }>;
  if (matches.length === 0) return null;
  const existing = matches[0];
  if (matches.length > 1) {
    const ids = matches.map(row => row.id).join(', ');
    console.warn(
      `[migrate] ${matches.length} StudyBuddy demo teams match (${ids}). The done marker uses id ${existing.id}.`,
    );
  }
  db.prepare('UPDATE teams SET is_demo = 1 WHERE id = ?').run(existing.id);
  db.prepare(
    `INSERT INTO demo_seed (slug, team_id) VALUES (?, ?)
     ON CONFLICT(slug) DO NOTHING`,
  ).run(STUDYBUDDY_DEMO_SLUG, existing.id);
  return existing.id;
}

// Run directly when invoked as a script
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigration(resolveDbPath());
}
