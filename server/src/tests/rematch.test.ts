/**
 * rematch.test.ts — linking older commits to Issues created after them.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

const tmpDir = mkdtempSync(join(tmpdir(), 'rematch-'));
process.env.DB_PATH = join(tmpDir, 'test.db');
process.env.AI_PROVIDER = 'mock';

const { default: db } = await import('../db/client.js');
const { classifyTeam, rematchNewTasks } = await import('../ai/classifier.js');

const teamId = db.prepare("INSERT INTO teams (name, repo_owner, repo_name) VALUES ('T', 'o', 'r')").run().lastInsertRowid as number;
const dev = db.prepare("INSERT INTO members (team_id, github_login, email, display_name) VALUES (?, 'dev', 'd@x', 'Dev D')").run(teamId).lastInsertRowid as number;
const commit = (sha: string, title: string) =>
  db.prepare("INSERT INTO contributions (team_id, member_id, source, github_sha, title, authored_at) VALUES (?, ?, 'commit', ?, ?, '2026-11-01T10:00:00Z')")
    .run(teamId, dev, sha, title).lastInsertRowid as number;
const task = (n: number, title: string) =>
  db.prepare("INSERT INTO tasks (team_id, github_issue_number, title, status) VALUES (?, ?, ?, 'open')").run(teamId, n, title).lastInsertRowid as number;
const matchOf = (contributionId: number) =>
  (db.prepare('SELECT task_id FROM task_matches WHERE contribution_id = ?').get(contributionId) as { task_id: number } | undefined)?.task_id;

afterAll(() => {
  db.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
});

describe('rematchNewTasks', () => {
  const login = commit('a1', 'Build login form with validation');
  const export_ = commit('a2', 'Implement export to Anki decks');

  it('links an old commit to an Issue created after it was classified', async () => {
    task(1, 'Unrelated setup chore');
    await classifyTeam(teamId);
    expect(matchOf(login)).toBeUndefined();

    const loginTask = task(2, 'Login form validation');
    const r = await rematchNewTasks(teamId);
    expect(r.linked).toBe(1);
    expect(matchOf(login)).toBe(loginTask);
    expect(matchOf(export_)).toBeUndefined();
  });

  it('does no work when there are no new Issues', async () => {
    const r = await rematchNewTasks(teamId);
    expect(r).toEqual({ checked: 0, linked: 0, failed: 0 });
  });

  it('checks still-unlinked commits again when another Issue appears', async () => {
    task(3, 'Anki export decks');
    await rematchNewTasks(teamId);
    const anki = (db.prepare('SELECT id FROM tasks WHERE github_issue_number = 3').get() as { id: number }).id;
    expect(matchOf(export_)).toBe(anki);
  });

  it('retries on the next sync if the AI call fails', async () => {
    const lonely = commit('a3', 'Write deployment guide');
    await classifyTeam(teamId);

    process.env.AI_PROVIDER = 'grok';
    process.env.GROK_MODEL = 'test-model';
    process.env.XAI_API_KEY = 'test-key';
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('bad request', { status: 400 }));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const deployTask = task(4, 'Deployment guide for Railway');
    const failedRun = await rematchNewTasks(teamId);
    vi.restoreAllMocks();
    process.env.AI_PROVIDER = 'mock';

    expect(failedRun.failed).toBeGreaterThan(0);
    expect(matchOf(lonely)).toBeUndefined();

    const retry = await rematchNewTasks(teamId);
    expect(retry.linked).toBeGreaterThanOrEqual(1);
    expect(matchOf(lonely)).toBe(deployTask);
  });
});
