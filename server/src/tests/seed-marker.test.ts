/**
 * seed-marker.test.ts — the StudyBuddy seed commits with its done marker.
 *
 * A failure halfway through leaves no demo rows, and the next start inserts
 * the demo. A second successful run inserts nothing. A real team named
 * StudyBuddy is left alone. A database that already holds the old seed's
 * team (production's copy is id 3) gets the marker and is not seeded again.
 * Deleting the demo leaves the marker, so the team stays deleted.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { runMigration, STUDYBUDDY_DEMO_SLUG } from '../db/migrate.js';
import { demoCommitSha, seedDemo, seedDemoOnStartup } from '../db/seed.js';

const TODAY = new Date('2031-01-15T12:00:00.000Z');
const originalProvider = process.env.AI_PROVIDER;
process.env.AI_PROVIDER = 'mock';

const dirs: string[] = [];
const COUNT_TABLES = [
  'teams', 'members', 'tasks', 'contributions', 'classifications',
  'task_matches', 'risks', 'suggestions', 'demo_seed',
] as const;

afterAll(() => {
  if (originalProvider === undefined) delete process.env.AI_PROVIDER;
  else process.env.AI_PROVIDER = originalProvider;
  for (const dir of dirs) {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* the OS temp dir may already be gone */ }
  }
});

