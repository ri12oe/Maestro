/**
 * seed-startup.test.ts — SEED_DEMO=1 seeds StudyBuddy on the server's database.
 *
 * The temp database already holds another team. Startup seeding runs twice.
 * That creates one StudyBuddy team (4 members, a high risk on #12, and the
 * pending #14 swap from Sam to Jordan) and leaves the other team as it was.
 * AI_PROVIDER stays grok around the call. The insert itself uses the mock
 * provider, so nothing is fetched.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';

const TODAY = new Date('2031-01-15T12:00:00.000Z');
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(TODAY);

const tmpDir = mkdtempSync(join(tmpdir(), 'seed-startup-'));
process.env.DB_PATH = join(tmpDir, 'startup.db');
process.env.AI_PROVIDER = 'grok';
process.env.XAI_API_KEY = '';
process.env.GROK_MODEL = '';
process.env.SEED_DEMO = '';

const fetchSpy = vi.spyOn(globalThis, 'fetch');

const { default: db } = await import('../db/client.js');
const { seedDemoOnStartup } = await import('../db/seed.js');

interface OtherTeam {
  team: { name: string; repo_owner: string; repo_name: string; is_demo: number; deadline: string | null };
  members: Array<{ github_login: string; email: string; display_name: string }>;
  tasks: Array<{ github_issue_number: number; title: string; status: string; assignee_login: string }>;
  contributions: Array<{ github_sha: string; title: string }>;
  risks: Array<{ level: string; description: string; dismissed: number }>;
}

function otherTeam(teamId: number): OtherTeam {
  return {
    team: db.prepare(
      'SELECT name, repo_owner, repo_name, is_demo, deadline FROM teams WHERE id = ?',
    ).get(teamId) as OtherTeam['team'],
    members: db.prepare(
      'SELECT github_login, email, display_name FROM members WHERE team_id = ? ORDER BY github_login',
    ).all(teamId) as OtherTeam['members'],
    tasks: db.prepare(
      'SELECT github_issue_number, title, status, assignee_login FROM tasks WHERE team_id = ? ORDER BY github_issue_number',
    ).all(teamId) as OtherTeam['tasks'],
    contributions: db.prepare(
      'SELECT github_sha, title FROM contributions WHERE team_id = ? ORDER BY github_sha',
    ).all(teamId) as OtherTeam['contributions'],
    risks: db.prepare(
      'SELECT level, description, dismissed FROM risks WHERE team_id = ? ORDER BY id',
    ).all(teamId) as OtherTeam['risks'],
  };
}

afterAll(() => {
  vi.useRealTimers();
  fetchSpy.mockRestore();
  db.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
});

describe('SEED_DEMO on startup', () => {
  it('creates one StudyBuddy team beside an existing team, and a second run changes nothing', async () => {
    const otherId = db.prepare(
      `INSERT INTO teams (name, repo_owner, repo_name, is_demo, deadline)
       VALUES ('Capstone', 'real-org', 'real-repo', 0, '2031-06-01')`,
    ).run().lastInsertRowid as number;
    const memberId = db.prepare(
      `INSERT INTO members (team_id, github_login, email, display_name)
       VALUES (?, 'ada', 'ada@real.dev', 'Ada Lovelace')`,
    ).run(otherId).lastInsertRowid as number;
    db.prepare(
      `INSERT INTO tasks (team_id, github_issue_number, title, status, due_date, assignee_login)
       VALUES (?, 3, 'Keep this task', 'open', '2031-06-01', 'ada')`,
    ).run(otherId);
    db.prepare(
      `INSERT INTO contributions (team_id, member_id, source, github_sha, title, authored_at)
       VALUES (?, ?, 'commit', 'real0001aaaa', 'Initial commit', '2031-01-01T00:00:00Z')`,
    ).run(otherId, memberId);
    const taskId = (db.prepare(
      'SELECT id FROM tasks WHERE team_id = ?',
    ).get(otherId) as { id: number }).id;
    db.prepare(
      `INSERT INTO risks (team_id, task_id, level, description, evidence)
       VALUES (?, ?, 'low', 'Leave this risk alone', '[]')`,
    ).run(otherId, taskId);

    const before = otherTeam(otherId);
    expect(before.members).toHaveLength(1);
    expect(before.risks).toEqual([{ level: 'low', description: 'Leave this risk alone', dismissed: 0 }]);

    await seedDemoOnStartup(db, TODAY);
    expect(db.prepare("SELECT COUNT(*) AS n FROM teams WHERE name = 'StudyBuddy'").get()).toEqual({ n: 0 });
    expect(otherTeam(otherId)).toEqual(before);
    expect(process.env.AI_PROVIDER).toBe('grok');

    process.env.SEED_DEMO = '1';
    await seedDemoOnStartup(db, TODAY);

    const study = db.prepare(
      "SELECT id, is_demo FROM teams WHERE name = 'StudyBuddy'",
    ).all() as Array<{ id: number; is_demo: number }>;
    expect(study).toEqual([{ id: expect.any(Number), is_demo: 1 }]);
    const studyId = study[0].id;
    expect(studyId).not.toBe(otherId);

    const logins = (db.prepare(
      'SELECT github_login FROM members WHERE team_id = ? ORDER BY github_login',
    ).all(studyId) as Array<{ github_login: string }>).map(row => row.github_login);
    expect(logins).toEqual(['jordan-qa', 'priya-code', 'rio-dev', 'sam-builds']);

    const auth = db.prepare(`
      SELECT r.level AS level
      FROM risks r
      JOIN tasks t ON t.id = r.task_id
      WHERE r.team_id = ? AND t.github_issue_number = 12 AND r.dismissed = 0
    `).get(studyId) as { level: string };
    expect(auth.level).toBe('high');

    const swap = db.prepare(`
      SELECT m1.github_login AS from_login, m2.github_login AS to_login,
             t.github_issue_number AS n, s.status AS status
      FROM suggestions s
      JOIN members m1 ON m1.id = s.from_member_id
      JOIN members m2 ON m2.id = s.to_member_id
      JOIN tasks t ON t.id = s.task_id
      WHERE s.team_id = ? AND t.github_issue_number = 14
    `).all(studyId);
    expect(swap).toEqual([{ from_login: 'sam-builds', to_login: 'jordan-qa', n: 14, status: 'pending' }]);

    const versions = db.prepare(`
      SELECT DISTINCT cl.model_version AS v
      FROM classifications cl
      JOIN contributions c ON c.id = cl.contribution_id
      WHERE c.team_id = ?
      ORDER BY v
    `).all(studyId);
    expect(versions).toEqual([{ v: 'mock:prompt-v2' }]);

    const seeded = {
      teams: (db.prepare('SELECT COUNT(*) AS n FROM teams').get() as { n: number }).n,
      studyTeams: (db.prepare("SELECT COUNT(*) AS n FROM teams WHERE name = 'StudyBuddy'").get() as { n: number }).n,
      members: (db.prepare('SELECT COUNT(*) AS n FROM members WHERE team_id = ?').get(studyId) as { n: number }).n,
      contributions: (db.prepare('SELECT COUNT(*) AS n FROM contributions WHERE team_id = ?').get(studyId) as { n: number }).n,
      suggestions: (db.prepare('SELECT COUNT(*) AS n FROM suggestions WHERE team_id = ?').get(studyId) as { n: number }).n,
    };
    expect(seeded.teams).toBe(2);
    expect(seeded.studyTeams).toBe(1);
    expect(seeded.members).toBe(4);
    expect(seeded.contributions).toBeGreaterThanOrEqual(20);
    expect(otherTeam(otherId)).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(process.env.AI_PROVIDER).toBe('grok');

    await seedDemoOnStartup(db, TODAY);

    expect(db.prepare("SELECT id FROM teams WHERE name = 'StudyBuddy'").all()).toEqual([{ id: studyId }]);
    expect((db.prepare('SELECT COUNT(*) AS n FROM teams').get() as { n: number }).n).toBe(seeded.teams);
    expect((db.prepare('SELECT COUNT(*) AS n FROM members WHERE team_id = ?').get(studyId) as { n: number }).n).toBe(4);
    expect((db.prepare('SELECT COUNT(*) AS n FROM contributions WHERE team_id = ?').get(studyId) as { n: number }).n).toBe(seeded.contributions);
    expect((db.prepare('SELECT COUNT(*) AS n FROM suggestions WHERE team_id = ?').get(studyId) as { n: number }).n).toBe(seeded.suggestions);
    expect(otherTeam(otherId)).toEqual(before);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(process.env.AI_PROVIDER).toBe('grok');
  }, 30_000);

  it('logs a seed error and does not throw', async () => {
    process.env.SEED_DEMO = '1';
    const closed = new Database(':memory:');
    closed.close();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(seedDemoOnStartup(closed, TODAY)).resolves.toBeUndefined();
    expect(errSpy.mock.calls.some(args => String(args[0]).includes('SEED_DEMO failed'))).toBe(true);
    expect(process.env.AI_PROVIDER).toBe('grok');
    errSpy.mockRestore();
  });
});
