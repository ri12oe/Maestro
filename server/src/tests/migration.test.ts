import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
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
];

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

  it('is idempotent — running migration twice does not throw', () => {
    expect(() => runMigration(dbPath)).not.toThrow();
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
});