function openMigrated(): Database.Database {
  const dir = mkdtempSync(join(tmpdir(), 'seed-marker-'));
  dirs.push(dir);
  const path = join(dir, 'demo.db');
  runMigration(path);
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

function counts(db: Database.Database): Record<string, number> {
  const out: Record<string, number> = {};
  for (const table of COUNT_TABLES) {
    out[table] = (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  }
  return out;
}

describe('StudyBuddy seed marker', () => {
  it('rolls a mid-seed failure back, and the next startup inserts the demo', async () => {
    const db = openMigrated();
    const savedDemo = process.env.SEED_DEMO;
    const savedProvider = process.env.AI_PROVIDER;
    try {
      const teamId = db.prepare(
        `INSERT INTO teams (name, repo_owner, repo_name, is_demo)
         VALUES ('Capstone', 'real-org', 'real-repo', 0)`,
      ).run().lastInsertRowid as number;
      const memberId = db.prepare(
        `INSERT INTO members (team_id, github_login, email, display_name)
         VALUES (?, 'ada', 'ada@real.dev', 'Ada Lovelace')`,
      ).run(teamId).lastInsertRowid as number;
      // Last demo commit token. The seed inserts the team, the other commits,
      // and then this sha, which is already taken.
      db.prepare(
        `INSERT INTO contributions (team_id, member_id, source, github_sha, title, authored_at)
         VALUES (?, ?, 'commit', ?, 'Keep this commit', '2031-01-01T00:00:00Z')`,
      ).run(teamId, memberId, demoCommitSha('pri0006ffff'));

      const before = counts(db);
      process.env.SEED_DEMO = '1';
      process.env.AI_PROVIDER = 'grok';
      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      try {
        await expect(seedDemoOnStartup(db, TODAY)).resolves.toBeUndefined();
        const text = errSpy.mock.calls.map(args => args.map(String).join(' ')).join('\n');
        expect(text).toContain('[seed] StudyBuddy demo failed and was rolled back');
        expect(text).toContain('[seed] SEED_DEMO failed');
        expect(db.inTransaction).toBe(false);
        expect(counts(db)).toEqual(before);
        expect(process.env.AI_PROVIDER).toBe('grok');
      } finally {
        errSpy.mockRestore();
        logSpy.mockRestore();
      }

      db.prepare('DELETE FROM contributions WHERE github_sha = ?').run(demoCommitSha('pri0006ffff'));
      await seedDemoOnStartup(db, TODAY);

      const demo = db.prepare(
        `SELECT id, is_demo FROM teams
         WHERE repo_owner = 'studybuddy-org' AND repo_name = 'studybuddy-app'`,
      ).get() as { id: number; is_demo: number };
      expect(demo.is_demo).toBe(1);
      expect(db.prepare('SELECT team_id FROM demo_seed WHERE slug = ?').get(STUDYBUDDY_DEMO_SLUG))
        .toEqual({ team_id: demo.id });
      expect(db.prepare('SELECT name, is_demo FROM teams WHERE id = ?').get(teamId))
        .toEqual({ name: 'Capstone', is_demo: 0 });
      expect(db.prepare('SELECT team_id FROM contributions WHERE github_sha = ?').get(demoCommitSha('pri0006ffff')))
        .toEqual({ team_id: demo.id });
      expect(process.env.AI_PROVIDER).toBe('grok');
    } finally {
      if (savedDemo === undefined) delete process.env.SEED_DEMO;
      else process.env.SEED_DEMO = savedDemo;
      if (savedProvider === undefined) delete process.env.AI_PROVIDER;
      else process.env.AI_PROVIDER = savedProvider;
      db.close();
    }
  }, 30_000);

  it('a second run is a no-op, and deleting the demo leaves it deleted', async () => {
    const db = openMigrated();
    try {
      const first = await seedDemo(db, TODAY);
      expect(first.skipped).toBe(false);
      const before = counts(db);
      expect(db.prepare('SELECT team_id FROM demo_seed WHERE slug = ?').get(STUDYBUDDY_DEMO_SLUG))
        .toEqual({ team_id: first.teamId });

      const shas = db.prepare(
        `SELECT github_sha FROM contributions WHERE team_id = ? AND source = 'commit'`,
      ).all(first.teamId) as Array<{ github_sha: string }>;
      expect(shas.length).toBeGreaterThanOrEqual(20);
      expect(shas.every(row => row.github_sha.startsWith('demo:studybuddy:'))).toBe(true);
      expect(shas.every(row => !/^[0-9a-f]{40}$/i.test(row.github_sha))).toBe(true);
      expect(shas.some(row => row.github_sha === demoCommitSha('rio0008hhhh'))).toBe(true);

      const second = await seedDemo(db, TODAY);
      expect(second).toEqual({ skipped: true, teamId: first.teamId });
      expect(counts(db)).toEqual(before);

      db.prepare('DELETE FROM teams WHERE id = ?').run(first.teamId);
      expect(db.prepare('SELECT id FROM teams WHERE id = ?').get(first.teamId)).toBeUndefined();
      expect(db.prepare('SELECT team_id FROM demo_seed WHERE slug = ?').get(STUDYBUDDY_DEMO_SLUG))
        .toEqual({ team_id: first.teamId });

      const third = await seedDemo(db, TODAY);
      expect(third).toEqual({ skipped: true, teamId: first.teamId });
      expect(db.prepare("SELECT COUNT(*) AS n FROM teams WHERE name = 'StudyBuddy'").get()).toEqual({ n: 0 });
      expect(counts(db).demo_seed).toBe(1);
    } finally {
      db.close();
    }
  }, 30_000);

  it('seeds beside a real team that is named StudyBuddy', async () => {
    const db = openMigrated();
    try {
      const realId = db.prepare(
        `INSERT INTO teams (name, repo_owner, repo_name, is_demo)
         VALUES ('StudyBuddy', 'real-org', 'capstone', 0)`,
      ).run().lastInsertRowid as number;
      const memberId = db.prepare(
        `INSERT INTO members (team_id, github_login, email, display_name)
         VALUES (?, 'ada', 'ada@real.dev', 'Ada Lovelace')`,
      ).run(realId).lastInsertRowid as number;
      const realSha = 'a'.repeat(40);
      db.prepare(
        `INSERT INTO contributions (team_id, member_id, source, github_sha, title, authored_at)
         VALUES (?, ?, 'commit', ?, 'Real commit', '2031-01-01T00:00:00Z')`,
      ).run(realId, memberId, realSha);

      const seeded = await seedDemo(db, TODAY);
      expect(seeded.skipped).toBe(false);
      expect(seeded.teamId).not.toBe(realId);

      expect(db.prepare(
        'SELECT id, name, repo_owner, repo_name, is_demo FROM teams ORDER BY id',
      ).all()).toEqual([
        { id: realId, name: 'StudyBuddy', repo_owner: 'real-org', repo_name: 'capstone', is_demo: 0 },
        { id: seeded.teamId, name: 'StudyBuddy', repo_owner: 'studybuddy-org', repo_name: 'studybuddy-app', is_demo: 1 },
      ]);
      expect(db.prepare('SELECT team_id FROM demo_seed WHERE slug = ?').get(STUDYBUDDY_DEMO_SLUG))
        .toEqual({ team_id: seeded.teamId });
      expect(db.prepare('SELECT team_id, title FROM contributions WHERE github_sha = ?').get(realSha))
        .toEqual({ team_id: realId, title: 'Real commit' });
      expect(db.prepare('SELECT COUNT(*) AS n FROM members WHERE team_id = ?').get(realId)).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  }, 30_000);

  it('keeps an existing old-style StudyBuddy demo, including production id 3', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-upgrade-'));
    dirs.push(dir);
    const path = join(dir, 'prod.db');
    // Migrations through 007 have run on an empty file, which is the state
    // before the old demo is restored into this test. Drop the 007 record so
    // the next migrate sees the team the way a deploy sees production.
    runMigration(path);
    const setup = new Database(path);
    setup.pragma('foreign_keys = ON');
    setup.prepare("DELETE FROM schema_migrations WHERE name = 'migration_007_demo_seed_marker'").run();
    setup.prepare(
      `INSERT INTO teams (name, repo_owner, repo_name, is_demo) VALUES ('Alpha', 'acme', 'alpha', 0)`,
    ).run();
    setup.prepare(
      `INSERT INTO teams (name, repo_owner, repo_name, is_demo) VALUES ('Beta', 'acme', 'beta', 0)`,
    ).run();
    const demoId = setup.prepare(
      `INSERT INTO teams (name, repo_owner, repo_name, is_demo)
       VALUES ('StudyBuddy', 'studybuddy-org', 'studybuddy-app', 1)`,
    ).run().lastInsertRowid as number;
    expect(demoId).toBe(3);
    const realNamedId = setup.prepare(
      `INSERT INTO teams (name, repo_owner, repo_name, is_demo)
       VALUES ('StudyBuddy', 'real-org', 'capstone', 0)`,
    ).run().lastInsertRowid as number;
    expect(realNamedId).toBe(4);
    const memberId = setup.prepare(
      `INSERT INTO members (team_id, github_login, email, display_name)
       VALUES (?, 'rio-dev', 'rio@studybuddy.dev', 'Rio Chen')`,
    ).run(demoId).lastInsertRowid as number;
    setup.prepare(
      `INSERT INTO contributions (team_id, member_id, source, github_sha, title, authored_at)
       VALUES (?, ?, 'commit', 'rio0008hhhh', 'Implement redirect after auth flow completes', '2031-01-08T12:00:00Z')`,
    ).run(demoId, memberId);
    setup.close();

    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    try {
      runMigration(path);
    } finally {
      spy.mockRestore();
    }
    expect(logs.some(line => line.includes('Recognized existing StudyBuddy demo (id=3)'))).toBe(true);

    const db = new Database(path);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    try {
      expect(db.prepare('SELECT team_id FROM demo_seed WHERE slug = ?').get(STUDYBUDDY_DEMO_SLUG))
        .toEqual({ team_id: 3 });
      expect(db.prepare('SELECT is_demo FROM teams WHERE id = 4').get()).toEqual({ is_demo: 0 });

      const seeded = await seedDemo(db, TODAY);
      expect(seeded).toEqual({ skipped: true, teamId: 3 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM teams').get()).toEqual({ n: 4 });
      expect(db.prepare("SELECT COUNT(*) AS n FROM teams WHERE repo_name = 'studybuddy-app'").get()).toEqual({ n: 1 });
      expect(db.prepare('SELECT github_sha FROM contributions').all()).toEqual([{ github_sha: 'rio0008hhhh' }]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM contributions WHERE github_sha LIKE 'demo:studybuddy:%'").get())
        .toEqual({ n: 0 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM members').get()).toEqual({ n: 1 });
      expect(db.prepare('SELECT is_demo, name FROM teams WHERE id = 3').get())
        .toEqual({ is_demo: 1, name: 'StudyBuddy' });

      // The marker can also be written by the seed itself when migration 007
      // already ran before this team was present. Dropping the marker and
      // seeding again adopts team 3.
      db.prepare('DELETE FROM demo_seed').run();
      const adopted = await seedDemo(db, TODAY);
      expect(adopted).toEqual({ skipped: true, teamId: 3 });
      expect(db.prepare('SELECT COUNT(*) AS n FROM teams').get()).toEqual({ n: 4 });
      expect(db.prepare('SELECT github_sha FROM contributions').all()).toEqual([{ github_sha: 'rio0008hhhh' }]);
      expect(db.prepare('SELECT team_id FROM demo_seed WHERE slug = ?').get(STUDYBUDDY_DEMO_SLUG))
        .toEqual({ team_id: 3 });
    } finally {
      db.close();
    }
  });
});
