/**
 * team-deadline.test.ts — a team can store its own deadline.
 *
 * PATCH /api/teams/:teamId with { deadline: 'YYYY-MM-DD' | null } sets or clears it.
 * GET reads it back. A stored date wins over each task's GitHub milestone due date
 * in stalled-task risk. With no stored date, the milestone date is used as before.
 * migration_005 adds teams.deadline to a database that does not have the column.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';

const tmpDir = mkdtempSync(join(tmpdir(), 'team-deadline-'));
process.env.DB_PATH = join(tmpDir, 'test.db');
process.env.AI_PROVIDER = 'mock';

const { default: db } = await import('../db/client.js');
const { default: teamsRouter } = await import('../routes/teams.js');
const { runReasoner } = await import('../ai/reasoner.js');
const { runMigration } = await import('../db/migrate.js');

const app = express();
app.use(express.json());
app.use('/api/teams', teamsRouter);

const TODAY = new Date('2026-11-13T12:00:00Z');
const SOON = '2026-11-16';   // 2.5 days from TODAY → high
const MEDIUM = '2026-11-24'; // 10.5 days from TODAY → medium
const FAR = '2026-12-20';    // well past 14 days → not a risk

function patchDeadline(teamId: number | string, deadline: unknown) {
  return request(app).patch(`/api/teams/${teamId}`).send({ deadline });
}

afterAll(() => {
  db.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
});

describe('PATCH /api/teams/:teamId deadline', () => {
  const teamId = db.prepare(
    "INSERT INTO teams (name, repo_owner, repo_name) VALUES ('Alpha', 'acme', 'app')",
  ).run().lastInsertRowid as number;

  it('sets a deadline, reads it back, and clears it', async () => {
    const created = await request(app)
      .post('/api/teams')
      .send({ name: 'Alpha', repo_owner: 'acme', repo_name: 'app' });
    expect(created.status).toBe(201);
    expect(created.body.deadline).toBeNull();
    const teamId = created.body.id as number;

    const set = await patchDeadline(teamId, '2026-12-01');
    expect(set.status).toBe(200);
    expect(set.body.deadline).toBe('2026-12-01');
    expect(set.body.name).toBe('Alpha');

    const read = await request(app).get(`/api/teams/${teamId}`);
    expect(read.status).toBe(200);
    expect(read.body.deadline).toBe('2026-12-01');

    const cleared = await patchDeadline(teamId, null);
    expect(cleared.status).toBe(200);
    expect(cleared.body.deadline).toBeNull();

    const after = await request(app).get(`/api/teams/${teamId}`);
    expect(after.body.deadline).toBeNull();
  });

  it.each([
    '2026-13-01',
    '2026-02-30',
    '2026-11-31',
    '11/14/2026',
    '2026-1-1',
    '2026-12-01T00:00:00Z',
    '',
    'not-a-date',
  ])('rejects %j with 400', async (deadline) => {
    const res = await patchDeadline(teamId, deadline);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/YYYY-MM-DD or null/);
    const row = db.prepare('SELECT deadline FROM teams WHERE id = ?').get(teamId) as { deadline: string | null };
    expect(row.deadline).toBeNull();
  });

  it('rejects a missing deadline and a non-date value with 400', async () => {
    const missing = await request(app).patch(`/api/teams/${teamId}`).send({});
    expect(missing.status).toBe(400);

    const number = await patchDeadline(teamId, 20261201);
    expect(number.status).toBe(400);

    const row = db.prepare('SELECT deadline FROM teams WHERE id = ?').get(teamId) as { deadline: string | null };
    expect(row.deadline).toBeNull();
  });

  it('returns 404 for an unknown team', async () => {
    const res = await patchDeadline(999999, '2026-12-01');
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Team not found');
  });
});

describe('stored deadline overrides the milestone date', () => {
  const teamId = db.prepare(
    "INSERT INTO teams (name, repo_owner, repo_name) VALUES ('Risk', 'acme', 'risk')",
  ).run().lastInsertRowid as number;

  function addTask(num: number, title: string, due: string | null): number {
    return db.prepare(
      "INSERT INTO tasks (team_id, github_issue_number, title, status, due_date) VALUES (?, ?, ?, 'open', ?)",
    ).run(teamId, num, title, due).lastInsertRowid as number;
  }

  const soonMilestone = addTask(1, 'Milestone soon', SOON);
  const farMilestone = addTask(2, 'Milestone later', FAR);
  const noMilestone = addTask(3, 'No milestone', null);

  function level(taskId: number): string | undefined {
    return (db.prepare(
      'SELECT level FROM risks WHERE team_id = ? AND task_id = ? AND dismissed = 0',
    ).get(teamId, taskId) as { level: string } | undefined)?.level;
  }

  async function levels() {
    await runReasoner(teamId, TODAY);
    return { soon: level(soonMilestone), far: level(farMilestone), none: level(noMilestone) };
  }

  it('uses the milestone date until a team deadline is set, then the stored date, including after it is cleared', async () => {
    expect(await levels()).toEqual({ soon: 'high', far: undefined, none: 'low' });

    expect((await patchDeadline(teamId, SOON)).status).toBe(200);
    expect(await levels()).toEqual({ soon: 'high', far: 'high', none: 'high' });

    expect((await patchDeadline(teamId, MEDIUM)).status).toBe(200);
    expect(await levels()).toEqual({ soon: 'medium', far: 'medium', none: 'medium' });

    expect((await patchDeadline(teamId, FAR)).status).toBe(200);
    expect(await levels()).toEqual({ soon: undefined, far: undefined, none: undefined });

    // The milestone dates stay on the tasks. The override is only at read time.
    const dues = db.prepare(
      'SELECT github_issue_number, due_date FROM tasks WHERE team_id = ? ORDER BY github_issue_number',
    ).all(teamId);
    expect(dues).toEqual([
      { github_issue_number: 1, due_date: SOON },
      { github_issue_number: 2, due_date: FAR },
      { github_issue_number: 3, due_date: null },
    ]);

    expect((await patchDeadline(teamId, null)).status).toBe(200);
    expect(await levels()).toEqual({ soon: 'high', far: undefined, none: 'low' });
  });
});

describe('migration_005 on an existing database', () => {
  it('adds deadline without dropping rows that predate the column', () => {
    const dir = mkdtempSync(join(tmpdir(), 'team-deadline-old-'));
    const oldPath = join(dir, 'old.db');
    const old = new Database(oldPath);
    old.exec(`
      CREATE TABLE teams (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        name           TEXT NOT NULL,
        repo_owner     TEXT NOT NULL,
        repo_name      TEXT NOT NULL,
        created_at     TEXT NOT NULL,
        last_synced_at TEXT,
        is_demo        INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO teams (name, repo_owner, repo_name, created_at, last_synced_at, is_demo)
      VALUES ('Kept', 'acme', 'app', '2026-11-01T00:00:00Z', '2026-11-12T00:00:00Z', 1);

      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        team_id INTEGER NOT NULL,
        github_issue_number INTEGER,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        due_date TEXT
      );
      INSERT INTO tasks (team_id, github_issue_number, title, status, due_date)
      VALUES (1, 4, 'Write the guide', 'open', '2026-12-01T00:00:00Z');
    `);
    old.close();

    expect(() => runMigration(oldPath)).not.toThrow();

    const migrated = new Database(oldPath);
    const cols = migrated.prepare('PRAGMA table_info(teams)').all() as Array<{ name: string }>;
    expect(cols.map(c => c.name)).toContain('deadline');

    const team = migrated.prepare(
      'SELECT name, repo_owner, repo_name, created_at, last_synced_at, is_demo, deadline FROM teams',
    ).get();
    expect(team).toEqual({
      name: 'Kept',
      repo_owner: 'acme',
      repo_name: 'app',
      created_at: '2026-11-01T00:00:00Z',
      last_synced_at: '2026-11-12T00:00:00Z',
      is_demo: 1,
      deadline: null,
    });

    const task = migrated.prepare('SELECT title, due_date FROM tasks').get();
    expect(task).toEqual({ title: 'Write the guide', due_date: '2026-12-01T00:00:00Z' });

    const recorded = migrated.prepare(
      "SELECT name FROM schema_migrations WHERE name = 'migration_005_teams_deadline'",
    ).get();
    expect(recorded).toBeTruthy();
    migrated.close();

    expect(() => runMigration(oldPath)).not.toThrow();

    const again = new Database(oldPath);
    const still = again.prepare('SELECT name, deadline FROM teams').get();
    expect(still).toEqual({ name: 'Kept', deadline: null });
    again.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
