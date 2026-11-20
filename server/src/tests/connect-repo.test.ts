/**
 * connect-repo.test.ts — a public repository, from connect through the summary.
 *
 * GitHub is a mock. No network. The connect screen's order is the sequence
 * under test: create the team, ingest, classify, match, reason. The summary
 * then has the commit author and at least one risk.
 */

import { describe, it, expect, afterAll, beforeAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import request from 'supertest';

const TODAY = new Date('2026-11-20T15:00:00.000Z');
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(TODAY);

const tmpDir = mkdtempSync(join(tmpdir(), 'connect-repo-'));
process.env.DB_PATH = join(tmpDir, 'test.db');
process.env.AI_PROVIDER = 'mock';
process.env.GITHUB_TOKEN = 'test-token';

const { default: db } = await import('../db/client.js');
const { default: teamsRouter } = await import('../routes/teams.js');
const { default: summaryRouter } = await import('../routes/summary.js');
const { default: risksRouter } = await import('../routes/risks.js');
const { default: tasksRouter } = await import('../routes/tasks.js');
const { default: assistantRouter } = await import('../routes/assistant.js');

const app = express();
app.use(express.json());
app.use('/api/teams', teamsRouter);
app.use('/api/teams/:teamId/summary', summaryRouter);
app.use('/api/teams/:teamId/risks', risksRouter);
app.use('/api/teams/:teamId/tasks', tasksRouter);
app.use('/api/teams/:teamId', assistantRouter);

type Mode = 'happy' | 'missing' | 'limited' | 'empty' | 'no-issues';

let mode: Mode = 'happy';
let commitSha = 'ada0001aaaa';

const RESET_EPOCH = Math.floor(Date.parse('2026-11-20T16:00:00.000Z') / 1000);

function githubResponse(status: number, data: unknown, headers: Record<string, string> = {}): Response {
  const body = JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name: string) => headers[name.toLowerCase()] ?? null },
    json: () => Promise.resolve(JSON.parse(body)),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

function happyCommit() {
  return {
    sha: commitSha,
    commit: {
      message: 'Add dashboard layout',
      author: { name: 'Ada Lovelace', email: 'ada@x.com', date: '2026-11-13T12:00:00.000Z' },
    },
    author: { login: 'ada' },
    parents: [{ sha: 'parent1' }],
    html_url: `https://github.com/acme/widget/commit/${commitSha}`,
  };
}

function happyIssue() {
  return {
    number: 12,
    title: 'Auth flow',
    body: 'Sign-in is stuck.',
    state: 'open',
    assignee: null,
    milestone: { due_on: '2026-11-23T00:00:00Z' },
    html_url: 'https://github.com/acme/widget/issues/12',
  };
}

async function githubFetch(url: string): Promise<Response> {
  if (mode === 'missing') return githubResponse(404, { message: 'Not Found' });
  if (mode === 'limited') {
    return githubResponse(403, { message: 'API rate limit exceeded' }, {
      'x-ratelimit-reset': String(RESET_EPOCH),
    });
  }
  if (url.includes('/pulls')) {
    if (mode === 'empty' || mode === 'no-issues') return githubResponse(200, []);
    return githubResponse(200, [{ number: 7, head: { sha: commitSha }, merge_commit_sha: null }]);
  }
  if (url.includes('/issues')) {
    if (mode === 'empty' || mode === 'no-issues') return githubResponse(200, []);
    return githubResponse(200, [happyIssue()]);
  }
  if (url.includes('/commits/') && !url.includes('per_page=')) {
    return githubResponse(200, {
      files: [{ filename: 'src/app.tsx', additions: 4, deletions: 0, patch: '+ layout' }],
    });
  }
  if (url.includes('/commits')) {
    if (mode === 'empty') return githubResponse(200, []);
    return githubResponse(200, [happyCommit()]);
  }
  return githubResponse(404, { message: 'Not Found' });
}

beforeAll(() => {
  vi.stubGlobal('fetch', githubFetch);
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  db.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* the file can still be open on Windows */ }
});

async function createTeam(owner: string, repo: string, name = repo) {
  return request(app).post('/api/teams').send({ name, repo_owner: owner, repo_name: repo });
}

