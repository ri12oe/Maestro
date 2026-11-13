/**
 * reasoner-fixes.test.ts — regression tests for the Milestone 3a review fixes:
 *  1. Stalled-task levels depend on how close the deadline is (no noise for far-off tasks).
 *  2. Risk descriptions name the task they are about.
 *  3. The summary's tasksAtRisk counts distinct tasks, not risk cards.
 *  4. A failed AI call falls back to template wording instead of failing the sync.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';

const TODAY = new Date('2026-11-13T12:00:00Z');
const tmpDir = mkdtempSync(join(tmpdir(), 'reasoner-fixes-'));
const dbPath = join(tmpDir, 'test.db');

// The summary route uses the db singleton, so point it at our file before importing.
process.env.DB_PATH = dbPath;
process.env.AI_PROVIDER = 'mock';

const { runMigration } = await import('../db/migrate.js');
const { runReasoner } = await import('../ai/reasoner.js');
const { default: summaryRouter } = await import('../routes/summary.js');
const { default: singletonDb } = await import('../db/client.js');

runMigration(dbPath);
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

function iso(daysFromToday: number): string {
  return new Date(TODAY.getTime() + daysFromToday * 86_400_000).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const teamId = db.prepare("INSERT INTO teams (name, repo_owner, repo_name) VALUES ('T', 'o', 'r')")
  .run().lastInsertRowid as number;
const alice = db.prepare("INSERT INTO members (team_id, github_login, email, display_name) VALUES (?, 'alice', 'a@x', 'Alice A')")
  .run(teamId).lastInsertRowid as number;
db.prepare("INSERT INTO members (team_id, github_login, email, display_name) VALUES (?, 'bob', 'b@x', 'Bob B')").run(teamId);

function task(n: number, title: string, due: number | null, assignee: string | null = 'alice'): number {
  return db.prepare('INSERT INTO tasks (team_id, github_issue_number, title, status, due_date, assignee_login) VALUES (?, ?, ?, \'open\', ?, ?)')
    .run(teamId, n, title, due === null ? null : iso(due).slice(0, 10), assignee).lastInsertRowid as number;
}
function workOn(taskId: number, daysAgo: number): void {
  const c = db.prepare("INSERT INTO contributions (team_id, member_id, source, github_sha, title, authored_at) VALUES (?, ?, 'commit', ?, 'work', ?)")
    .run(teamId, alice, `sha-${taskId}-${daysAgo}`, iso(-daysAgo)).lastInsertRowid as number;
  db.prepare('INSERT INTO task_matches (contribution_id, task_id, similarity_score) VALUES (?, ?, 0.9)').run(c, taskId);
}

const dueSoon    = task(1, 'Due soon',      3);    workOn(dueSoon, 8);
const dueNextWk  = task(2, 'Due next week', 10);   workOn(dueNextWk, 8);
const dueLater   = task(3, 'Due later',     20);   workOn(dueLater, 8);
const noDueOld   = task(4, 'No due, idle',  null); workOn(noDueOld, 20);
const noDueFresh = task(5, 'No due, new',   null, null);
const active     = task(6, 'Active',        2);    workOn(active, 1);

function levelOf(taskId: number): string | undefined {
  return (db.prepare('SELECT level FROM risks WHERE task_id = ? AND dismissed = 0').get(taskId) as { level: string } | undefined)?.level;
}

beforeAll(async () => {
  await runReasoner(teamId, TODAY, db);
});

afterAll(() => {
  // Close BOTH connections to the test file — Windows refuses to delete open files.
  db.close();
  singletonDb.close();
  try {
    rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // Temp-dir cleanup is best-effort; the OS clears it eventually.
  }
});

describe('stalled-task levels', () => {
  it('due within 7 days → high', () => expect(levelOf(dueSoon)).toBe('high'));
  it('due within 14 days → medium', () => expect(levelOf(dueNextWk)).toBe('medium'));
  it('due in 20 days → not flagged', () => expect(levelOf(dueLater)).toBeUndefined());
  it('no due date, idle 14+ days → low', () => expect(levelOf(noDueOld)).toBe('low'));
  it('no due date and nothing done yet → low', () => expect(levelOf(noDueFresh)).toBe('low'));
  it('recently active → not flagged', () => expect(levelOf(active)).toBeUndefined());
});

describe('risk descriptions', () => {
  it('name the task they are about', () => {
    const d = (db.prepare('SELECT description FROM risks WHERE task_id = ?').get(dueSoon) as { description: string }).description;
    expect(d).toContain('#1 Due soon');
    expect(d).toMatch(/8 days/);
  });
});

describe('summary tasksAtRisk', () => {
  it('counts distinct tasks, never more than the total', async () => {
    // Add a second risk on the same task to prove it is counted once.
    db.prepare("INSERT INTO risks (team_id, task_id, level, description) VALUES (?, ?, 'low', 'duplicate')").run(teamId, dueSoon);

    const app = express();
    app.use('/api/teams/:teamId/summary', summaryRouter);
    const res = await request(app).get(`/api/teams/${teamId}/summary`);
    expect(res.status).toBe(200);
    expect(res.body.statCards.tasksAtRisk).toBe(4); // dueSoon, dueNextWk, noDueOld, noDueFresh
    expect(res.body.statCards.tasksAtRisk).toBeLessThanOrEqual(res.body.statCards.tasksTotal);
  });
});

describe('AI failure fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    process.env.AI_PROVIDER = 'mock';
  });

  it('keeps the risks with template wording when the AI call fails', async () => {
    process.env.AI_PROVIDER = 'grok';
    process.env.GROK_MODEL = 'test-model';
    process.env.XAI_API_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad request', { status: 400 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runReasoner(teamId, TODAY, db)).resolves.not.toThrow();
    const d = (db.prepare('SELECT description FROM risks WHERE task_id = ? AND dismissed = 0').get(dueSoon) as { description: string }).description;
    expect(d).toContain('#1 Due soon');
  });
});
