/**
 * seed-scenario.test.ts — Milestone 4: the StudyBuddy seed still builds the demo.
 *
 * Seeds a temp database, runs the classifier and reasoner with AI_PROVIDER=mock,
 * and checks the scenario the dashboard needs. `today` is fixed so the result
 * does not depend on the calendar day. A stored team deadline (null, then a
 * near date, then cleared) and accept/undo of the suggestion must leave that
 * scenario in place. Seeding again must not insert a second team.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import request from 'supertest';

// Not the wall clock. Commit dates, due dates, and Date.now() (mock risk text)
// are pinned to this instant so the scenario does not depend on the calendar day.
const TODAY = new Date('2031-01-15T12:00:00.000Z');
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(TODAY);

const tmpDir = mkdtempSync(join(tmpdir(), 'seed-scenario-'));
process.env.DB_PATH = join(tmpDir, 'seed.db');
process.env.AI_PROVIDER = 'mock';

const { seedStudyBuddy } = await import('../db/seed.js');
const { default: db } = await import('../db/client.js');
const { default: suggestionsRouter } = await import('../routes/suggestions.js');
const { runReasoner } = await import('../ai/reasoner.js');

const app = express();
app.use(express.json());
app.use('/api/teams/:teamId/suggestions', suggestionsRouter);

function shift(days: number, dateOnly: boolean): string {
  const d = new Date(TODAY.getTime());
  d.setDate(d.getDate() + days);
  return dateOnly ? d.toISOString().slice(0, 10) : d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

interface ScenarioCounts {
  teams: number;
  members: number;
  contributions: number;
  stalledTasks: number;
  overloadedMembers: number;
  highRisks: number;
  suggestions: number;
}

/** Same stall and overload rules the reasoner uses, including a stored deadline. */
function scenarioCounts(): ScenarioCounts {
  const teams = (
    db.prepare("SELECT COUNT(*) AS n FROM teams WHERE name = 'StudyBuddy' AND is_demo = 1").get() as { n: number }
  ).n;
  const team = db.prepare(
    "SELECT id, deadline FROM teams WHERE name = 'StudyBuddy' AND is_demo = 1",
  ).get() as { id: number; deadline: string | null } | undefined;
  if (!team) {
    return { teams, members: 0, contributions: 0, stalledTasks: 0, overloadedMembers: 0, highRisks: 0, suggestions: 0 };
  }

  const members = (db.prepare('SELECT COUNT(*) AS n FROM members WHERE team_id = ?').get(team.id) as { n: number }).n;
  const contributions = (
    db.prepare('SELECT COUNT(*) AS n FROM contributions WHERE team_id = ?').get(team.id) as { n: number }
  ).n;

  const openTasks = db.prepare(
    `SELECT id, due_date, assignee_login FROM tasks WHERE team_id = ? AND status = 'open'`,
  ).all(team.id) as Array<{ id: number; due_date: string | null; assignee_login: string | null }>;

  const latestActivity = db.prepare(`
    SELECT c.authored_at AS authored_at
    FROM task_matches tm
    JOIN contributions c ON c.id = tm.contribution_id
    WHERE tm.task_id = ?
    ORDER BY c.authored_at DESC
    LIMIT 1
  `);

  const stalledRiskIds = new Set<number>();
  let stalledTasks = 0;
  for (const task of openTasks) {
    const recent = latestActivity.get(task.id) as { authored_at: string } | undefined;
    const idleDays = recent ? (TODAY.getTime() - new Date(recent.authored_at).getTime()) / 86_400_000 : Infinity;
    if (idleDays <= 5) continue;
    stalledTasks++;
    const dueDate = team.deadline ?? task.due_date;
    if (dueDate) {
      const daysUntilDue = (new Date(dueDate).getTime() - TODAY.getTime()) / 86_400_000;
      if (daysUntilDue <= 14) stalledRiskIds.add(task.id);
    } else if (idleDays >= 14) {
      stalledRiskIds.add(task.id);
    }
  }

  const perMember = new Map<string, number[]>();
  for (const task of openTasks) {
    if (!task.assignee_login) continue;
    const ids = perMember.get(task.assignee_login) ?? [];
    ids.push(task.id);
    perMember.set(task.assignee_login, ids);
  }
  const logins = db.prepare(
    'SELECT github_login FROM members WHERE team_id = ? AND github_login IS NOT NULL',
  ).all(team.id) as Array<{ github_login: string }>;
  const someoneHasNoTasks = logins.some(m => (perMember.get(m.github_login)?.length ?? 0) === 0);
  let overloadedMembers = 0;
  if (someoneHasNoTasks) {
    for (const ids of perMember.values()) {
      if (ids.length >= 2 && ids.some(id => stalledRiskIds.has(id))) overloadedMembers++;
    }
  }

  const highRisks = (
    db.prepare("SELECT COUNT(*) AS n FROM risks WHERE team_id = ? AND level = 'high' AND dismissed = 0").get(team.id) as { n: number }
  ).n;
  const suggestions = (
    db.prepare("SELECT COUNT(*) AS n FROM suggestions WHERE team_id = ? AND status = 'pending'").get(team.id) as { n: number }
  ).n;

  return { teams, members, contributions, stalledTasks, overloadedMembers, highRisks, suggestions };
}