describe('connect a public repository', () => {
  it('ingests, classifies, matches, and reasons, then the summary has members and risks', async () => {
    mode = 'happy';
    commitSha = 'ada0001aaaa';
    const created = await createTeam('acme', 'widget', 'Widget');
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const ingested = await request(app).post(`/api/teams/${id}/sync`).send({ stage: 'ingest' });
    expect(ingested.status).toBe(200);
    expect(ingested.body).toMatchObject({
      ok: true,
      stage: 'ingest',
      newContributions: 1,
      newMembers: 1,
      updatedTasks: 1,
      notice: null,
      window: { commits: 30, issues: 30, pulls: 20 },
    });
    expect(db.prepare('SELECT github_pr_number FROM contributions WHERE team_id = ?').get(id)).toEqual({ github_pr_number: 7 });

    const classified = await request(app).post(`/api/teams/${id}/sync`).send({ stage: 'classify' });
    expect(classified.status).toBe(200);
    expect(classified.body.classified).toBe(1);
    expect(classified.body.classifyFailed).toBe(0);

    const matched = await request(app).post(`/api/teams/${id}/sync`).send({ stage: 'match' });
    expect(matched.status).toBe(200);

    const deadline = await request(app).patch(`/api/teams/${id}`).send({ deadline: '2026-11-23' });
    expect(deadline.status).toBe(200);

    const reasoned = await request(app).post(`/api/teams/${id}/sync`).send({ stage: 'reason' });
    expect(reasoned.status).toBe(200);
    expect(reasoned.body.risksDetected).toBeGreaterThan(0);

    const summary = await request(app).get(`/api/teams/${id}/summary`);
    expect(summary.status).toBe(200);
    expect(summary.body.members).toEqual([
      expect.objectContaining({ login: 'ada', displayName: 'Ada Lovelace' }),
    ]);
    expect(summary.body.statCards.tasksAtRisk).toBeGreaterThan(0);

    const risks = await request(app).get(`/api/teams/${id}/risks`);
    expect(risks.status).toBe(200);
    expect(risks.body.length).toBeGreaterThan(0);

    const digest = await request(app).get(`/api/teams/${id}/digest`);
    expect(digest.status).toBe(200);
    expect(digest.body.summary.length).toBeGreaterThan(0);
    expect(digest.body.summary[0].text.length).toBeGreaterThan(0);
    expect(digest.body.summary[0].evidence.length).toBeGreaterThan(0);
    expect(digest.body.checkIn.length).toBeGreaterThan(0);
  });

  it('runs the whole pipeline when stage is omitted, which is what Sync now sends', async () => {
    mode = 'happy';
    commitSha = 'ada0002bbbb';
    const created = await createTeam('acme', 'widget-sync');
    expect(created.status).toBe(201);
    const id = created.body.id as number;

    const synced = await request(app).post(`/api/teams/${id}/sync`).send({});
    expect(synced.status).toBe(200);
    expect(synced.body.stage).toBe('all');
    expect(synced.body.classified).toBe(1);
    expect(synced.body.risksDetected).toBeGreaterThan(0);

    const summary = await request(app).get(`/api/teams/${id}/summary`);
    expect(summary.body.members).toEqual([expect.objectContaining({ login: 'ada' })]);
    expect(summary.body.statCards.tasksAtRisk).toBeGreaterThan(0);
  });

  it('reuses the existing team for the same owner and repo, and leaves StudyBuddy alone', async () => {
    const demoId = db.prepare(
      "INSERT INTO teams (name, repo_owner, repo_name, is_demo) VALUES ('StudyBuddy', 'studybuddy-org', 'studybuddy-app', 1)",
    ).run().lastInsertRowid as number;
    const before = db.prepare('SELECT id, name, repo_owner, repo_name, is_demo FROM teams WHERE id = ?').get(demoId);

    const again = await createTeam('Acme', 'Widget', 'Someone else');
    expect(again.status).toBe(200);
    expect(again.body.reused).toBe(true);
    expect(again.body.name).toBe('Widget');
    expect(again.body.id).toBe(
      (db.prepare("SELECT id FROM teams WHERE repo_owner = 'acme' AND repo_name = 'widget'").get() as { id: number }).id,
    );
    const copies = db.prepare(
      "SELECT COUNT(*) AS n FROM teams WHERE lower(repo_owner) = 'acme' AND lower(repo_name) = 'widget'",
    ).get() as { n: number };
    expect(copies.n).toBe(1);

    const other = await createTeam('other', 'repo', 'Other');
    expect(other.status).toBe(201);
    expect(db.prepare('SELECT id, name, repo_owner, repo_name, is_demo FROM teams WHERE id = ?').get(demoId)).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS n FROM members WHERE team_id = ?').get(demoId)).toEqual({ n: 0 });

    const demo = await createTeam('StudyBuddy-Org', 'StudyBuddy-App', 'StudyBuddy copy');
    expect(demo.status).toBe(200);
    expect(demo.body).toMatchObject({ id: demoId, name: 'StudyBuddy', is_demo: 1, reused: true });
    const demoRows = db.prepare(
      "SELECT COUNT(*) AS n FROM teams WHERE lower(repo_name) = 'studybuddy-app'",
    ).get() as { n: number };
    expect(demoRows.n).toBe(1);
  });

  it('explains a missing or private repository and says to try again', async () => {
    mode = 'missing';
    const created = await createTeam('nope', 'missing');
    const res = await request(app).post(`/api/teams/${created.body.id}/sync`).send({ stage: 'ingest' });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/couldn't find nope\/missing/);
    expect(res.body.error).toMatch(/private/);
    expect(res.body.error).toMatch(/Try again/);
  });

  it('explains a rate limit with the reset time', async () => {
    mode = 'limited';
    const created = await createTeam('acme', 'limited');
    const res = await request(app).post(`/api/teams/${created.body.id}/sync`).send({ stage: 'ingest' });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/rate-limiting/);
    expect(res.body.error).toContain('2026-11-20T16:00:00.000Z');
  });

  it('explains an empty repository and does not invent commits', async () => {
    mode = 'empty';
    const created = await createTeam('acme', 'empty');
    const res = await request(app).post(`/api/teams/${created.body.id}/sync`).send({ stage: 'ingest' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no commits in the latest 30/);
    expect(res.body.error).toMatch(/Push a commit/);
    expect(db.prepare('SELECT COUNT(*) AS n FROM contributions WHERE team_id = ?').get(created.body.id)).toEqual({ n: 0 });
  });

  it('still analyzes a repository with no issues, and says the task plan is missing', async () => {
    mode = 'no-issues';
    commitSha = 'ada0003cccc';
    const created = await createTeam('acme', 'no-issues');
    const id = created.body.id as number;

    const ingested = await request(app).post(`/api/teams/${id}/sync`).send({ stage: 'ingest' });
    expect(ingested.status).toBe(200);
    expect(ingested.body.newContributions).toBe(1);
    expect(ingested.body.updatedTasks).toBe(0);
    expect(ingested.body.notice).toMatch(/no GitHub Issues/);
    expect(ingested.body.notice).toMatch(/contribution map still works/);

    const classified = await request(app).post(`/api/teams/${id}/sync`).send({ stage: 'classify' });
    expect(classified.status).toBe(200);
    expect(classified.body.classified).toBe(1);

    const reasoned = await request(app).post(`/api/teams/${id}/sync`).send({ stage: 'reason' });
    expect(reasoned.status).toBe(200);

    const summary = await request(app).get(`/api/teams/${id}/summary`);
    expect(summary.status).toBe(200);
    expect(summary.body.members).toEqual([expect.objectContaining({ login: 'ada' })]);
    expect(summary.body.statCards.tasksTotal).toBe(0);

    const tasks = await request(app).get(`/api/teams/${id}/tasks`);
    expect(tasks.status).toBe(200);
    expect(tasks.body).toEqual([]);
  });

  it('explains a missing GitHub token', async () => {
    const saved = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      const created = await createTeam('acme', 'needs-token');
      const res = await request(app).post(`/api/teams/${created.body.id}/sync`).send({ stage: 'ingest' });
      expect(res.status).toBe(503);
      expect(res.body.error).toMatch(/Set the GITHUB_TOKEN environment variable/);
      expect(res.body.error).toMatch(/Try again/);
    } finally {
      process.env.GITHUB_TOKEN = saved;
    }
  });
});
