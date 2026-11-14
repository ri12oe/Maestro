/**
 * suggestions-undo.test.ts — Undo an accepted rebalance suggestion.
 *
 * POST .../suggestions/:id/respond with { status: 'pending' } sets an accepted
 * suggestion back to pending and restores the task assignee accept moved.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import request from 'supertest';

const tmpDir = mkdtempSync(join(tmpdir(), 'suggestions-undo-'));
process.env.DB_PATH = join(tmpDir, 'test.db');
process.env.AI_PROVIDER = 'mock';

const { default: db } = await import('../db/client.js');
const { default: suggestionsRouter } = await import('../routes/suggestions.js');

const app = express();
app.use(express.json());
app.use('/api/teams/:teamId/suggestions', suggestionsRouter);

const teamId = db.prepare(
  "INSERT INTO teams (name, repo_owner, repo_name) VALUES ('Study', 'acme', 'study')",
).run().lastInsertRowid as number;
const otherTeamId = db.prepare(
  "INSERT INTO teams (name, repo_owner, repo_name) VALUES ('Other', 'acme', 'other')",
).run().lastInsertRowid as number;

const sam = db.prepare(
  "INSERT INTO members (team_id, github_login, display_name) VALUES (?, 'sam-builds', 'Sam')",
).run(teamId).lastInsertRowid as number;
const jordan = db.prepare(
  "INSERT INTO members (team_id, github_login, display_name) VALUES (?, 'jordan-qa', 'Jordan')",
).run(teamId).lastInsertRowid as number;

let nextIssue = 1;
function insertTask(assignee: string | null): number {
  return db.prepare(
    `INSERT INTO tasks (team_id, github_issue_number, title, status, assignee_login)
     VALUES (?, ?, 'Auth flow', 'open', ?)`,
  ).run(teamId, nextIssue++, assignee).lastInsertRowid as number;
}

function insertSuggestion(taskId: number, status = 'pending'): number {
  return db.prepare(
    `INSERT INTO suggestions (team_id, from_member_id, to_member_id, task_id, rationale, checkin_message, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    teamId,
    sam,
    jordan,
    taskId,
    JSON.stringify(['Sam holds the stalled task']),
    'Could Jordan take the auth flow?',
    status,
  ).lastInsertRowid as number;
}

function suggestionStatus(id: number): string {
  return (db.prepare('SELECT status FROM suggestions WHERE id = ?').get(id) as { status: string }).status;
}

function assignee(taskId: number): string | null {
  return (db.prepare('SELECT assignee_login FROM tasks WHERE id = ?').get(taskId) as { assignee_login: string | null }).assignee_login;
}

function respond(id: number, status: string, forTeam = teamId) {
  return request(app)
    .post(`/api/teams/${forTeam}/suggestions/${id}/respond`)
    .send({ status });
}

afterAll(() => {
  db.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
});

describe('undo an accepted suggestion', () => {
  it('accepts a suggestion, then sets it back to pending and restores the assignee', async () => {
    const taskId = insertTask('sam-builds');
    const suggestionId = insertSuggestion(taskId);

    const accepted = await respond(suggestionId, 'accepted');
    expect(accepted.status).toBe(200);
    expect(accepted.body).toEqual({ ok: true });
    expect(suggestionStatus(suggestionId)).toBe('accepted');
    expect(assignee(taskId)).toBe('jordan-qa');

    const hidden = await request(app).get(`/api/teams/${teamId}/suggestions`);
    expect(hidden.body.map((row: { id: number }) => row.id)).not.toContain(suggestionId);

    const undone = await respond(suggestionId, 'pending');
    expect(undone.status).toBe(200);
    expect(undone.body).toEqual({ ok: true });
    expect(suggestionStatus(suggestionId)).toBe('pending');
    expect(assignee(taskId)).toBe('sam-builds');

    const listed = await request(app).get(`/api/teams/${teamId}/suggestions`);
    const row = listed.body.find((s: { id: number }) => s.id === suggestionId);
    expect(row).toMatchObject({ id: suggestionId, status: 'pending', task_id: taskId });

    const again = await respond(suggestionId, 'pending');
    expect(again.status).toBe(400);
    expect(again.body).toEqual({ error: 'Only an accepted suggestion can be set back to pending' });
    expect(suggestionStatus(suggestionId)).toBe('pending');
    expect(assignee(taskId)).toBe('sam-builds');
  });

  it('leaves the assignee in place when a sync already put the task back', async () => {
    const taskId = insertTask('sam-builds');
    const suggestionId = insertSuggestion(taskId, 'accepted');
    expect(assignee(taskId)).toBe('sam-builds');

    const undone = await respond(suggestionId, 'pending');
    expect(undone.status).toBe(200);
    expect(suggestionStatus(suggestionId)).toBe('pending');
    expect(assignee(taskId)).toBe('sam-builds');
  });

  it.each(['pending', 'dismissed', 'discuss'])(
    'returns 400 when the suggestion is %s',
    async (status) => {
      const taskId = insertTask('sam-builds');
      const suggestionId = insertSuggestion(taskId, status);

      const res = await respond(suggestionId, 'pending');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({ error: 'Only an accepted suggestion can be set back to pending' });
      expect(suggestionStatus(suggestionId)).toBe(status);
      expect(assignee(taskId)).toBe('sam-builds');
    },
  );

  it('returns 404 for an unknown suggestion id', async () => {
    const res = await respond(999999, 'pending');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Suggestion not found' });
  });

  it('returns 404 when the suggestion belongs to another team', async () => {
    const taskId = insertTask('sam-builds');
    const suggestionId = insertSuggestion(taskId, 'accepted');
    db.prepare('UPDATE tasks SET assignee_login = ? WHERE id = ?').run('jordan-qa', taskId);

    const res = await respond(suggestionId, 'pending', otherTeamId);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Suggestion not found' });
    expect(suggestionStatus(suggestionId)).toBe('accepted');
    expect(assignee(taskId)).toBe('jordan-qa');
  });

  it('returns 409 and changes nothing when the task was reassigned to someone else', async () => {
    const taskId = insertTask('sam-builds');
    const suggestionId = insertSuggestion(taskId);
    expect((await respond(suggestionId, 'accepted')).status).toBe(200);
    db.prepare('UPDATE tasks SET assignee_login = ? WHERE id = ?').run('priya-docs', taskId);

    const res = await respond(suggestionId, 'pending');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no longer assigned/);
    expect(suggestionStatus(suggestionId)).toBe('accepted');
    expect(assignee(taskId)).toBe('priya-docs');
  });

  it('returns 409 when the original assignee has no GitHub login', async () => {
    const unknown = db.prepare(
      'INSERT INTO members (team_id, github_login, display_name) VALUES (?, NULL, ?)',
    ).run(teamId, 'Unknown Contributor').lastInsertRowid as number;
    const taskId = insertTask('jordan-qa');
    const suggestionId = db.prepare(
      `INSERT INTO suggestions (team_id, from_member_id, to_member_id, task_id, status)
       VALUES (?, ?, ?, ?, 'accepted')`,
    ).run(teamId, unknown, jordan, taskId).lastInsertRowid as number;

    const res = await respond(suggestionId, 'pending');
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/no GitHub login/);
    expect(suggestionStatus(suggestionId)).toBe('accepted');
    expect(assignee(taskId)).toBe('jordan-qa');
  });
});
