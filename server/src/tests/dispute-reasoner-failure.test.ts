/**
 * dispute-reasoner-failure.test.ts — a reasoner throw does not undo the label.
 *
 * The label UPDATE commits before runReasoner. If the reasoner throws, the
 * route still returns 200 with the saved label and a warning. A following
 * undo then restores the original AI label instead of 409.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../ai/reasoner.js', () => ({
  runReasoner: vi.fn(async () => {
    throw new Error('reasoner down');
  }),
}));

process.env.AI_PROVIDER = 'mock';

const { runReasoner } = await import('../ai/reasoner.js');
const { default: db } = await import('../db/client.js');
const { default: contributionsRouter, RISK_REFRESH_WARNING } = await import('../routes/contributions.js');

const app = express();
app.use(express.json());
app.use('/api/teams/:teamId/contributions', contributionsRouter);

const teamId = db.prepare(
  "INSERT INTO teams (name, repo_owner, repo_name) VALUES ('Study', 'acme', 'study')",
).run().lastInsertRowid as number;
const memberId = db.prepare(
  "INSERT INTO members (team_id, github_login, display_name) VALUES (?, 'sam-builds', 'Sam')",
).run(teamId).lastInsertRowid as number;
const contributionId = db.prepare(
  `INSERT INTO contributions (team_id, member_id, source, title, authored_at)
   VALUES (?, ?, 'commit', 'Add registration endpoint', '2031-01-09T12:00:00Z')`,
).run(teamId, memberId).lastInsertRowid as number;
db.prepare(
  `INSERT INTO classifications (contribution_id, work_type, substance, summary, model_version)
   VALUES (?, 'feature', 'high', 'Add registration endpoint', 'mock:prompt-v2')`,
).run(contributionId);

type Label = {
  work_type: string;
  substance: string;
  original_work_type: string | null;
  original_substance: string | null;
  corrected_at: string | null;
  disputed: number;
};

function storedLabel(): Label {
  return db.prepare(
    `SELECT work_type, substance, original_work_type, original_substance, corrected_at, disputed
     FROM classifications WHERE contribution_id = ?`,
  ).get(contributionId) as Label;
}

function dispute(body: Record<string, unknown>) {
  return request(app)
    .post(`/api/teams/${teamId}/contributions/${contributionId}/dispute`)
    .send(body);
}

afterAll(() => { db.close(); });

describe('dispute when the reasoner throws', () => {
  it('saves a correction and a following undo, both as 200 with a warning', async () => {
    const corrected = await dispute({ work_type: 'docs', substance: 'low', note: 'docs, not a feature' });
    expect(corrected.status).toBe(200);
    expect(corrected.body).toMatchObject({
      ok: true,
      work_type: 'docs',
      substance: 'low',
      original_work_type: 'feature',
      original_substance: 'high',
      disputed: 1,
      risksRefreshed: false,
      warning: RISK_REFRESH_WARNING,
    });
    expect(corrected.body.corrected_at).toEqual(expect.any(String));
    expect(storedLabel()).toMatchObject({
      work_type: 'docs',
      substance: 'low',
      original_work_type: 'feature',
      original_substance: 'high',
      disputed: 1,
    });
    expect(vi.mocked(runReasoner)).toHaveBeenCalledTimes(1);

    const undone = await dispute({ undo: true });
    expect(undone.status).toBe(200);
    expect(undone.body).toMatchObject({
      ok: true,
      work_type: 'feature',
      substance: 'high',
      original_work_type: null,
      original_substance: null,
      corrected_at: null,
      disputed: 0,
      risksRefreshed: false,
      warning: RISK_REFRESH_WARNING,
    });
    expect(storedLabel()).toMatchObject({
      work_type: 'feature',
      substance: 'high',
      original_work_type: null,
      original_substance: null,
      corrected_at: null,
      disputed: 0,
    });
    expect(vi.mocked(runReasoner)).toHaveBeenCalledTimes(2);
  });
});
