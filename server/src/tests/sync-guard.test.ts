/**
 * sync-guard.test.ts — public repos only, one sync at a time, and a small rate limit.
 * GitHub is mocked. An existing team is synced without the public-repo check.
 */

import { describe, it, expect, afterAll, beforeAll, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import request from 'supertest';

const tmpDir = mkdtempSync(join(tmpdir(), 'sync-guard-'));
process.env.DB_PATH = join(tmpDir, 'test.db');
process.env.AI_PROVIDER = 'mock';
process.env.GITHUB_TOKEN = 'test-token';

const { default: db } = await import('../db/client.js');
const { default: teamsRouter } = await import('../routes/teams.js');
const { requestLimits, resetRequestLimits } = await import('../ingestion/limits.js');

const app = express();
app.use(express.json());
app.use('/api/teams', teamsRouter);

const savedLimits = { ...requestLimits };
let repoLookups = 0;
let hold: Promise<void> | null = null;
let releaseHold: (() => void) | null = null;
let started: (() => void) | null = null;
let repoVisibility: { private: boolean; visibility: string } = { private: false, visibility: 'public' };

function json(status: number, data: unknown): Response {
  const body = JSON.stringify(data);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(JSON.parse(body)),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

beforeAll(() => {
  vi.stubGlobal('fetch', async (url: string) => {
    if (/\/repos\/[^/]+\/[^/]+$/.test(url)) {
      repoLookups += 1;
      return json(200, repoVisibility);
    }
    if (hold) {
      started?.();
      started = null;
      await hold;
    }
    if (url.includes('/commits/') && !url.includes('per_page=')) {
      return json(200, { files: [{ filename: 'README.md', additions: 1, deletions: 0, patch: '+ a' }] });
    }
    if (url.includes('/commits')) {
      return json(200, [{
        sha: 'abc123same',
        commit: { message: 'Add notes', author: { name: 'Ada', email: 'ada@x.com', date: '2026-11-13T12:00:00Z' } },
        author: { login: 'ada' },
        parents: [{ sha: 'p' }],
        html_url: 'https://github.com/acme/app/commit/abc123same',
      }]);
    }
    if (url.includes('/issues') || url.includes('/pulls')) return json(200, []);
    return json(404, { message: 'Not Found' });
  });
});

afterEach(() => {
  hold = null;
  releaseHold = null;
  started = null;
  repoLookups = 0;
  repoVisibility = { private: false, visibility: 'public' };
  Object.assign(requestLimits, savedLimits);
  resetRequestLimits();
});

afterAll(() => {
  vi.unstubAllGlobals();
  db.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may still hold the file */ }
});

describe('new teams stay public', () => {
  it.each([
    ['acme', '..'],
    ['acme', '../../user'],
    ['acme', 'ok?name'],
  ])('rejects %s/%s and does not call GitHub', async (owner, repo) => {
    repoLookups = 0;
    const res = await request(app).post('/api/teams').send({ name: 'Bad', repo_owner: owner, repo_name: repo });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/owner\/repo/);
    expect(repoLookups).toBe(0);
    expect(db.prepare('SELECT id FROM teams WHERE repo_name = ?').get(repo)).toBeUndefined();
  });

  it('refuses a private repository before storing a team', async () => {
    repoVisibility = { private: true, visibility: 'private' };
    const res = await request(app).post('/api/teams').send({ name: 'Secret', repo_owner: 'acme', repo_name: 'secret' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Maestro can only analyze public repositories.');
    expect(db.prepare("SELECT id FROM teams WHERE repo_name = 'secret'").get()).toBeUndefined();
  });

  it('re-syncs a team that already exists without asking whether the repo is public', async () => {
    const id = db.prepare(
      "INSERT INTO teams (name, repo_owner, repo_name, last_synced_at) VALUES ('Maestro', 'ri12oe', 'Maestro', '2026-11-01T00:00:00Z')",
    ).run().lastInsertRowid as number;
    repoVisibility = { private: true, visibility: 'private' };
    repoLookups = 0;
    const res = await request(app).post(`/api/teams/${id}/sync`).send({ stage: 'ingest' });
    expect(res.status).toBe(200);
    expect(res.body.newContributions).toBe(1);
    expect(repoLookups).toBe(0);
    const again = await request(app).post('/api/teams').send({ name: 'Other', repo_owner: 'ri12oe', repo_name: 'Maestro' });
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ id, reused: true, name: 'Maestro' });
    expect(repoLookups).toBe(0);
  });
});

describe('sync guards', () => {
  it('answers 409 when a sync for that team is already running', async () => {
    const id = db.prepare(
      "INSERT INTO teams (name, repo_owner, repo_name, last_synced_at) VALUES ('Busy', 'acme', 'busy', '2026-11-01T00:00:00Z')",
    ).run().lastInsertRowid as number;
    hold = new Promise<void>(resolve => { releaseHold = resolve; });
    const startedP = new Promise<void>(resolve => { started = resolve; });
    const first = new Promise<{ status: number }>((resolve, reject) => {
      request(app).post(`/api/teams/${id}/sync`).send({ stage: 'ingest' }).end((err, res) => {
        if (err) reject(err);
        else resolve(res);
      });
    });
    await startedP;
    const second = await request(app).post(`/api/teams/${id}/sync`).send({ stage: 'ingest' });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('A sync is already running');
    releaseHold?.();
    const done = await first;
    expect(done.status).toBe(200);
  });

  it('rate-limits create per IP and sync per team', async () => {
    requestLimits.createPerIp = 2;
    const first = await request(app).post('/api/teams').send({ name: 'A', repo_owner: 'acme', repo_name: 'rate-a' });
    const second = await request(app).post('/api/teams').send({ name: 'B', repo_owner: 'acme', repo_name: 'rate-b' });
    const third = await request(app).post('/api/teams').send({ name: 'C', repo_owner: 'acme', repo_name: 'rate-c' });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(third.status).toBe(429);
    expect(third.body.error).toMatch(/Wait a minute/);

    requestLimits.createPerIp = savedLimits.createPerIp;
    requestLimits.syncPerTeam = 1;
    resetRequestLimits();
    const id = first.body.id as number;
    const synced = await request(app).post(`/api/teams/${id}/sync`).send({ stage: 'classify' });
    const again = await request(app).post(`/api/teams/${id}/sync`).send({ stage: 'classify' });
    expect(synced.status).toBe(200);
    expect(again.status).toBe(429);
    expect(again.body.error).toMatch(/Wait a minute/);
  });
});
