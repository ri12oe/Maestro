/**
 * assistant.test.ts — Ask Maestro, the plan check and the weekly digest.
 *
 * Covers the guardrails (ranking questions refused before any model call, cited ids
 * checked against real data), the deterministic plan verdict, digest stats, the
 * routes' validation and caching, and the Grok path with a stubbed fetch.
 */

import { describe, it, expect, afterAll, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import request from 'supertest';

const tmpDir = mkdtempSync(join(tmpdir(), 'assistant-'));
process.env.DB_PATH = join(tmpDir, 'test.db');
process.env.AI_PROVIDER = 'mock';

const { default: db } = await import('../db/client.js');
const A = await import('../ai/assistant.js');
const { default: assistantRouter, clearAssistantCache } = await import('../routes/assistant.js');

const app = express();
app.use(express.json());
app.use('/api/teams/:teamId', assistantRouter);

const TODAY = new Date('2026-11-16T12:00:00Z');
const teamId = db.prepare("INSERT INTO teams (name, repo_owner, repo_name, deadline) VALUES ('Alpha', 'acme', 'alpha', '2026-12-04')").run().lastInsertRowid as number;
const ana = db.prepare("INSERT INTO members (team_id, github_login, display_name) VALUES (?, 'ana', 'Ana Park')").run(teamId).lastInsertRowid as number;
const ben = db.prepare("INSERT INTO members (team_id, github_login, display_name) VALUES (?, 'ben', 'Ben Ito')").run(teamId).lastInsertRowid as number;
const login = db.prepare("INSERT INTO tasks (team_id, github_issue_number, title, status, due_date, assignee_login) VALUES (?, 12, 'Login flow', 'open', '2026-11-20', 'ana')").run(teamId).lastInsertRowid as number;
const docs = db.prepare("INSERT INTO tasks (team_id, github_issue_number, title, status, due_date) VALUES (?, 4, 'Write docs', 'open', '2026-12-03')").run(teamId).lastInsertRowid as number;
const schema = db.prepare("INSERT INTO tasks (team_id, github_issue_number, title, status, due_date, assignee_login) VALUES (?, 5, 'Database schema', 'closed', '2026-11-10', 'ben')").run(teamId).lastInsertRowid as number;
db.prepare("INSERT INTO risks (team_id, task_id, level, description) VALUES (?, ?, 'high', 'Login flow has gone quiet.')").run(teamId, login);

function commit(member: number, sha: string, at: string, title: string, task: number | null, workType = 'feature') {
  const id = db.prepare("INSERT INTO contributions (team_id, member_id, source, github_sha, title, authored_at) VALUES (?, ?, 'commit', ?, ?, ?)")
    .run(teamId, member, sha, title, at).lastInsertRowid as number;
  db.prepare("INSERT INTO classifications (contribution_id, work_type, substance, summary) VALUES (?, ?, 'medium', ?)").run(id, workType, title);
  if (task) db.prepare('INSERT INTO task_matches (contribution_id, task_id, similarity_score) VALUES (?, ?, 0.9)').run(id, task);
  return id;
}
const c1 = commit(ana, 'a1', '2026-11-05T10:00:00Z', 'Add login form', login);
const c2 = commit(ben, 'b1', '2026-11-12T10:00:00Z', 'Create database tables', schema);
const c3 = commit(ben, 'b2', '2026-11-14T10:00:00Z', 'Fix migration order', schema, 'fix');

afterEach(() => { vi.unstubAllGlobals(); process.env.AI_PROVIDER = 'mock'; clearAssistantCache(); });
afterAll(() => {
  db.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
});

describe('ranking guardrail', () => {
  it.each([
    'Who is the laziest on the team?',
    'who did the most work',
    'Who contributed less than everyone else?',
    'rank the team by effort',
    'rate the members by effort',
    'compare everyone’s contribution',
    'Is Ben not pulling his weight?',
    'Ben did more of the work than Ana',
    'Sam contributed the least',
  ])('refuses %s', async q => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    process.env.AI_PROVIDER = 'grok';
    const r = await A.ask(teamId, q, TODAY);
    expect(r?.refused).toBe(true);
    expect(r?.answer).toBe(A.REFUSAL);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it.each([
    'Who has worked on the database?',
    'What is blocking #12?',
    'What did Ana do this week?',
    'Who could take on more tasks?',
    'What has Frank worked on?',
    'Compared to the plan, is #12 behind?',
  ])('answers %s', q => {
    expect(A.isRankingQuestion(q)).toBe(false);
  });
});

describe('ask (mock)', () => {
  it('finds a task by its issue number and cites it', async () => {
    const r = await A.ask(teamId, 'What is happening with #12?', TODAY);
    expect(r?.answer).toMatch(/#12 Login flow is open and at high risk/);
    expect(r?.sources).toContainEqual({ type: 'task', id: login });
    expect(r?.sources).toContainEqual({ type: 'contribution', id: c1 });
  });

  it('answers about a person from their own work only', async () => {
    const r = await A.ask(teamId, 'What has Ben worked on?', TODAY);
    expect(r?.sources.map(s => s.id)).toEqual(expect.arrayContaining([c2, c3]));
    expect(r?.sources).not.toContainEqual({ type: 'contribution', id: c1 });
  });

  it('says so when there is no evidence', async () => {
    const r = await A.ask(teamId, 'What about the payments integration?', TODAY);
    expect(r?.answer).toMatch(/don’t have evidence/);
    expect(r?.sources).toEqual([]);
  });

  it('returns null for an unknown team', async () => {
    expect(await A.ask(9999, 'hi?', TODAY)).toBeNull();
  });
});

describe('ask (grok, stubbed)', () => {
  function grokAnswer(answer: string, sourceIds: string[]) {
    process.env.AI_PROVIDER = 'grok';
    process.env.XAI_API_KEY = 'test-key';
    process.env.GROK_MODEL = 'grok-test';
    vi.stubGlobal('fetch', vi.fn(async () => {
      const content = JSON.stringify({ can_answer: true, answer, source_ids: sourceIds });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }));
  }

  it('sends data in <data> tags with the rules, and drops ids the model invented', async () => {
    process.env.AI_PROVIDER = 'grok';
    process.env.XAI_API_KEY = 'test-key';
    process.env.GROK_MODEL = 'grok-test';
    let sent = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { body: string }) => {
      sent = JSON.parse(init.body).messages[0].content;
      const content = JSON.stringify({ can_answer: true, answer: 'Ben built the tables.', source_ids: [`C${c2}`, 'C99999', `T${schema}`, 'X1'] });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }));
    const r = await A.ask(teamId, 'Who has worked on the database?', TODAY);
    expect(sent).toContain('<data>');
    expect(sent).toContain('never rank, grade, score or compare');
    expect(sent).toContain(`C${c2} |`);
    expect(r?.sources).toEqual([{ type: 'contribution', id: c2 }, { type: 'task', id: schema }]);
  });

  it('refuses a ranking even when the model says it can answer', async () => {
    process.env.AI_PROVIDER = 'grok';
    process.env.XAI_API_KEY = 'test-key';
    process.env.GROK_MODEL = 'grok-test';
    vi.stubGlobal('fetch', vi.fn(async () => {
      const content = JSON.stringify({
        can_answer: true,
        answer: 'I rank Ben above Ana: he did more of the work.',
        source_ids: [`C${c2}`, `C${c1}`],
      });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }));
    const r = await A.ask(teamId, 'Who has worked on the database?', TODAY);
    expect(r?.refused).toBe(true);
    expect(r?.answer).toBe(A.REFUSAL);
    expect(r?.sources).toEqual([]);
  });

  it('keeps a sourced answer that only compares work to the plan', async () => {
    const answer = 'Compared to the plan, #12 is behind. Judged by the commits, the schema is done.';
    grokAnswer(answer, [`T${login}`, `T${schema}`]);
    const r = await A.ask(teamId, 'What is blocking #12?', TODAY);
    expect(r?.refused).toBe(false);
    expect(r?.answer).toBe(answer);
    expect(r?.sources).toEqual([{ type: 'task', id: login }, { type: 'task', id: schema }]);
  });

  it('refuses a did-more-than ranking that never says rank, compare, or judge', async () => {
    grokAnswer('Ben did more of the work than Ana.', [`C${c2}`, `C${c1}`]);
    const r = await A.ask(teamId, 'Who has worked on the database?', TODAY);
    expect(r?.refused).toBe(true);
    expect(r?.answer).toBe(A.REFUSAL);
    expect(r?.sources).toEqual([]);
  });

  it('refuses a contributed-the-least ranking with no ranking keyword', async () => {
    grokAnswer('Sam contributed the least.', [`C${c3}`]);
    const r = await A.ask(teamId, 'What did Ana do this week?', TODAY);
    expect(r?.refused).toBe(true);
    expect(r?.answer).toBe(A.REFUSAL);
    expect(r?.sources).toEqual([]);
  });

  it('does not refuse a team-level commit rate', async () => {
    const answer = 'the commit rate across the team dropped this week';
    grokAnswer(answer, [`C${c2}`, `C${c3}`]);
    const r = await A.ask(teamId, 'What did Ana do this week?', TODAY);
    expect(r?.refused).toBe(false);
    expect(r?.answer).toBe(answer);
    expect(r?.sources).toEqual([{ type: 'contribution', id: c2 }, { type: 'contribution', id: c3 }]);
  });

  it('does not refuse an answer that names Frank', async () => {
    const answer = 'Frankly, Frank closed the schema.';
    grokAnswer(answer, [`C${c2}`, `T${schema}`]);
    const r = await A.ask(teamId, 'Who has worked on the database?', TODAY);
    expect(r?.refused).toBe(false);
    expect(r?.answer).toBe(answer);
    expect(r?.sources).toEqual([{ type: 'contribution', id: c2 }, { type: 'task', id: schema }]);
  });
});

