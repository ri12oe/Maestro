/**
 * dispute-correction.test.ts — A dispute can correct the label.
 *
 * POST .../dispute with work_type and/or substance stores the AI label,
 * makes the correction the effective label, re-runs the reasoner, and
 * invalidates the weekly digest cache. Undo restores the AI label.
 * classifyTeam (the sync path) does not overwrite the correction.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const TODAY = new Date('2031-01-15T12:00:00.000Z');
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(TODAY);
process.env.AI_PROVIDER = 'mock';

const { default: db } = await import('../db/client.js');
const { default: contributionsRouter } = await import('../routes/contributions.js');
const { default: summaryRouter } = await import('../routes/summary.js');
const { default: assistantRouter } = await import('../routes/assistant.js');
const { classifyTeam } = await import('../ai/classifier.js');
const { runReasoner } = await import('../ai/reasoner.js');

const app = express();
app.use(express.json());
app.use('/api/teams/:teamId/contributions', contributionsRouter);
app.use('/api/teams/:teamId/summary', summaryRouter);
app.use('/api/teams/:teamId', assistantRouter);

const teamId = db.prepare(
  "INSERT INTO teams (name, repo_owner, repo_name) VALUES ('Study', 'acme', 'study')",
).run().lastInsertRowid as number;
const otherTeamId = db.prepare(
  "INSERT INTO teams (name, repo_owner, repo_name) VALUES ('Other', 'acme', 'other')",
).run().lastInsertRowid as number;

const sam = db.prepare(
  "INSERT INTO members (team_id, github_login, display_name) VALUES (?, 'sam-builds', 'Sam')",
).run(teamId).lastInsertRowid as number;

const taskId = db.prepare(
  `INSERT INTO tasks (team_id, github_issue_number, title, status, assignee_login, due_date)
   VALUES (?, 12, 'Auth flow', 'open', 'sam-builds', '2031-01-18')`,
).run(teamId).lastInsertRowid as number;

function insertContribution(title: string): number {
  return db.prepare(
    `INSERT INTO contributions (team_id, member_id, source, title, authored_at)
     VALUES (?, ?, 'commit', ?, '2031-01-09T12:00:00Z')`,
  ).run(teamId, sam, title).lastInsertRowid as number;
}

function insertLabel(contributionId: number, workType: string, substance: string, summary: string): void {
  db.prepare(
    `INSERT INTO classifications (contribution_id, work_type, substance, summary, model_version)
     VALUES (?, ?, ?, ?, 'mock:prompt-v2')`,
  ).run(contributionId, workType, substance, summary);
}

const correctedId = insertContribution('Add registration endpoint');
insertLabel(correctedId, 'feature', 'high', 'Add registration endpoint');
db.prepare(
  'INSERT INTO task_matches (contribution_id, task_id, similarity_score) VALUES (?, ?, 0.9)',
).run(correctedId, taskId);

const notedId = insertContribution('Add unit tests for registration');
insertLabel(notedId, 'test', 'low', 'Add unit tests for registration');

type Label = {
  work_type: string;
  substance: string;
  disputed: number;
  original_work_type: string | null;
  original_substance: string | null;
  corrected_at: string | null;
  dispute_note: string | null;
};

function storedLabel(id: number): Label {
  return db.prepare(
    `SELECT work_type, substance, disputed, original_work_type, original_substance, corrected_at, dispute_note
     FROM classifications WHERE contribution_id = ?`,
  ).get(id) as Label;
}

function riskIds(): number[] {
  return (db.prepare(
    'SELECT id FROM risks WHERE team_id = ? AND dismissed = 0 ORDER BY id',
  ).all(teamId) as Array<{ id: number }>).map(row => row.id);
}

type MemberMap = {
  workCounts: Record<string, number>;
  totalWeight: number;
  contributionCount: number;
};

async function samMap(): Promise<MemberMap> {
  const res = await request(app).get(`/api/teams/${teamId}/summary`);
  expect(res.status).toBe(200);
  const member = (res.body.members as Array<MemberMap & { login: string }>).find(m => m.login === 'sam-builds');
  expect(member).toBeTruthy();
  return member!;
}

beforeAll(async () => {
  await runReasoner(teamId, TODAY);
});

afterAll(() => {
  vi.useRealTimers();
  db.close();
});

describe('POST /api/teams/:teamId/contributions/:contributionId/dispute', () => {
  it('returns 404 for an unknown team, contribution, or classification', async () => {
    const missingTeam = await request(app)
      .post(`/api/teams/9999/contributions/${correctedId}/dispute`)
      .send({ note: 'nope', work_type: 'docs' });
    expect(missingTeam.status).toBe(404);
    expect(missingTeam.body).toEqual({ error: 'Team not found' });

    const missingContribution = await request(app)
      .post(`/api/teams/${teamId}/contributions/9999/dispute`)
      .send({ note: 'nope' });
    expect(missingContribution.status).toBe(404);
    expect(missingContribution.body).toEqual({ error: 'Contribution not found' });

    const otherTeam = await request(app)
      .post(`/api/teams/${otherTeamId}/contributions/${correctedId}/dispute`)
      .send({ work_type: 'docs' });
    expect(otherTeam.status).toBe(404);
    expect(otherTeam.body).toEqual({ error: 'Contribution not found' });

    const bareId = insertContribution('Waiting for a label');
    const noLabel = await request(app)
      .post(`/api/teams/${teamId}/contributions/${bareId}/dispute`)
      .send({ note: 'no label yet' });
    expect(noLabel.status).toBe(404);
    expect(noLabel.body).toEqual({ error: 'Classification not found' });
    db.prepare('DELETE FROM contributions WHERE id = ?').run(bareId);
  });

  it('returns 400 for a work type or substance outside the enums and writes nothing', async () => {
    const before = storedLabel(correctedId);
    const badType = await request(app)
      .post(`/api/teams/${teamId}/contributions/${correctedId}/dispute`)
      .send({ work_type: 'bug', note: 'not a label' });
    expect(badType.status).toBe(400);
    expect(badType.body.error).toMatch(/work_type/);

    const badSubstance = await request(app)
      .post(`/api/teams/${teamId}/contributions/${correctedId}/dispute`)
      .send({ substance: 'huge' });
    expect(badSubstance.status).toBe(400);
    expect(badSubstance.body.error).toMatch(/substance/);

    expect(storedLabel(correctedId)).toEqual(before);
  });

  it('flags a note without changing the effective label or the risks', async () => {
    const risksBefore = riskIds();
    expect(risksBefore.length).toBeGreaterThan(0);
    const res = await request(app)
      .post(`/api/teams/${teamId}/contributions/${notedId}/dispute`)
      .send({ note: 'This was not a test' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      disputed: 1,
      work_type: 'test',
      substance: 'low',
      original_work_type: null,
      corrected_at: null,
    });
    expect(storedLabel(notedId).dispute_note).toBe('This was not a test');
    expect(riskIds()).toEqual(risksBefore);
  });

  it('applies a correction, refreshes risks, and misses the digest cache', async () => {
    const beforeMap = await samMap();
    expect(beforeMap.workCounts).toMatchObject({ feature: 1, test: 1 });
    expect(beforeMap.totalWeight).toBe(4);

    const digestBefore = await request(app).get(`/api/teams/${teamId}/digest`);
    expect(digestBefore.status).toBe(200);
    expect(JSON.stringify(digestBefore.body)).not.toContain('CORRECTION_CACHE_MARKER');

    const risksBefore = riskIds();
    const res = await request(app)
      .post(`/api/teams/${teamId}/contributions/${correctedId}/dispute`)
      .send({ note: 'This is documentation', work_type: 'docs', substance: 'low' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      disputed: 1,
      work_type: 'docs',
      substance: 'low',
      original_work_type: 'feature',
      original_substance: 'high',
    });
    expect(res.body.corrected_at).toEqual(expect.any(String));

    const read = await request(app).get(`/api/teams/${teamId}/contributions/${correctedId}`);
    expect(read.status).toBe(200);
    expect(read.body).toMatchObject({
      work_type: 'docs',
      substance: 'low',
      original_work_type: 'feature',
      original_substance: 'high',
    });

    const afterMap = await samMap();
    expect(afterMap.workCounts.feature).toBeUndefined();
    expect(afterMap.workCounts).toMatchObject({ docs: 1, test: 1 });
    expect(afterMap.totalWeight).toBe(2);
    expect(afterMap.contributionCount).toBe(beforeMap.contributionCount);

    const risksAfter = riskIds();
    expect(risksAfter.length).toBeGreaterThan(0);
    expect(risksAfter).not.toEqual(risksBefore);

    db.prepare('UPDATE classifications SET summary = ? WHERE contribution_id = ?')
      .run('CORRECTION_CACHE_MARKER unique digest line', correctedId);
    const digestAfter = await request(app).get(`/api/teams/${teamId}/digest`);
    expect(digestAfter.status).toBe(200);
    expect(JSON.stringify(digestAfter.body)).toContain('CORRECTION_CACHE_MARKER');
    expect(JSON.stringify(digestAfter.body)).not.toBe(JSON.stringify(digestBefore.body));
  });

  it('does not let classifyTeam overwrite the correction', async () => {
    const before = storedLabel(correctedId);
    expect(before.work_type).toBe('docs');
    expect(before.original_work_type).toBe('feature');

    const again = await classifyTeam(teamId);
    expect(again).toEqual({ classified: 0, failed: 0 });
    expect(storedLabel(correctedId)).toEqual(before);

    const extraId = insertContribution('A brand new commit with no label');
    const first = await classifyTeam(teamId);
    expect(first.classified).toBe(1);
    expect(first.failed).toBe(0);
    expect(storedLabel(correctedId)).toEqual(before);
    const extra = storedLabel(extraId);
    expect(extra.work_type).toBeTruthy();
    expect(extra.corrected_at).toBeNull();

    db.prepare('DELETE FROM contributions WHERE id = ?').run(extraId);
    expect(storedLabel(correctedId)).toEqual(before);
  });

  it('undo restores the AI label and the map', async () => {
    const risksBefore = riskIds();
    const res = await request(app)
      .post(`/api/teams/${teamId}/contributions/${correctedId}/dispute`)
      .send({ undo: true });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      disputed: 0,
      work_type: 'feature',
      substance: 'high',
      original_work_type: null,
      original_substance: null,
      corrected_at: null,
    });
    const stored = storedLabel(correctedId);
    expect(stored).toMatchObject({
      work_type: 'feature',
      substance: 'high',
      disputed: 0,
      original_work_type: null,
      original_substance: null,
      corrected_at: null,
      dispute_note: null,
    });

    const map = await samMap();
    expect(map.workCounts).toMatchObject({ feature: 1, test: 1 });
    expect(map.totalWeight).toBe(4);
    expect(riskIds()).not.toEqual(risksBefore);

    const second = await request(app)
      .post(`/api/teams/${teamId}/contributions/${correctedId}/dispute`)
      .send({ undo: true });
    expect(second.status).toBe(409);
    expect(storedLabel(correctedId).work_type).toBe('feature');
  });

  it('undo after two corrections restores the original AI label', async () => {
    expect(storedLabel(correctedId)).toMatchObject({
      work_type: 'feature',
      substance: 'high',
      original_work_type: null,
      original_substance: null,
    });

    const first = await request(app)
      .post(`/api/teams/${teamId}/contributions/${correctedId}/dispute`)
      .send({ work_type: 'docs', substance: 'medium', note: 'first correction' });
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      work_type: 'docs',
      substance: 'medium',
      original_work_type: 'feature',
      original_substance: 'high',
      risksRefreshed: true,
    });

    const second = await request(app)
      .post(`/api/teams/${teamId}/contributions/${correctedId}/dispute`)
      .send({ work_type: 'test', substance: 'low', note: 'second correction' });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      work_type: 'test',
      substance: 'low',
      original_work_type: 'feature',
      original_substance: 'high',
    });
    expect(storedLabel(correctedId)).toMatchObject({
      work_type: 'test',
      substance: 'low',
      original_work_type: 'feature',
      original_substance: 'high',
    });

    const undone = await request(app)
      .post(`/api/teams/${teamId}/contributions/${correctedId}/dispute`)
      .send({ undo: true });
    expect(undone.status).toBe(200);
    expect(undone.body).toMatchObject({
      work_type: 'feature',
      substance: 'high',
      original_work_type: null,
      original_substance: null,
      corrected_at: null,
      disputed: 0,
    });
    expect(storedLabel(correctedId)).toMatchObject({
      work_type: 'feature',
      substance: 'high',
      original_work_type: null,
      original_substance: null,
      corrected_at: null,
    });
  });
});