function expectScenario(counts: ScenarioCounts): void {
  expect(counts.teams).toBe(1);
  expect(counts.members).toBe(4);
  expect(counts.contributions).toBeGreaterThanOrEqual(20);
  expect(counts.stalledTasks).toBeGreaterThanOrEqual(1);
  expect(counts.overloadedMembers).toBeGreaterThanOrEqual(1);
  expect(counts.highRisks).toBeGreaterThanOrEqual(1);
  expect(counts.suggestions).toBeGreaterThanOrEqual(1);
}

let teamId = 0;

beforeAll(async () => {
  const seeded = await seedStudyBuddy(TODAY);
  expect(seeded.skipped).toBe(false);
  teamId = seeded.teamId;
}, 30_000);

afterAll(() => {
  vi.useRealTimers();
  db.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
});

describe('StudyBuddy demo scenario', () => {
  it('meets every demo requirement after the mock pipeline', () => {
    const counts = scenarioCounts();
    expectScenario(counts);

    const totalTeams = (db.prepare('SELECT COUNT(*) AS n FROM teams').get() as { n: number }).n;
    expect(totalTeams).toBe(1);

    const logins = (db.prepare(
      'SELECT github_login FROM members WHERE team_id = ? ORDER BY github_login',
    ).all(teamId) as Array<{ github_login: string }>).map(r => r.github_login);
    expect(logins).toEqual(['jordan-qa', 'priya-code', 'rio-dev', 'sam-builds']);

    // Dates come from the injected clock, not from whenever the test runs.
    const auth = db.prepare(
      "SELECT due_date FROM tasks WHERE team_id = ? AND github_issue_number = 12",
    ).get(teamId) as { due_date: string };
    expect(auth.due_date).toBe(shift(7, true));
    const lastAuth = db.prepare(
      "SELECT authored_at FROM contributions WHERE github_sha = 'rio0008hhhh'",
    ).get() as { authored_at: string };
    expect(lastAuth.authored_at).toBe(shift(-7, false));

    // No stored deadline: the reasoner uses each task's milestone date.
    const deadline = (db.prepare('SELECT deadline FROM teams WHERE id = ?').get(teamId) as { deadline: string | null }).deadline;
    expect(deadline).toBeNull();
  });

  it('does not insert a second demo team when seeded again', async () => {
    const before = (db.prepare('SELECT COUNT(*) AS n FROM contributions').get() as { n: number }).n;
    const again = await seedStudyBuddy(TODAY);
    expect(again.skipped).toBe(true);
    expect(again.teamId).toBe(teamId);
    expect((db.prepare('SELECT COUNT(*) AS n FROM teams').get() as { n: number }).n).toBe(1);
    expect((db.prepare('SELECT COUNT(*) AS n FROM contributions').get() as { n: number }).n).toBe(before);
    expectScenario(scenarioCounts());
  });

  it('still meets the scenario after a suggestion is accepted and undone', async () => {
    const pending = db.prepare(
      "SELECT id, task_id FROM suggestions WHERE team_id = ? AND status = 'pending' ORDER BY id LIMIT 1",
    ).get(teamId) as { id: number; task_id: number };
    const before = (db.prepare('SELECT assignee_login FROM tasks WHERE id = ?').get(pending.task_id) as { assignee_login: string }).assignee_login;

    const accepted = await request(app)
      .post(`/api/teams/${teamId}/suggestions/${pending.id}/respond`)
      .send({ status: 'accepted' });
    expect(accepted.status).toBe(200);
    const moved = (db.prepare('SELECT assignee_login FROM tasks WHERE id = ?').get(pending.task_id) as { assignee_login: string }).assignee_login;
    expect(moved).not.toBe(before);

    const undone = await request(app)
      .post(`/api/teams/${teamId}/suggestions/${pending.id}/respond`)
      .send({ status: 'pending' });
    expect(undone.status).toBe(200);
    const restored = (db.prepare('SELECT assignee_login FROM tasks WHERE id = ?').get(pending.task_id) as { assignee_login: string }).assignee_login;
    expect(restored).toBe(before);
    expect((db.prepare('SELECT status FROM suggestions WHERE id = ?').get(pending.id) as { status: string }).status).toBe('pending');

    expectScenario(scenarioCounts());
  });

  it('still meets the scenario when a near deadline is stored and then cleared', async () => {
    // A deadline this close also flags Priya's quiet task, so the reasoner
    // keeps one swap and rejects a second that would pile both onto Jordan.
    const near = shift(7, true);
    db.prepare('UPDATE teams SET deadline = ? WHERE id = ?').run(near, teamId);
    await runReasoner(teamId, TODAY);
    expect((db.prepare('SELECT deadline FROM teams WHERE id = ?').get(teamId) as { deadline: string }).deadline).toBe(near);
    expectScenario(scenarioCounts());

    db.prepare('UPDATE teams SET deadline = NULL WHERE id = ?').run(teamId);
    await runReasoner(teamId, TODAY);
    expect((db.prepare('SELECT deadline FROM teams WHERE id = ?').get(teamId) as { deadline: string | null }).deadline).toBeNull();
    expectScenario(scenarioCounts());
  });
});