describe('plan check', () => {
  it('computes the verdict from numbers, not the model', () => {
    const f = A.loadTeamFacts(teamId, TODAY)!;
    const p = A.computePlan(f);
    expect(p.open.map(t => t.id).sort()).toEqual([login, docs].sort());
    expect(p.daysLeft).toBe(18);
    expect(p.closedRecently).toBe(1);
    expect(p.pace).toBe(0.3);
    expect(p.needed).toBe(0.8);
    expect(p.verdict).toBe('behind');
  });

  it('is on track when the pace covers what is left', () => {
    const f = A.loadTeamFacts(teamId, TODAY)!;
    const p = A.computePlan({ ...f, deadline: '2027-06-01' });
    expect(p.verdict).toBe('on_track');
  });

  it('reports no deadline and finished projects plainly', () => {
    const f = A.loadTeamFacts(teamId, TODAY)!;
    expect(A.computePlan({ ...f, deadline: null }).verdict).toBe('no_deadline');
    expect(A.computePlan({ ...f, tasks: f.tasks.map(t => ({ ...t, status: 'closed' as const })) }).verdict).toBe('done');
  });

  it('recommends real open tasks only', async () => {
    const r = await A.planCheck(teamId, TODAY);
    expect(r?.summary).toMatch(/2 tasks are open with 18 days left/);
    const cited = r!.recommendations.flatMap(x => x.taskIds);
    expect(cited).toContain(login);
    expect(cited).not.toContain(schema);
  });
});

