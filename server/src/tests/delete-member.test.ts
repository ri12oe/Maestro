/**
 * delete-member.test.ts — DELETE /api/teams/:teamId/members/:memberId
 *  - removes a member who has no contributions or suggestions
 *  - returns 409 and keeps the member when they have logged work
 *  - returns 409 and keeps the member when a suggestion still references them
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import request from 'supertest';

const tmpDir = mkdtempSync(join(tmpdir(), 'delete-member-'));
process.env.DB_PATH = join(tmpDir, 'test.db');
process.env.AI_PROVIDER = 'mock';

const { default: db } = await import('../db/client.js');
const { default: membersRouter } = await import('../routes/members.js');

const app = express();
app.use(express.json());
app.use('/api/teams/:teamId/members', membersRouter);

const teamId = db.prepare(
  "INSERT INTO teams (name, repo_owner, repo_name) VALUES ('Alpha', 'acme', 'alpha')",
).run().lastInsertRowid as number;

function addMember(login: string): number {
  return db.prepare(
    'INSERT INTO members (team_id, github_login, display_name) VALUES (?, ?, ?)',
  ).run(teamId, login, login).lastInsertRowid as number;
}

function memberExists(memberId: number): boolean {
  return db.prepare('SELECT id FROM members WHERE id = ? AND team_id = ?').get(memberId, teamId) !== undefined;
}

afterAll(() => {
  db.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
});

describe('DELETE /api/teams/:teamId/members/:memberId', () => {
  it('deletes a member with no logged work', async () => {
    const memberId = addMember('idle');

    const res = await request(app).delete(`/api/teams/${teamId}/members/${memberId}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(memberExists(memberId)).toBe(false);
  });

  it('returns 409 and keeps the member when they have logged work', async () => {
    const memberId = addMember('busy');
    const contributionId = db.prepare(
      `INSERT INTO contributions (team_id, member_id, source, title, authored_at)
       VALUES (?, ?, 'manual', 'Design notes', '2026-11-01T00:00:00Z')`,
    ).run(teamId, memberId).lastInsertRowid as number;

    const res = await request(app).delete(`/api/teams/${teamId}/members/${memberId}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(
      "Can't remove this member because they have logged work or suggestions. Keep them on the team so that history stays.",
    );
    expect(memberExists(memberId)).toBe(true);
    expect(db.prepare('SELECT id FROM contributions WHERE id = ?').get(contributionId)).toEqual({
      id: contributionId,
    });
  });

  it('returns 409 and keeps the member when a suggestion references them', async () => {
    const fromId = addMember('from');
    const toId = addMember('to');
    const taskId = db.prepare(
      "INSERT INTO tasks (team_id, title, status) VALUES (?, 'Reassign me', 'open')",
    ).run(teamId).lastInsertRowid as number;
    db.prepare(
      `INSERT INTO suggestions (team_id, from_member_id, to_member_id, task_id, rationale)
       VALUES (?, ?, ?, ?, 'shift the work')`,
    ).run(teamId, fromId, toId, taskId);

    const res = await request(app).delete(`/api/teams/${teamId}/members/${toId}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(
      "Can't remove this member because they have logged work or suggestions. Keep them on the team so that history stays.",
    );
    expect(memberExists(toId)).toBe(true);
    expect(memberExists(fromId)).toBe(true);
  });
});
