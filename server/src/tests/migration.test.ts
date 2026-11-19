import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { runMigration } from '../db/migrate.js';

const EXPECTED_TABLES = [
  'teams',
  'members',
  'tasks',
  'contributions',
  'classifications',
  'task_matches',
  'risks',
  'suggestions',
  'demo_seed',
  'schema_migrations',
];

/** Columns a fresh database has after schema.sql. Migrations add nothing further. */
const EXPECTED_COLUMNS: Record<string, string[]> = {
  teams: [
    'id', 'name', 'repo_owner', 'repo_name', 'created_at',
    'last_synced_at', 'is_demo', 'deadline', 'report_enabled',
  ],
  members: ['id', 'team_id', 'github_login', 'email', 'display_name', 'added_at'],
  tasks: [
    'id', 'team_id', 'github_issue_number', 'title', 'body',
    'assignee_login', 'status', 'due_date', 'embedding', 'synced_at',
  ],
  contributions: [
    'id', 'team_id', 'member_id', 'source', 'github_sha', 'github_pr_number',
    'title', 'body', 'kind', 'link', 'diff_summary', 'files_changed',
    'additions', 'deletions', 'paths', 'url', 'embedding', 'authored_at',
    'synced_at', 'match_checked_task_id',
  ],
  classifications: [
    'id', 'contribution_id', 'work_type', 'substance', 'summary',
    'disputed', 'dispute_note', 'classified_at', 'model_version',
  ],
  task_matches: ['id', 'contribution_id', 'task_id', 'similarity_score', 'matched_at'],
  risks: ['id', 'team_id', 'task_id', 'level', 'description', 'evidence', 'generated_at', 'dismissed'],
  suggestions: [
    'id', 'team_id', 'from_member_id', 'to_member_id', 'task_id',
    'rationale', 'checkin_message', 'status', 'generated_at',
  ],
  schema_migrations: ['id', 'name', 'applied_at'],
  demo_seed: ['slug', 'team_id', 'seeded_at'],
};

const SCHEMA_TABLES = EXPECTED_TABLES.filter(name => name !== 'schema_migrations');

type ColumnInfo = {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
};

function tableInfo(db: Database.Database, table: string): ColumnInfo[] {
  return db.prepare(`PRAGMA table_info(${table})`).all() as ColumnInfo[];
}

function columnSnapshot(db: Database.Database): Record<string, ColumnInfo[]> {
  const snapshot: Record<string, ColumnInfo[]> = {};
  for (const table of EXPECTED_TABLES) snapshot[table] = tableInfo(db, table);
  return snapshot;
}

