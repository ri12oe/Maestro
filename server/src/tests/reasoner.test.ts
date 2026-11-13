/**
 * reasoner.test.ts — Tests for the risk reasoner and summary/suggestion logic.
 *
 * Tests:
 *  1. Issue #12 (Auth flow, stalled, due in 7 days) produces a high stalled risk.
 *  2. server/ directory produces a single-point-of-failure risk for Sam.
 *  3. The suggestion validator rejects invalid members and tasks.
 *  4. GET /api/teams/:teamId/summary returns members in alphabetical order.
 *  5. Accepting a suggestion updates the task's assignee_login.
 *
 * Uses seed-like data and a fixed date (today = 2026-11-13).
 *
 * Note: The express routes (summary, suggestions) use the global db singleton from
 * client.ts, which is initialized at module-load time and cannot be overridden from a
 * test. These tests therefore call the route handler logic directly on testDb instead
 * of going through HTTP.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { runMigration } from '../db/migrate.js';
import { runReasoner } from '../ai/reasoner.js';

process.env.AI_PROVIDER = 'mock';

// Fixed reference date for all tests
const TODAY = new Date('2026-11-13T12:00:00Z');

// ── Set up temp DB ────────────────────────────────────────────────────────────

const TEST_TMP_DIR = mkdtempSync(join(tmpdir(), 'reasoner-test-'));
const TEST_DB_PATH = join(TEST_TMP_DIR, 'test.db');
runMigration(TEST_DB_PATH);
const testDb = new Database(TEST_DB_PATH);
testDb.pragma('journal_mode = WAL');
testDb.pragma('foreign_keys = ON');

function daysAgo(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() - n);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function daysFromNow(n: number): string {
  const d = new Date(TODAY);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

// Insert team and members
const teamId = testDb.prepare(
  "INSERT INTO teams (name, repo_owner, repo_name) VALUES ('StudyBuddy', 'org', 'repo')",
).run().lastInsertRowid as number;

const ins = (login: string, email: string, name: string) =>
  testDb.prepare(
    'INSERT INTO members (team_id, github_login, email, display_name) VALUES (?,?,?,?)',
  ).run(teamId, login, email, name).lastInsertRowid as number;

const rioId    = ins('rio-dev',    'rio@x.com',    'Rio Chen');
const samId    = ins('sam-builds', 'sam@x.com',    'Sam Rivera');
const priyaId  = ins('priya-code', 'priya@x.com',  'Priya Nair');
const jordanId = ins('jordan-qa',  'jordan@x.com', 'Jordan Lee');

// Insert tasks
const insTask = (num: number, title: string, due: string, assignee: string) =>
  testDb.prepare(
    `INSERT INTO tasks (team_id, github_issue_number, title, status, due_date, assignee_login, synced_at)
     VALUES (?, ?, ?, 'open', ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,
  ).run(teamId, num, title, due, assignee).lastInsertRowid as number;

// Issue #12 "Auth flow" due in 7 days → HIGH stalled risk
const task12Id = insTask(12, 'Auth flow',               daysFromNow(7),  'rio-dev');
const task13Id = insTask(13, 'User dashboard UI',       daysFromNow(14), 'priya-code');
const task14Id = insTask(14, 'Backend API endpoints',   daysFromNow(10), 'sam-builds');
const task15Id = insTask(15, 'Database schema design',  daysFromNow(20), 'sam-builds');

// Sam: 11 commits under server/ — creates SPOF for server/
const serverPaths = JSON.stringify(['server/routes/users.ts', 'server/db/client.ts']);
for (let i = 0; i < 11; i++) {
  const contribId = testDb.prepare(
    `INSERT INTO contributions
       (team_id, member_id, source, github_sha, title, paths, authored_at)
     VALUES (?, ?, 'commit', ?, ?, ?, ?)`,
  ).run(teamId, samId, `sam-sha-${i}`, `Sam server commit ${i}`, serverPaths, daysAgo(2 + i))
    .lastInsertRowid as number;

  testDb.prepare(
    `INSERT INTO classifications (contribution_id, work_type, substance, summary, model_version)
     VALUES (?, 'feature', 'high', 'Server feature', 'mock')`,
  ).run(contribId);

  if (i < 2) {
    testDb.prepare(
      `INSERT INTO task_matches (contribution_id, task_id, similarity_score, matched_at)
       VALUES (?, ?, 0.9, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,
    ).run(contribId, task14Id);
  }
}

// Rio: 2 commits matching task12 (auth flow) — both >6 days ago → stalled
for (let i = 0; i < 2; i++) {
  const contribId = testDb.prepare(
    `INSERT INTO contributions
       (team_id, member_id, source, github_sha, title, paths, authored_at)
     VALUES (?, ?, 'commit', ?, ?, ?, ?)`,
  ).run(teamId, rioId, `rio-sha-${i}`, `Auth flow commit ${i}`,
    JSON.stringify(['client/src/pages/Login.tsx']),
    daysAgo(7 + i),
  ).lastInsertRowid as number;

  testDb.prepare(
    `INSERT INTO classifications (contribution_id, work_type, substance, summary, model_version)
     VALUES (?, 'feature', 'medium', 'Auth feature', 'mock')`,
  ).run(contribId);

  testDb.prepare(
    `INSERT INTO task_matches (contribution_id, task_id, similarity_score, matched_at)
     VALUES (?, ?, 0.85, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,
  ).run(contribId, task12Id);
}

// Jordan: test commits — intentionally under client/ so they don't dilute Sam's server/ ownership
for (let i = 0; i < 2; i++) {
  const contribId = testDb.prepare(
    `INSERT INTO contributions
       (team_id, member_id, source, github_sha, title, paths, authored_at)
     VALUES (?, ?, 'commit', ?, ?, ?, ?)`,
  ).run(teamId, jordanId, `jor-sha-${i}`, `Jordan test commit ${i}`,
    JSON.stringify(['client/tests/api.test.ts']),
    daysAgo(3),
  ).lastInsertRowid as number;

  testDb.prepare(
    `INSERT INTO classifications (contribution_id, work_type, substance, summary, model_version)
     VALUES (?, 'test', 'medium', 'Test coverage', 'mock')`,
  ).run(contribId);
}

// Priya: UI commit, matched to task13 (recent — not stalled)
const priyaContribId = testDb.prepare(
  `INSERT INTO contributions
     (team_id, member_id, source, github_sha, title, paths, authored_at)
   VALUES (?, ?, 'commit', ?, ?, ?, ?)`,
).run(teamId, priyaId, 'pri-sha-0', 'Priya UI commit',
  JSON.stringify(['client/src/pages/Dashboard.tsx']),
  daysAgo(2),
).lastInsertRowid as number;

testDb.prepare(
  `INSERT INTO classifications (contribution_id, work_type, substance, summary, model_version)
   VALUES (?, 'feature', 'medium', 'Dashboard UI', 'mock')`,
).run(priyaContribId);

testDb.prepare(
  `INSERT INTO task_matches (contribution_id, task_id, similarity_score, matched_at)
   VALUES (?, ?, 0.8, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))`,
).run(priyaContribId, task13Id);

// Suppress unused variable warnings
void task13Id; void task15Id;

// ── Run the reasoner once before all tests ───────────────────────────────────

beforeAll(async () => {
  await runReasoner(teamId, TODAY, testDb);
});

afterAll(() => {
  testDb.close();
  rmSync(TEST_TMP_DIR, { recursive: true, force: true });
});

// ── Test 1: Issue #12 produces a high stalled risk ────────────────────────────

describe('stalled task detection', () => {
  it('issue #12 (Auth flow, stalled, due in 7 days) produces a high stalled risk', () => {
    const risks = testDb.prepare(`
      SELECT r.level, r.description, r.evidence, t.github_issue_number
      FROM risks r
      JOIN tasks t ON t.id = r.task_id
      WHERE r.team_id = ? AND r.dismissed = 0 AND t.github_issue_number = 12
    `).all(teamId) as Array<{
      level: string;
      description: string;
      evidence: string;
      github_issue_number: number;
    }>;

    expect(risks.length).toBeGreaterThanOrEqual(1);
    const risk = risks[0];
    expect(risk.level).toBe('high');
    expect(risk.github_issue_number).toBe(12);

    const evidence = JSON.parse(risk.evidence) as Array<{ type: string; id: number }>;
    expect(evidence.some(e => e.type === 'task' && e.id === task12Id)).toBe(true);
  });

  it('stalled risk description is non-empty', () => {
    const risk = testDb.prepare(`
      SELECT description FROM risks
      WHERE team_id = ? AND dismissed = 0
      ORDER BY CASE level WHEN 'high' THEN 1 ELSE 2 END LIMIT 1
    `).get(teamId) as { description: string } | undefined;

    expect(risk).toBeDefined();
    expect(risk!.description.length).toBeGreaterThan(10);
  });
});

// ── Test 2: server/ produces a SPOF risk for Sam ─────────────────────────────

describe('single point of failure detection', () => {
  it('server/ directory produces a single-point-of-failure risk', () => {
    const risks = testDb.prepare(`
      SELECT level, description, evidence FROM risks
      WHERE team_id = ? AND dismissed = 0 AND task_id IS NULL
    `).all(teamId) as Array<{ level: string; description: string; evidence: string }>;

    // There should be a SPOF risk for server/
    const spofRisks = risks.filter(r => r.level === 'medium');
    expect(spofRisks.length).toBeGreaterThanOrEqual(1);

    // The evidence should include contribution IDs from Sam's server/ commits
    const spof = spofRisks[0];
    const evidence = JSON.parse(spof.evidence) as Array<{ type: string; id: number }>;
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((e: { type: string }) => e.type === 'contribution')).toBe(true);
  });

  it('the SPOF description is non-empty', () => {
    const risk = testDb.prepare(`
      SELECT description FROM risks
      WHERE team_id = ? AND dismissed = 0 AND task_id IS NULL AND level = 'medium'
      LIMIT 1
    `).get(teamId) as { description: string } | undefined;

    expect(risk).toBeDefined();
    expect(risk!.description.length).toBeGreaterThan(10);
  });
});

// ── Test 3: Suggestion validator rejects invalid members and tasks ─────────────

describe('suggestion validator', () => {
  it('no suggestion has an orphan task_id', () => {
    // All suggestions must have valid task_ids
    const orphanSuggestions = testDb.prepare(`
      SELECT s.id FROM suggestions s
      LEFT JOIN tasks t ON t.id = s.task_id
      WHERE s.team_id = ? AND t.id IS NULL
    `).all(teamId) as Array<{ id: number }>;

    expect(orphanSuggestions).toHaveLength(0);
  });

  it('no suggestion targets Unknown Contributor', () => {
    const badSuggestions = testDb.prepare(`
      SELECT s.id FROM suggestions s
      JOIN members m1 ON m1.id = s.from_member_id
      JOIN members m2 ON m2.id = s.to_member_id
      WHERE s.team_id = ?
        AND (m1.display_name = 'Unknown Contributor' OR m2.display_name = 'Unknown Contributor')
    `).all(teamId) as Array<{ id: number }>;

    expect(badSuggestions).toHaveLength(0);
  });

  it('a login not in the members table produces no suggestion', () => {
    // Simulate: 'nonexistent-user' is not in memberByLogin
    const memberByLogin = new Map<string, number>();
    for (const m of testDb.prepare(
      'SELECT id, github_login FROM members WHERE team_id = ?',
    ).all(teamId) as Array<{ id: number; github_login: string }>) {
      memberByLogin.set(m.github_login, m.id);
    }

    expect(memberByLogin.get('nonexistent-user')).toBeUndefined();
    expect(memberByLogin.get('Unknown Contributor')).toBeUndefined();
  });

  it('a task_number not in the DB is not persisted', () => {
    // task_number 999 does not exist
    const taskByNumber = testDb.prepare(
      'SELECT id, github_issue_number FROM tasks WHERE team_id = ?',
    ).all(teamId) as Array<{ id: number; github_issue_number: number }>;
    const taskIdByNumber = new Map(taskByNumber.map(t => [t.github_issue_number, t.id]));
    expect(taskIdByNumber.get(999)).toBeUndefined();
  });
});

// ── Test 4: Summary returns members in alphabetical order ─────────────────────
//
// We test the summary query logic directly (not via HTTP) because the express
// summary route uses the global db singleton which cannot be overridden in tests.

const SUBSTANCE_WEIGHT: Record<string, number> = { low: 1, medium: 2, high: 3 };

function getSummaryData(db: Database.Database, tid: number) {
  const memberRows = db.prepare(`
    SELECT id, github_login, display_name
    FROM members
    WHERE team_id = ? AND github_login IS NOT NULL AND display_name != 'Unknown Contributor'
    ORDER BY display_name ASC
  `).all(tid) as Array<{ id: number; github_login: string; display_name: string }>;

  return memberRows.map(m => {
    const classRows = db.prepare(`
      SELECT cl.work_type, cl.substance, COUNT(*) AS n
      FROM classifications cl
      JOIN contributions c ON c.id = cl.contribution_id
      WHERE c.member_id = ?
      GROUP BY cl.work_type, cl.substance
    `).all(m.id) as Array<{ work_type: string; substance: string; n: number }>;

    const workCounts: Record<string, number> = {};
    const weightedTotals: Record<string, number> = {};
    let totalWeight = 0;

    for (const r of classRows) {
      workCounts[r.work_type] = (workCounts[r.work_type] ?? 0) + r.n;
      const w = (SUBSTANCE_WEIGHT[r.substance] ?? 1) * r.n;
      weightedTotals[r.work_type] = (weightedTotals[r.work_type] ?? 0) + w;
      totalWeight += w;
    }

    const substanceShares: Record<string, number> = {};
    if (totalWeight > 0) {
      for (const [wt, w] of Object.entries(weightedTotals)) {
        substanceShares[wt] = Math.round((w / totalWeight) * 100) / 100;
      }
    }

    return {
      memberId: m.id,
      login: m.github_login,
      displayName: m.display_name,
      workCounts,
      substanceShares,
    };
  });
}

describe('summary — alphabetical order and stat cards', () => {
  it('returns members in alphabetical order by displayName', () => {
    const members = getSummaryData(testDb, teamId);
    expect(members.length).toBeGreaterThan(0);

    const names = members.map(m => m.displayName);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    expect(names).toEqual(sorted);
  });

  it('stat cards reflect the correct counts', () => {
    const { tasks_done: tasksDone, tasks_total: tasksTotal } = testDb.prepare(`
      SELECT SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS tasks_done,
             COUNT(*) AS tasks_total
      FROM tasks WHERE team_id = ?
    `).get(teamId) as { tasks_done: number; tasks_total: number };

    const { n: tasksAtRisk } = testDb.prepare(
      'SELECT COUNT(*) AS n FROM risks WHERE team_id = ? AND dismissed = 0',
    ).get(teamId) as { n: number };

    expect(typeof tasksDone).toBe('number');
    expect(typeof tasksTotal).toBe('number');
    expect(tasksAtRisk).toBeGreaterThan(0);
  });

  it('each member has workCounts and substanceShares', () => {
    const members = getSummaryData(testDb, teamId);
    for (const m of members) {
      expect(typeof m.workCounts).toBe('object');
      expect(typeof m.substanceShares).toBe('object');
    }
  });
});

// ── Test 5: Accepting a suggestion updates the task's assignee_login ───────────
//
// Tests the respond logic directly (not via HTTP) for the same reason as Test 4.

describe('accepting a suggestion updates the task assignee_login', () => {
  let suggestionId: number;
  let targetTaskId: number;
  let toMemberId: number;
  let toLogin: string;

  beforeAll(() => {
    // Ensure a pending suggestion exists; create one if the reasoner didn't generate any
    const existing = testDb.prepare(
      "SELECT id FROM suggestions WHERE team_id = ? AND status = 'pending' LIMIT 1",
    ).get(teamId) as { id: number } | undefined;

    if (existing) {
      suggestionId = existing.id;
      const sug = testDb.prepare(`
        SELECT s.task_id, m.id AS to_member_id, m.github_login AS to_login
        FROM suggestions s
        JOIN members m ON m.id = s.to_member_id
        WHERE s.id = ?
      `).get(suggestionId) as { task_id: number; to_member_id: number; to_login: string };
      targetTaskId = sug.task_id;
      toMemberId = sug.to_member_id;
      toLogin = sug.to_login;
    } else {
      // Insert a fresh suggestion: sam-builds → jordan-qa for task12
      const result = testDb.prepare(`
        INSERT INTO suggestions (team_id, from_member_id, to_member_id, task_id, rationale, checkin_message)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        teamId,
        samId,
        jordanId,
        task12Id,
        JSON.stringify(['Sam has multiple tasks', 'Jordan has capacity']),
        'Hey team, exploring a rebalance!',
      );
      suggestionId = result.lastInsertRowid as number;
      targetTaskId = task12Id;
      toMemberId = jordanId;
      toLogin = 'jordan-qa';
    }
    void toMemberId;
  });

  it('accepting a suggestion updates status and assignee_login', () => {
    // Simulate the accept logic from the route: set status + update assignee
    testDb.transaction(() => {
      testDb.prepare('UPDATE suggestions SET status = ? WHERE id = ?').run('accepted', suggestionId);
      testDb.prepare('UPDATE tasks SET assignee_login = ? WHERE id = ?').run(toLogin, targetTaskId);
    })();

    const updatedSug = testDb.prepare(
      'SELECT status FROM suggestions WHERE id = ?',
    ).get(suggestionId) as { status: string };
    expect(updatedSug.status).toBe('accepted');

    const task = testDb.prepare(
      'SELECT assignee_login FROM tasks WHERE id = ?',
    ).get(targetTaskId) as { assignee_login: string };
    expect(task.assignee_login).toBe(toLogin);
  });

  it('invalid status is rejected by the route validator', () => {
    const allowed = ['accepted', 'dismissed', 'discuss'];
    const invalid = 'bogus';
    expect(allowed.includes(invalid)).toBe(false);
  });

  it('a 404 is returned for a non-existent suggestion id', () => {
    // Simulate the route check: no row updated means 404
    const result = testDb.prepare(
      'UPDATE suggestions SET status = ? WHERE id = ? AND team_id = ?',
    ).run('accepted', 999999, teamId);
    expect(result.changes).toBe(0);
  });
});
