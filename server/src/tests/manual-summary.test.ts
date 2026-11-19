/**
 * manual-summary.test.ts — a manual log cannot store an empty summary.
 *
 * The model summary uses the same trimmed non-empty rule as a commit
 * classification. An empty or whitespace-only model summary is rejected.
 * POST /api/teams/:teamId/manual then keeps the trimmed title (the first 120
 * characters), which is what mock mode already stores. A blank title is 400
 * and writes nothing.
 */

import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import request from 'supertest';

const tmpDir = mkdtempSync(join(tmpdir(), 'manual-summary-'));
process.env.DB_PATH = join(tmpDir, 'test.db');
process.env.AI_PROVIDER = 'mock';

const { default: db } = await import('../db/client.js');
const { ManualSummarySchema, classifyTeam } = await import('../ai/classifier.js');
const { default: manualRouter } = await import('../routes/manual.js');

const app = express();
app.use(express.json());
app.use('/api/teams/:teamId/manual', manualRouter);

const teamId = db.prepare(
  "INSERT INTO teams (name, repo_owner, repo_name) VALUES ('Alpha', 'acme', 'app')",
).run().lastInsertRowid as number;
const memberId = db.prepare(
  "INSERT INTO members (team_id, github_login, display_name) VALUES (?, 'ana', 'Ana A')",
).run(teamId).lastInsertRowid as number;

function log(body: Record<string, unknown> = {}) {
  return request(app).post(`/api/teams/${teamId}/manual`).send({
    member_id: memberId,
    title: 'Notes from the user interviews',
    kind: 'research',
    ...body,
  });
}

function count(sql: string): number {
  return (db.prepare(sql).get() as { n: number }).n;
}

function storedSummary(contributionId: number): string | undefined {
  const row = db.prepare('SELECT summary FROM classifications WHERE contribution_id = ?')
    .get(contributionId) as { summary: string } | undefined;
  return row?.summary;
}

/** Grok returns this summary on every attempt. Other schema names fail immediately. */
function mockGrokSummary(summary: string) {
  process.env.AI_PROVIDER = 'grok';
  process.env.GROK_MODEL = 'test-model';
  process.env.XAI_API_KEY = 'test-key';
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit).body));
    const name = body.response_format?.json_schema?.name;
    if (name !== 'ManualSummary') return new Response('no', { status: 400 });
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ summary }) } }],
    }), { status: 200 });
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  process.env.AI_PROVIDER = 'mock';
  delete process.env.XAI_API_KEY;
  delete process.env.GROK_MODEL;
});

afterAll(() => {
  db.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
});

describe('ManualSummarySchema', () => {
  it('rejects an empty summary', () => {
    expect(() => ManualSummarySchema.parse({ summary: '' })).toThrow();
  });

  it('rejects a whitespace-only summary', () => {
    expect(() => ManualSummarySchema.parse({ summary: '   ' })).toThrow();
    expect(() => ManualSummarySchema.parse({ summary: ' \n\t ' })).toThrow();
  });

  it('accepts a summary and trims it', () => {
    const parsed = ManualSummarySchema.parse({ summary: '  Ran the interviews.  ' });
    expect(parsed.summary).toBe('Ran the interviews.');
  });
});

describe('POST /api/teams/:teamId/manual summary', () => {
  it('stores a trimmed model summary', async () => {
    mockGrokSummary('  Ran five interviews about the timer.  ');
    const res = await log({ title: 'Notes from the user interviews' });
    expect(res.status).toBe(201);
    expect(storedSummary(res.body.id)).toBe('Ran five interviews about the timer.');
  });

  it('keeps the title when the model summary is empty', async () => {
    const title = 'Logged the research interview notes '.repeat(6).trim();
    expect(title.length).toBeGreaterThan(120);
    mockGrokSummary('');
    const res = await log({ title });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe(title);
    expect(storedSummary(res.body.id)).toBe(title.slice(0, 120));
    expect(storedSummary(res.body.id)!.trim().length).toBeGreaterThan(0);
  }, 15000);

  it('keeps the title when the model summary is whitespace', async () => {
    mockGrokSummary(' \n\t ');
    const res = await log({ title: '  Wrote up the research findings  ' });
    expect(res.status).toBe(201);
    expect(res.body.title).toBe('Wrote up the research findings');
    expect(storedSummary(res.body.id)).toBe('Wrote up the research findings');
  }, 15000);

  it('uses the trimmed title in mock mode', async () => {
    process.env.AI_PROVIDER = 'mock';
    const res = await log({ title: '  Sketched the onboarding flow  ' });
    expect(res.status).toBe(201);
    expect(storedSummary(res.body.id)).toBe('Sketched the onboarding flow');
  });

  it.each(['', '   ', ' \n\t '])('rejects a blank title %j with 400', async (title) => {
    const contributions = count('SELECT COUNT(*) AS n FROM contributions');
    const classifications = count('SELECT COUNT(*) AS n FROM classifications');
    mockGrokSummary('should not be asked');
    const fetchSpy = vi.mocked(globalThis.fetch);
    const res = await log({ title });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'title is required' });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(count('SELECT COUNT(*) AS n FROM contributions')).toBe(contributions);
    expect(count('SELECT COUNT(*) AS n FROM classifications')).toBe(classifications);
  });
});

describe('classifyTeam manual summary', () => {
  it('does not store an empty model summary, then uses the title on the next run', async () => {
    const other = db.prepare(
      "INSERT INTO teams (name, repo_owner, repo_name) VALUES ('Beta', 'acme', 'beta')",
    ).run().lastInsertRowid as number;
    const member = db.prepare(
      "INSERT INTO members (team_id, github_login, display_name) VALUES (?, 'bea', 'Bea B')",
    ).run(other).lastInsertRowid as number;
    const title = 'Accessibility notes for the timer';
    const id = db.prepare(
      "INSERT INTO contributions (team_id, member_id, source, title, authored_at) VALUES (?, ?, 'manual', ?, '2026-11-01T12:00:00Z')",
    ).run(other, member, title).lastInsertRowid as number;

    mockGrokSummary('');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failed = await classifyTeam(other);
    expect(failed).toEqual({ classified: 0, failed: 1 });
    expect(storedSummary(id)).toBeUndefined();

    vi.restoreAllMocks();
    process.env.AI_PROVIDER = 'mock';
    const again = await classifyTeam(other);
    expect(again).toEqual({ classified: 1, failed: 0 });
    expect(storedSummary(id)).toBe(title.slice(0, 120));
  }, 15000);

  it('does not store a whitespace-only title as the summary', async () => {
    const other = db.prepare(
      "INSERT INTO teams (name, repo_owner, repo_name) VALUES ('Gamma', 'acme', 'gamma')",
    ).run().lastInsertRowid as number;
    const member = db.prepare(
      "INSERT INTO members (team_id, github_login, display_name) VALUES (?, 'cy', 'Cy C')",
    ).run(other).lastInsertRowid as number;
    const id = db.prepare(
      "INSERT INTO contributions (team_id, member_id, source, title, authored_at) VALUES (?, ?, 'manual', ?, '2026-11-01T12:00:00Z')",
    ).run(other, member, '   ').lastInsertRowid as number;

    process.env.AI_PROVIDER = 'mock';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await classifyTeam(other);
    expect(result).toEqual({ classified: 0, failed: 1 });
    expect(storedSummary(id)).toBeUndefined();
  });
});