describe('digest', () => {
  it('counts the last week and lists what moved, shipped, is stuck and is next', async () => {
    const d = await A.digest(teamId, 7, TODAY);
    expect(d?.stats).toMatchObject({ contributions: 2, tasksClosed: 1, people: 1 });
    expect(d?.points.map(p => p.kind)).toEqual(['shipped', 'stuck', 'next']);
    expect(d?.points.find(p => p.kind === 'stuck')?.sources).toEqual([{ type: 'task', id: login }]);
  });
});

describe('routes', () => {
  it('validates questions', async () => {
    expect((await request(app).post(`/api/teams/${teamId}/ask`).send({})).status).toBe(400);
    expect((await request(app).post(`/api/teams/${teamId}/ask`).send({ question: 'x'.repeat(301) })).status).toBe(400);
    expect((await request(app).post('/api/teams/9999/ask').send({ question: 'hi?' })).status).toBe(404);
    const ok = await request(app).post(`/api/teams/${teamId}/ask`).send({ question: 'What is blocking #12?' });
    expect(ok.status).toBe(200);
    expect(ok.body.refused).toBe(false);
  });

  it('caches the plan check until the data changes', async () => {
    const first = await request(app).get(`/api/teams/${teamId}/plan-check`);
    const again = await request(app).get(`/api/teams/${teamId}/plan-check`);
    expect(again.body.generatedAt).toBe(first.body.generatedAt);
    db.prepare("UPDATE tasks SET status = 'closed' WHERE id = ?").run(docs);
    const changed = await request(app).get(`/api/teams/${teamId}/plan-check`);
    expect(changed.body.openTasks).toBe(1);
    db.prepare("UPDATE tasks SET status = 'open' WHERE id = ?").run(docs);
  });

  it('serves the digest', async () => {
    const r = await request(app).get(`/api/teams/${teamId}/digest?days=7`);
    expect(r.status).toBe(200);
    expect(r.body.days).toBe(7);
  });

  it('falls back to template text when the model is down', async () => {
    process.env.AI_PROVIDER = 'grok';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 400 })));
    const r = await request(app).get(`/api/teams/${teamId}/plan-check?refresh=1`);
    expect(r.status).toBe(200);
    expect(r.body.verdict).toBeDefined();
  });
});
