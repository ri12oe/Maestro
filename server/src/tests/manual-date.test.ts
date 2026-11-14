/**
 * manual-date.test.ts — optional date on a manual log entry.
 *
 * POST /api/teams/:teamId/manual accepts `date` as YYYY-MM-DD and stores it
 * on contributions.authored_at. Omitting it stamps the current time.
 * An invalid date or a future date is 400 and writes nothing.
 * Member evidence, the task activity column, and the manual list read that
 * same authored_at column.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import request from 'supertest';

const tmpDir = mkdtempSync(join(tmpdir(), 'manual-date-'));
process.env.DB_PATH = join(tmpDir, 'test.db');
process.env.AI_PROVIDER = 'mock';

const { default: db } = await import('../db/client.js');
const { default: manualRouter } = await import('../routes/manual.js');
const { default: contributionsRouter } = await import('../routes/contributions.js');
const { default: tasksRouter } = await import('../routes/tasks.js');

const app = express();
app.use(express.json());
app.use('/api/teams/:teamId/manual', manualRouter);
app.use('/api/teams/:teamId/contributions', contributionsRouter);
app.use('/api/teams/:teamId/tasks', tasksRouter);

const teamId = db.prepare(
  "INSERT INTO teams (name, repo_owner, repo_name) VALUES ('Alpha', 'acme', 'app')",
).run().lastInsertRowid as number;
const memberId = db.prepare(
  "INSERT INTO members (team_id, github_login, display_name) VALUES (?, 'ana', 'Ana A')",
).run(teamId).lastInsertRowid as number;
const taskId = db.prepare(
  "INSERT INTO tasks (team_id, github_issue_number, title, status) VALUES (?, 3, 'Notes', 'open')",
).run(teamId).lastInsertRowid as number;

function utcDay(offset: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function log(body: Record<string, unknown>) {
  return request(app).post(`/api/teams/${teamId}/manual`).send({
    member_id: memberId,
    title: 'Notes from standup',
    kind: 'meeting',
    ...body,
  });
}

function contributionCount(): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM contributions WHERE team_id = ?').get(teamId) as { n: number };
  return row.n;
}

afterAll(() => {
  db.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
});

describe('POST /api/teams/:teamId/manual date', () => {
  it('stamps the current time when date is omitted', async () => {
    const before = new Date(Date.now() - 2000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    const res = await log({});
    const after = new Date(Date.now() + 2000).toISOString().replace(/\.\d{3}Z$/, 'Z');

    expect(res.status).toBe(201);
    expect(res.body.authored_at >= before).toBe(true);
    expect(res.body.authored_at <= after).toBe(true);
  });

  it('stores a valid past date on authored_at', async () => {
    const res = await log({ date: '2026-10-02', task_id: taskId, title: 'Reviewed the study guide' });
    expect(res.status).toBe(201);
    expect(res.body.authored_at).toBe('2026-10-02T12:00:00Z');

    const listed = await request(app).get(`/api/teams/${teamId}/manual`);
    const entry = listed.body.find((row: { title: string }) => row.title === 'Reviewed the study guide');
    expect(entry.authored_at).toBe('2026-10-02T12:00:00Z');

    const contributions = await request(app).get(`/api/teams/${teamId}/contributions?memberId=${memberId}`);
    const contribution = contributions.body.find((row: { title: string }) => row.title === 'Reviewed the study guide');
    expect(contribution.authored_at).toBe('2026-10-02T12:00:00Z');

    const tasks = await request(app).get(`/api/teams/${teamId}/tasks`);
    const task = tasks.body.find((row: { id: number }) => row.id === taskId);
    expect(task.last_activity_at).toBe('2026-10-02T12:00:00Z');
  });

  it('stores today', async () => {
    const today = utcDay(0);
    const res = await log({ date: today, title: 'Logged for today' });
    expect(res.status).toBe(201);
    expect(res.body.authored_at).toBe(`${today}T12:00:00Z`);
  });

  it.each([
    '2026-13-01',
    '2026-02-30',
    '11/14/2026',
    '2026-1-1',
    '2026-10-02T12:00:00Z',
    '',
    'not-a-date',
  ])('rejects %j with 400', async (date) => {
    const before = contributionCount();
    const res = await log({ date });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('date must be YYYY-MM-DD');
    expect(contributionCount()).toBe(before);
  });

  it('rejects a non-string date with 400', async () => {
    const before = contributionCount();
    const res = await log({ date: 20261002 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('date must be YYYY-MM-DD');
    expect(contributionCount()).toBe(before);
  });

  it('rejects a future date with 400', async () => {
    const before = contributionCount();
    const tomorrow = await log({ date: utcDay(1) });
    expect(tomorrow.status).toBe(400);
    expect(tomorrow.body.error).toBe('date cannot be in the future');

    const far = await log({ date: '2099-01-01' });
    expect(far.status).toBe(400);
    expect(far.body.error).toBe('date cannot be in the future');
    expect(contributionCount()).toBe(before);
  });
});
