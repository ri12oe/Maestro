/**
 * delete-team.test.ts — DELETE /api/teams/:teamId
 *  - removes the team and every row that belongs to it
 *  - leaves other teams and their rows untouched
 *  - 404s for an unknown id, and treats a non-numeric id like GET
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import request from 'supertest';

const tmpDir = mkdtempSync(join(tmpdir(), 'delete-team-'));
process.env.DB_PATH = join(tmpDir, 'test.db');
process.env.AI_PROVIDER = 'mock';

const { default: db } = await import('../db/client.js');
const { default: teamsRouter } = await import('../routes/teams.js');

const app = express();
app.use(express.json());
app.use('/api/teams', teamsRouter);

function count(sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

function seedTeam(name: string) {
  const teamId = db.prepare(
    'INSERT INTO teams (name, repo_owner, repo_name) VALUES (?, ?, ?)',
  ).run(name, 'acme', name.toLowerCase()).lastInsertRowid as number;

  const memberA = db.prepare(
    'INSERT INTO members (team_id, github_login, email, display_name) VALUES (?, ?, ?, ?)',
  ).run(teamId, `${name}-a`, `${name}-a@x.com`, `${name} A`).lastInsertRowid as number;
  const memberB = db.prepare(
    'INSERT INTO members (team_id, github_login, email, display_name) VALUES (?, ?, ?, ?)',
  ).run(teamId, `${name}-b`, `${name}-b@x.com`, `${name} B`).lastInsertRowid as number;

  const taskId = db.prepare(
    "INSERT INTO tasks (team_id, github_issue_number, title, status) VALUES (?, 1, ?, 'open')",
  ).run(teamId, `${name} task`).lastInsertRowid as number;

  const commitId = db.prepare(
    `INSERT INTO contributions (team_id, member_id, source, github_sha, title, authored_at)
     VALUES (?, ?, 'commit', ?, ?, '2026-01-01T00:00:00Z')`,
  ).run(teamId, memberA, `${name}-sha`, `${name} commit`).lastInsertRowid as number;

  const manualId = db.prepare(
    `INSERT INTO contributions (team_id, member_id, source, title, body, kind, authored_at)
     VALUES (?, ?, 'manual', ?, ?, 'meeting', '2026-01-02T00:00:00Z')`,
  ).run(teamId, memberB, `${name} log`, 'notes').lastInsertRowid as number;

  db.prepare(
    `INSERT INTO classifications (contribution_id, work_type, substance, summary)
     VALUES (?, 'feature', 'high', ?)`,
  ).run(commitId, `${name} class`);
  db.prepare(
    `INSERT INTO classifications (contribution_id, work_type, substance, summary)
     VALUES (?, 'other', 'low', ?)`,
  ).run(manualId, `${name} manual class`);

  db.prepare(
    'INSERT INTO task_matches (contribution_id, task_id, similarity_score) VALUES (?, ?, 0.9)',
  ).run(commitId, taskId);

  db.prepare(
    `INSERT INTO risks (team_id, task_id, level, description, evidence)
     VALUES (?, ?, 'high', ?, '[]')`,
  ).run(teamId, taskId, `${name} risk`);

  db.prepare(
    `INSERT INTO suggestions (team_id, from_member_id, to_member_id, task_id, rationale, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
  ).run(teamId, memberA, memberB, taskId, `${name} suggestion`);

  return { teamId, commitId, manualId };
}

const drop = seedTeam('Drop');
const keep = seedTeam('Keep');

afterAll(() => {
  db.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
});

describe('DELETE /api/teams/:teamId', () => {
  it('removes the team and its child rows and leaves other teams untouched', async () => {
    const res = await request(app).delete(`/api/teams/${drop.teamId}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    expect(db.prepare('SELECT id FROM teams WHERE id = ?').get(drop.teamId)).toBeUndefined();
    expect(count('SELECT COUNT(*) AS n FROM members WHERE team_id = ?', drop.teamId)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM tasks WHERE team_id = ?', drop.teamId)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM contributions WHERE team_id = ?', drop.teamId)).toBe(0);
    expect(count("SELECT COUNT(*) AS n FROM contributions WHERE team_id = ? AND source = 'manual'", drop.teamId)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM risks WHERE team_id = ?', drop.teamId)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM suggestions WHERE team_id = ?', drop.teamId)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM classifications WHERE contribution_id IN (?, ?)', drop.commitId, drop.manualId)).toBe(0);
    expect(count('SELECT COUNT(*) AS n FROM task_matches WHERE contribution_id = ?', drop.commitId)).toBe(0);

    expect(db.prepare('SELECT name FROM teams WHERE id = ?').get(keep.teamId)).toEqual({ name: 'Keep' });
    expect(count('SELECT COUNT(*) AS n FROM members WHERE team_id = ?', keep.teamId)).toBe(2);
    expect(count('SELECT COUNT(*) AS n FROM tasks WHERE team_id = ?', keep.teamId)).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM contributions WHERE team_id = ?', keep.teamId)).toBe(2);
    expect(count("SELECT COUNT(*) AS n FROM contributions WHERE team_id = ? AND source = 'manual'", keep.teamId)).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM classifications WHERE contribution_id IN (?, ?)', keep.commitId, keep.manualId)).toBe(2);
    expect(count('SELECT COUNT(*) AS n FROM task_matches WHERE contribution_id = ?', keep.commitId)).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM risks WHERE team_id = ?', keep.teamId)).toBe(1);
    expect(count('SELECT COUNT(*) AS n FROM suggestions WHERE team_id = ?', keep.teamId)).toBe(1);

    const list = await request(app).get('/api/teams');
    expect(list.status).toBe(200);
    const ids = list.body.map((t: { id: number }) => t.id);
    expect(ids).toContain(keep.teamId);
    expect(ids).not.toContain(drop.teamId);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await request(app).delete('/api/teams/999999');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Team not found' });
  });

  it('treats a non-numeric id like GET /api/teams/:teamId', async () => {
    const del = await request(app).delete('/api/teams/abc');
    const get = await request(app).get('/api/teams/abc');
    expect(del.status).toBe(get.status);
    expect(del.body).toEqual(get.body);
    expect(del.status).toBe(404);
    expect(del.body).toEqual({ error: 'Team not found' });
  });
});
