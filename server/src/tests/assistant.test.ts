/**
 * assistant.test.ts — Ask Maestro, the plan check and the weekly digest.
 *
 * Covers the guardrails (ranking questions refused before any model call, cited ids
 * checked against real data), the deterministic plan verdict, the weekly digest
 * (evidence, neutral check-in, ranking fallback), the routes' validation and
 * caching, and the Grok path with a stubbed fetch.
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

function claimText(items: Array<{ text: string }> | undefined): string {
  return (items ?? []).map(s => s.text).join(' ');
}

describe('digest', () => {
  it('summarises the last week with evidence and a neutral check-in', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const d = await A.digest(teamId, 7, TODAY);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(d?.days).toBe(7);
    expect(d?.windowStart).toBe('2026-11-09');
    expect(d?.windowEnd).toBe('2026-11-16');
    const summary = claimText(d?.summary);
    expect(summary).toMatch(/Alpha had 2 commits in the last 7 days/);
    expect(summary).toMatch(/latest matched work on #5 Database schema/);
    expect(summary).toMatch(/#12 Login flow/);
    expect(d?.summary).toHaveLength(4);
    expect(d?.summary.every(s => s.evidence.length > 0)).toBe(true);
    expect(d?.checkInClaims.every(s => s.evidence.length > 0)).toBe(true);
    expect(d?.highlights.some(h => h.evidence.some(e => e.type === 'task' && e.id === schema))).toBe(true);
    expect(d?.highlights.some(h => /latest matched work in the last 7 days/.test(h.text))).toBe(true);
    expect(d?.highlights.every(h => h.evidence.length > 0)).toBe(true);
    expect(d?.risks.some(r => r.evidence.some(e => e.type === 'task' && e.id === login))).toBe(true);
    expect(d?.checkIn).toMatch(/#12 Login flow/);
    expect(d?.checkIn).toMatch(/due/);
    expect(d?.checkIn).not.toMatch(/top contributor|laziest|\brank|blame|did more|did less|closed this week/i);
  });

  it('names the requested day count instead of always saying 7', async () => {
    const d = await A.digest(teamId, 3, TODAY);
    const summary = claimText(d?.summary);
    expect(d?.days).toBe(3);
    expect(d?.windowStart).toBe('2026-11-13');
    expect(summary).toMatch(/last 3 days/);
    expect(summary).not.toMatch(/last 7 days/);
    expect(d?.checkIn).toMatch(/last 3 days|due/);
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
    expect(r.body.windowStart).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.body.windowEnd).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(r.body.summary.length).toBeGreaterThan(0);
    expect(r.body.summary.every((s: { evidence: unknown[] }) => s.evidence.length > 0)).toBe(true);
    expect(r.body.checkIn.length).toBeGreaterThan(0);
    expect(r.body.checkInClaims.every((s: { evidence: unknown[] }) => s.evidence.length > 0)).toBe(true);
    expect(Array.isArray(r.body.highlights)).toBe(true);
    expect(Array.isArray(r.body.risks)).toBe(true);
  });

  it('keeps a fair digest and drops ids the model invented', async () => {
    process.env.AI_PROVIDER = 'grok';
    process.env.XAI_API_KEY = 'test-key';
    process.env.GROK_MODEL = 'grok-test';
    const summary = [
      { text: 'Two commits landed in the last 7 days and the schema had matched work.', source_ids: [`T${schema}`, `C${c3}`] },
      { text: '#12 Login flow is still open and due soon.', source_ids: [`T${login}`] },
      { text: 'The deadline is Dec 4.', source_ids: [`T${login}`] },
    ];
    const checkIn = [
      { text: 'Checking in: #12 Login flow is still open and due Nov 20.', source_ids: [`T${login}`] },
      { text: 'Does the plan still look right?', source_ids: [`T${schema}`] },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => {
      const content = JSON.stringify({
        summary,
        highlights: [{ text: 'Database schema had matched work after the migration fix.', source_ids: [`T${schema}`, `C${c3}`, 'C99999'] }],
        risks: [{ text: '#12 Login flow is open and due Nov 20.', source_ids: [`T${login}`, 'T99999'] }],
        check_in: checkIn,
      });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }));
    const d = await A.digest(teamId, 7, TODAY);
    expect(d?.summary.map(s => s.text)).toEqual(summary.map(s => s.text));
    expect(d?.summary.every(s => s.evidence.length > 0)).toBe(true);
    expect(d?.checkIn).toBe(checkIn.map(s => s.text).join(' '));
    expect(d?.checkInClaims.every(s => s.evidence.length > 0)).toBe(true);
    expect(d?.highlights[0]?.evidence.map(e => e.id)).toEqual([schema, c3]);
    expect(d?.risks[0]?.evidence).toEqual([{ type: 'task', id: login, url: null }]);
  });

  it('replaces a ranking digest with the neutral fallback', async () => {
    process.env.AI_PROVIDER = 'grok';
    process.env.XAI_API_KEY = 'test-key';
    process.env.GROK_MODEL = 'grok-test';
    vi.stubGlobal('fetch', vi.fn(async () => {
      const content = JSON.stringify({
        summary: [
          { text: 'Ana is the top contributor.', source_ids: [`C${c3}`] },
          { text: 'Ben did less of the work.', source_ids: [`C${c2}`] },
        ],
        highlights: [{ text: 'Ben did more than Ana.', source_ids: [`C${c3}`] }],
        risks: [{ text: 'Ana is the laziest on Login flow.', source_ids: [`T${login}`] }],
        check_in: [
          { text: 'Sam contributed the least.', source_ids: [`C${c3}`] },
          { text: 'Does the plan still look right?', source_ids: [`T${login}`] },
        ],
      });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }));
    const d = await A.digest(teamId, 7, TODAY);
    expect(d?.checkIn).toMatch(/Checking in on Alpha/);
    expect(d?.checkIn).toMatch(/#12 Login flow/);
    expect(`${claimText(d?.summary)} ${d?.checkIn}`).not.toMatch(/top contributor|laziest|contributed the least/i);
  });

  it('falls back when the model calls someone the least productive person', async () => {
    process.env.AI_PROVIDER = 'grok';
    process.env.XAI_API_KEY = 'test-key';
    process.env.GROK_MODEL = 'grok-test';
    const fetchSpy = vi.fn(async () => {
      const content = JSON.stringify({
        summary: [
          { text: 'Jordan is the least productive person.', source_ids: [`C${c3}`] },
          { text: '#12 Login flow is still open.', source_ids: [`T${login}`] },
        ],
        highlights: [{ text: 'The schema had matched work.', source_ids: [`T${schema}`] }],
        risks: [{ text: '#12 Login flow is open and due Nov 20.', source_ids: [`T${login}`] }],
        check_in: [
          { text: 'Checking in on the open tasks.', source_ids: [`T${login}`] },
          { text: 'Does the plan still look right?', source_ids: [`T${login}`] },
        ],
      });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const d = await A.digest(teamId, 7, TODAY);
    expect(fetchSpy).toHaveBeenCalled();
    expect(claimText(d?.summary)).toMatch(/Alpha had 2 commits/);
    expect(JSON.stringify(d)).not.toMatch(/least productive/);
  });

  it('falls back when the model says only one person changed an area', async () => {
    process.env.AI_PROVIDER = 'grok';
    process.env.XAI_API_KEY = 'test-key';
    process.env.GROK_MODEL = 'grok-test';
    const fetchSpy = vi.fn(async () => {
      const content = JSON.stringify({
        summary: [
          { text: 'Two commits landed in the last 7 days.', source_ids: [`C${c3}`, `T${schema}`] },
          { text: '#12 Login flow is still open.', source_ids: [`T${login}`] },
        ],
        highlights: [{ text: 'The schema had matched work.', source_ids: [`T${schema}`] }],
        risks: [{ text: 'Only one person has changed server/ recently (100% of the last 11 changes).', source_ids: [`C${c3}`] }],
        check_in: [
          { text: 'Checking in on the open tasks.', source_ids: [`T${login}`] },
          { text: 'Does the plan still look right?', source_ids: [`T${login}`] },
        ],
      });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchSpy);
    const d = await A.digest(teamId, 7, TODAY);
    expect(fetchSpy).toHaveBeenCalled();
    expect(JSON.stringify(d)).not.toMatch(/Only one person/);
    expect(claimText(d?.summary)).toMatch(/Alpha had 2 commits/);
  });

  it('keeps a sentence about who fits a task', async () => {
    process.env.AI_PROVIDER = 'grok';
    process.env.XAI_API_KEY = 'test-key';
    process.env.GROK_MODEL = 'grok-test';
    vi.stubGlobal('fetch', vi.fn(async () => {
      const content = JSON.stringify({
        summary: [
          { text: 'Priya is the best person for this task.', source_ids: [`T${login}`] },
          { text: '#12 Login flow is still open.', source_ids: [`T${login}`] },
        ],
        highlights: [{ text: 'The schema had matched work.', source_ids: [`T${schema}`] }],
        risks: [{ text: '#12 Login flow is open and due Nov 20.', source_ids: [`T${login}`] }],
        check_in: [
          { text: 'Checking in: #12 Login flow is still open.', source_ids: [`T${login}`] },
          { text: 'Does the plan still look right?', source_ids: [`T${login}`] },
        ],
      });
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 });
    }));
    const d = await A.digest(teamId, 7, TODAY);
    expect(claimText(d?.summary)).toMatch(/best person for this task/);
  });

  it('falls back when the digest model is down', async () => {
    process.env.AI_PROVIDER = 'grok';
    process.env.XAI_API_KEY = 'test-key';
    process.env.GROK_MODEL = 'grok-test';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 400 })));
    const d = await A.digest(teamId, 7, TODAY);
    expect(d?.checkIn).toMatch(/#12 Login flow is still open/);
    expect(claimText(d?.summary)).toMatch(/2 commits/);
  });

  it('falls back to template text when the model is down', async () => {
    process.env.AI_PROVIDER = 'grok';
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 400 })));
    const r = await request(app).get(`/api/teams/${teamId}/plan-check?refresh=1`);
    expect(r.status).toBe(200);
    expect(r.body.verdict).toBeDefined();
  });
});