let tmpDir: string;
let dbPath: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'referee-test-'));
  dbPath = join(tmpDir, 'test.db');
  runMigration(dbPath);
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('migration', () => {
  it('creates all expected tables', () => {
    const db = new Database(dbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    db.close();

    const tableNames = tables.map(t => t.name);
    for (const expected of EXPECTED_TABLES) {
      expect(tableNames).toContain(expected);
    }
  });

  it('is idempotent — running migration twice does not throw or change columns', () => {
    const before = new Database(dbPath);
    const migrationsBefore = before.prepare('SELECT name FROM schema_migrations ORDER BY id').all();
    const columnsBefore = columnSnapshot(before);
    before.close();

    expect(() => runMigration(dbPath)).not.toThrow();

    const after = new Database(dbPath);
    expect(after.prepare('SELECT name FROM schema_migrations ORDER BY id').all()).toEqual(migrationsBefore);
    expect(columnSnapshot(after)).toEqual(columnsBefore);
    after.close();
  });

  it('has the same columns as schema.sql, including paths and match_checked_task_id', () => {
    const migrated = new Database(dbPath);
    for (const [table, names] of Object.entries(EXPECTED_COLUMNS)) {
      expect(tableInfo(migrated, table).map(col => col.name)).toEqual(names);
    }

    const contributions = tableInfo(migrated, 'contributions');
    expect(contributions.find(col => col.name === 'paths')).toMatchObject({
      type: 'TEXT', notnull: 0, dflt_value: null,
    });
    expect(contributions.find(col => col.name === 'match_checked_task_id')).toMatchObject({
      type: 'INTEGER', notnull: 0, dflt_value: null,
    });

    // schema.sql alone (no incremental migrations) declares the same columns.
    const schemaOnlyPath = join(tmpDir, 'schema-only.db');
    const schemaOnly = new Database(schemaOnlyPath);
    const schemaSql = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'schema.sql'),
      'utf-8',
    );
    schemaOnly.exec(schemaSql);
    for (const table of SCHEMA_TABLES) {
      expect(tableInfo(schemaOnly, table)).toEqual(tableInfo(migrated, table));
    }
    schemaOnly.close();
    migrated.close();
  });

  it('adds later columns to an existing database and keeps its rows', () => {
    const legacyPath = join(tmpDir, 'legacy.db');
    const legacy = new Database(legacyPath);
    legacy.exec(`
      CREATE TABLE teams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        repo_owner TEXT NOT NULL,
        repo_name TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO teams (name, repo_owner, repo_name, created_at)
      VALUES ('Kept', 'acme', 'app', '2026-01-01T00:00:00Z');

      CREATE TABLE contributions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id INTEGER NOT NULL,
        member_id INTEGER NOT NULL,
        source TEXT NOT NULL,
        github_sha TEXT,
        title TEXT NOT NULL,
        authored_at TEXT NOT NULL,
        synced_at TEXT NOT NULL
      );
      INSERT INTO contributions (team_id, member_id, source, github_sha, title, authored_at, synced_at)
      VALUES (1, 1, 'commit', 'abc', 'kept commit', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z');
    `);
    legacy.close();

    expect(() => runMigration(legacyPath)).not.toThrow();

    const migrated = new Database(legacyPath);
    const teamCols = tableInfo(migrated, 'teams').map(col => col.name);
    expect(teamCols).toEqual(expect.arrayContaining([
      'last_synced_at', 'is_demo', 'deadline', 'report_enabled',
    ]));
    expect(migrated.prepare(
      'SELECT name, repo_owner, created_at, last_synced_at, is_demo, deadline, report_enabled FROM teams',
    ).get()).toEqual({
      name: 'Kept',
      repo_owner: 'acme',
      created_at: '2026-01-01T00:00:00Z',
      last_synced_at: null,
      is_demo: 0,
      deadline: null,
      report_enabled: 0,
    });

    const contributionCols = tableInfo(migrated, 'contributions').map(col => col.name);
    expect(contributionCols).toEqual(expect.arrayContaining([
      'files_changed', 'additions', 'deletions', 'paths', 'match_checked_task_id',
    ]));
    expect(migrated.prepare(
      'SELECT title, github_sha, paths, match_checked_task_id, files_changed FROM contributions',
    ).get()).toEqual({
      title: 'kept commit',
      github_sha: 'abc',
      paths: null,
      match_checked_task_id: null,
      files_changed: null,
    });

    const recorded = migrated.prepare('SELECT name FROM schema_migrations ORDER BY id').all();
    migrated.close();

    expect(() => runMigration(legacyPath)).not.toThrow();

    const again = new Database(legacyPath);
    expect(again.prepare('SELECT name FROM schema_migrations ORDER BY id').all()).toEqual(recorded);
    expect(again.prepare('SELECT title, paths, match_checked_task_id FROM contributions').get()).toEqual({
      title: 'kept commit',
      paths: null,
      match_checked_task_id: null,
    });
    again.close();
  });

  it('enforces tasks.status CHECK constraint', () => {
    const db = new Database(dbPath);
    // Insert a valid team first
    db.prepare("INSERT INTO teams (name, repo_owner, repo_name) VALUES ('T', 'o', 'r')").run();
    const teamId = (db.prepare('SELECT id FROM teams ORDER BY id DESC LIMIT 1').get() as { id: number }).id;

    expect(() => {
      db.prepare(
        "INSERT INTO tasks (team_id, github_issue_number, title, status) VALUES (?, 1, 'T', 'invalid')",
      ).run(teamId);
    }).toThrow();

    db.close();
  });

  it('enforces contributions.source CHECK constraint', () => {
    const db = new Database(dbPath);
    const teamId = (db.prepare('SELECT id FROM teams ORDER BY id DESC LIMIT 1').get() as { id: number }).id;
    // Need a member first
    db.prepare("INSERT INTO members (team_id, github_login) VALUES (?, 'u')").run(teamId);
    const memberId = (db.prepare('SELECT id FROM members ORDER BY id DESC LIMIT 1').get() as { id: number }).id;

    expect(() => {
      db.prepare(
        "INSERT INTO contributions (team_id, member_id, source, title, authored_at) VALUES (?, ?, 'pr', 'x', '2024-01-01T00:00:00Z')",
      ).run(teamId, memberId);
    }).toThrow();

    db.close();
  });

  it('classifications.work_type accepts design and other', () => {
    const db = new Database(dbPath);
    const teamId = (db.prepare('SELECT id FROM teams ORDER BY id DESC LIMIT 1').get() as { id: number }).id;
    const memberId = (db.prepare('SELECT id FROM members ORDER BY id DESC LIMIT 1').get() as { id: number }).id;

    // Insert a manual contribution so we can classify it
    const contribId = db.prepare(
      "INSERT INTO contributions (team_id, member_id, source, title, authored_at) VALUES (?, ?, 'manual', 'design session', '2024-01-01T00:00:00Z')",
    ).run(teamId, memberId).lastInsertRowid;

    expect(() => {
      db.prepare(
        "INSERT INTO classifications (contribution_id, work_type, substance, summary, model_version) VALUES (?, 'design', 'medium', 'design work', 'mock')",
      ).run(contribId);
    }).not.toThrow();

    const contribId2 = db.prepare(
      "INSERT INTO contributions (team_id, member_id, source, title, authored_at) VALUES (?, ?, 'manual', 'other work', '2024-01-01T00:00:00Z')",
    ).run(teamId, memberId).lastInsertRowid;

    expect(() => {
      db.prepare(
        "INSERT INTO classifications (contribution_id, work_type, substance, summary, model_version) VALUES (?, 'other', 'medium', 'other work', 'mock')",
      ).run(contribId2);
    }).not.toThrow();

    db.close();
  });
});
