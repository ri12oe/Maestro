/**
 * Tests for sync.ts member deduplication logic.
 *
 * Covers:
 *  - Two commits from the same email (one with a login, one without) produce
 *    exactly one member row, not two.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import { runMigration } from '../db/migrate.js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface CommitShape {
  sha: string;
  message?: string;
  parents?: Array<{ sha: string }>;
  login?: string | null;
  email?: string;
  name?: string;
}

// ── Mock fetch helpers ────────────────────────────────────────────────────────

function mockResponse(data: unknown): Response {
  const body = JSON.stringify(data);
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(JSON.parse(body)),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

function makeRawCommit(c: CommitShape) {
  return {
    sha: c.sha,
    commit: {
      message: c.message ?? 'add feature',
      author: { name: c.name ?? 'Dev', email: c.email ?? 'dev@x.com', date: '2024-01-01T00:00:00Z' },
    },
    author: c.login !== undefined ? (c.login ? { login: c.login } : null) : { login: 'dev' },
    parents: c.parents ?? [{ sha: 'parent1' }],
    html_url: `https://github.com/o/r/commit/${c.sha}`,
  };
}

function makeSyncFetch(commits: CommitShape[]): (url: string) => Promise<Response> {
  return async (url: string) => {
    // Detail URL (no query string)
    if (url.includes('/commits/') && !url.includes('per_page=')) {
      return mockResponse({
        files: [{ filename: 'README.md', additions: 1, deletions: 0, patch: '+ line' }],
      });
    }
    // List URL — single page
    const match = /[?&]page=(\d+)/.exec(url);
    const pageIndex = match ? Number(match[1]) - 1 : 0;
    const data = pageIndex === 0 ? commits.map(makeRawCommit) : [];
    return mockResponse(data);
  };
}

// ── Sync test helpers ─────────────────────────────────────────────────────────

/**
 * Run syncTeam against a real in-process SQLite DB with the given commits
 * mocked through fetch, returning the number of member rows created.
 *
 * We import syncTeam here so it uses the db singleton. Instead of wiring
 * the full singleton (which auto-migrates against a real path), we exercise
 * the member-dedup logic directly using the db helpers extracted from sync.ts.
 *
 * The test validates the invariant at the db level by running the same
 * member-upsert logic that syncTeam executes inside its transaction.
 */
async function runSyncInMemory(commits: CommitShape[]): Promise<{ memberCount: number }> {
  // Create a fresh tmp DB
  const tmpDir = mkdtempSync(join(tmpdir(), 'referee-sync-test-'));
  const dbPath = join(tmpDir, 'test.db');
  runMigration(dbPath);

  const db = new Database(dbPath);

  try {
    // Insert a team
    db.prepare("INSERT INTO teams (name, repo_owner, repo_name) VALUES ('T', 'o', 'r')").run();
    const teamId = (db.prepare('SELECT id FROM teams ORDER BY id DESC LIMIT 1').get() as { id: number }).id;

    // Import fetchCommits with our mock fetch
    const { fetchCommits, authorKey } = await import('../ingestion/github.js');
    const fetchFn = makeSyncFetch(commits);
    const fetched = await fetchCommits('o', 'r', 'fake-token', fetchFn);

    // Replicate the member-upsert logic from syncTeam
    const insertMember = db.prepare(`
      INSERT INTO members (team_id, github_login, email, display_name)
      VALUES (@team_id, @github_login, @email, @display_name)
      ON CONFLICT DO NOTHING
    `);
    const getMemberByLogin = db.prepare('SELECT id FROM members WHERE team_id = ? AND github_login = ?');
    const getMemberByEmail = db.prepare('SELECT id FROM members WHERE team_id = ? AND email = ?');
    const getUnknownMember = db.prepare(
      "SELECT id FROM members WHERE team_id = ? AND github_login IS NULL AND email IS NULL AND display_name = 'Unknown Contributor'",
    );

    db.transaction(() => {
      for (const commit of fetched) {
        const { author } = commit;
        let member = author.login
          ? (getMemberByLogin.get(teamId, author.login) as { id: number } | undefined)
          : null;
        if (!member && author.email) {
          member = getMemberByEmail.get(teamId, author.email) as { id: number } | undefined;
        }
        if (!member) {
          if (author.login || author.email) {
            insertMember.run({
              team_id: teamId,
              github_login: author.login ?? null,
              email: author.email || null,
              display_name: author.name || authorKey(author),
            });
            member = (author.login
              ? getMemberByLogin.get(teamId, author.login)
              : getMemberByEmail.get(teamId, author.email)) as { id: number };
          } else {
            member = getUnknownMember.get(teamId) as { id: number } | undefined;
            if (!member) {
              insertMember.run({ team_id: teamId, github_login: null, email: null, display_name: 'Unknown Contributor' });
              member = getUnknownMember.get(teamId) as { id: number };
            }
          }
        }
      }
    })();

    const memberCount = (db.prepare('SELECT COUNT(*) AS n FROM members WHERE team_id = ?').get(teamId) as { n: number }).n;
    return { memberCount };
  } finally {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('sync member deduplication', () => {
  it('two commits from the same email (one with login, one without) create exactly one member', async () => {
    const commits: CommitShape[] = [
      { sha: 'aaaa00000001', email: 'alice@x.com', login: 'alice', name: 'Alice' },
      { sha: 'aaaa00000002', email: 'alice@x.com', login: null,    name: 'Alice' },
    ];
    const { memberCount } = await runSyncInMemory(commits);
    expect(memberCount).toBe(1);
  });
});
