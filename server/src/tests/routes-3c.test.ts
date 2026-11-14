/**
 * routes-3c.test.ts — API additions for the Milestone 3c screens:
 *  - GET /api/teams lists teams with member and contribution counts
 *  - GET /api/teams/:id/tasks includes last activity and matched-work counts
 *  - POST /api/teams/:id/sync explains a missing token and GitHub errors in plain words
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import request from 'supertest';

const tmpDir = mkdtempSync(join(tmpdir(), 'routes-3c-'));
process.env.DB_PATH = join(tmpDir, 'test.db');
process.env.AI_PROVIDER = 'mock';

const { default: db } = await import('../db/client.js');
const { default: teamsRouter, explainSyncError } = await import('../routes/teams.js');
const { default: tasksRouter } = await import('../routes/tasks.js');

const app = express();
app.use(express.json());
app.use('/api/teams', teamsRouter);
app.use('/api/teams/:teamId/tasks', tasksRouter);

const teamId = db.prepare("INSERT INTO teams (name, repo_owner, repo_name) VALUES ('Alpha', 'acme', 'alpha')").run().lastInsertRowid as number;
const ana = db.prepare("INSERT INTO members (team_id, github_login, email, display_name) VALUES (?, 'ana', 'a@x', 'Ana A')").run(teamId).lastInsertRowid as number;
const t1 = db.prepare("INSERT INTO tasks (team_id, github_issue_number, title, status, due_date, assignee_login) VALUES (?, 1, 'Login', 'open', '2026-12-01', 'ana')").run(teamId).lastInsertRowid as number;
db.prepare("INSERT INTO tasks (team_id, github_issue_number, title, status) VALUES (?, 2, 'Docs', 'open')").run(teamId);
for (const [sha, at] of [['s1', '2026-11-01T10:00:00Z'], ['s2', '2026-11-05T10:00:00Z']]) {
  const c = db.prepare("INSERT INTO contributions (team_id, member_id, source, github_sha, title, authored_at) VALUES (?, ?, 'commit', ?, 'x', ?)")
    .run(teamId, ana, sha, at).lastInsertRowid as number;
  db.prepare('INSERT INTO task_matches (contribution_id, task_id, similarity_score) VALUES (?, ?, 0.9)').run(c, t1);
}

afterAll(() => {
  db.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
});

describe('GET /api/teams', () => {
  it('lists teams with counts', async () => {
    const res = await request(app).get('/api/teams');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([expect.objectContaining({
      id: teamId, name: 'Alpha', repo_owner: 'acme', repo_name: 'alpha', member_count: 1, contribution_count: 2,
    })]);
  });
});

describe('GET /api/teams/:id/tasks', () => {
  it('includes owner name, matched-work count and last activity', async () => {
    const res = await request(app).get(`/api/teams/${teamId}/tasks`);
    const login = res.body.find((t: { github_issue_number: number }) => t.github_issue_number === 1);
    expect(login).toMatchObject({ assignee_name: 'Ana A', contribution_count: 2, last_activity_at: '2026-11-05T10:00:00Z' });
    const docs = res.body.find((t: { github_issue_number: number }) => t.github_issue_number === 2);
    expect(docs).toMatchObject({ contribution_count: 0, last_activity_at: null });
  });
});

describe('sync errors', () => {
  it('explains a missing GitHub token', async () => {
    const saved = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    const res = await request(app).post(`/api/teams/${teamId}/sync`);
    process.env.GITHUB_TOKEN = saved;
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/Set the GITHUB_TOKEN environment variable/);
  });

  it.each([
    ['GitHub commits fetch failed: 404 {"message":"Not Found"}', 404, /couldn't find acme\/alpha/],
    ['GitHub issues fetch failed: 401 {"message":"Bad credentials"}', 502, /rejected the token/],
    ['GitHub commits fetch failed: 403 {"message":"API rate limit exceeded"}', 503, /rate-limiting/],
    ['something else broke', 500, /Sync failed: something else broke/],
  ])('maps "%s"', (message, status, pattern) => {
    const out = explainSyncError(new Error(message), teamId);
    expect(out.status).toBe(status);
    expect(out.error).toMatch(pattern);
  });
});
