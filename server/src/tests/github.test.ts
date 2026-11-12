/**
 * Tests for the GitHub ingestion mapping logic (no real HTTP calls).
 *
 * Covers:
 *  - authorKey() returns login when present
 *  - authorKey() falls back to email when login is absent
 *  - authorKey() returns 'unknown' when both are absent
 *  - fetchCommits() skips merge commits (parentCount > 1)
 *  - fetchCommits() skips commits whose message matches the merge pattern
 *  - fetchCommits() never throws when commit.author is null (no GitHub account)
 *  - fetchIssues() skips pull requests (pull_request key present)
 *  - fetchIssues() maps milestone.due_on to dueDate
 */

import { describe, it, expect } from 'vitest';
import { authorKey, fetchCommits, fetchIssues, PATCH_LINE_LIMIT } from '../ingestion/github.ts';

// ── authorKey ────────────────────────────────────────────────────────────────

describe('authorKey', () => {
  it('returns login when login is present', () => {
    expect(authorKey({ login: 'alice', email: 'a@x.com', name: 'Alice', date: '' })).toBe('alice');
  });

  it('falls back to email when login is null', () => {
    expect(authorKey({ login: null, email: 'b@x.com', name: 'Bob', date: '' })).toBe('b@x.com');
  });

  it('returns "unknown" when both login and email are absent', () => {
    expect(authorKey({ login: null, email: '', name: '', date: '' })).toBe('unknown');
  });
});

// ── helpers to build mock fetch responses ────────────────────────────────────

function makeCommit(overrides: {
  sha?: string;
  message?: string;
  parents?: Array<{ sha: string }>;
  author?: { login: string } | null;
  commitAuthor?: { name: string; email: string; date: string } | null;
}) {
  return {
    sha: overrides.sha ?? 'abc123def456',
    commit: {
      message: overrides.message ?? 'add feature',
      author: overrides.commitAuthor ?? { name: 'Dev', email: 'dev@x.com', date: '2024-01-01T00:00:00Z' },
    },
    author: overrides.author !== undefined ? overrides.author : { login: 'dev' },
    parents: overrides.parents ?? [{ sha: 'parent1' }],
    html_url: 'https://github.com/o/r/commit/abc123def456',
  };
}

function makeIssue(overrides: {
  number?: number;
  title?: string;
  state?: string;
  pull_request?: boolean;
  milestone?: { due_on: string | null } | null;
}) {
  return {
    number: overrides.number ?? 1,
    title: overrides.title ?? 'Issue title',
    body: null,
    state: overrides.state ?? 'open',
    assignee: null,
    milestone: overrides.milestone !== undefined ? overrides.milestone : null,
    html_url: 'https://github.com/o/r/issues/1',
    ...(overrides.pull_request ? { pull_request: {} } : {}),
  };
}

/** Helper: create a minimal Response-like object that satisfies the FetchFn return type */
function mockResponse(data: unknown): Response {
  const body = JSON.stringify(data);
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(JSON.parse(body)),
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

/**
 * Combined mock fetch:
 *  - List URLs (contain `per_page=`) → returns the correct page from listPages
 *  - Detail URLs (contain `/commits/` with no `per_page`) → returns file detail
 */
function makeCombinedFetch(
  listPages: unknown[][],
  detailPatch = 'diff line',
): (url: string) => Promise<Response> {
  return async (url: string) => {
    // Detail URL: .../commits/<sha>  (no query string)
    if (url.includes('/commits/') && !url.includes('per_page=')) {
      return mockResponse({
        files: [{ filename: 'src/index.ts', additions: 1, deletions: 0, patch: detailPatch }],
      });
    }
    // List URL: has per_page= and page=N
    const match = /page=(\d+)/.exec(url);
    const pageIndex = match ? Number(match[1]) - 1 : 0;
    const data = listPages[pageIndex] ?? [];
    return mockResponse(data);
  };
}

/** Issue list mock — all requests return the given pages */
function makeIssueFetch(pages: unknown[][]): (url: string) => Promise<Response> {
  return async (url: string) => {
    const match = /page=(\d+)/.exec(url);
    const pageIndex = match ? Number(match[1]) - 1 : 0;
    const data = pages[pageIndex] ?? [];
    return mockResponse(data);
  };
}

// ── fetchCommits ─────────────────────────────────────────────────────────────

describe('fetchCommits', () => {
  it('returns commits from a single page', async () => {
    const mockFn = makeCombinedFetch([
      [makeCommit({ sha: 'aabbccdd1100' }), makeCommit({ sha: 'eeff00112233' })],
    ]);
    const commits = await fetchCommits('o', 'r', 'token', mockFn);
    console.log('commits length:', commits.length);
    expect(commits).toHaveLength(2);
    expect(commits[0].sha).toBe('aabbccdd1100');
  });

  it('skips merge commits with more than one parent', async () => {
    const commits = await fetchCommits('o', 'r', 'token', makeCombinedFetch([
      [
        makeCommit({ sha: 'merge111aaaa', parents: [{ sha: 'p1' }, { sha: 'p2' }] }),
        makeCommit({ sha: 'normal99cccc' }),
      ],
    ]));
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe('normal99cccc');
  });

  it('skips merge commits whose message starts with "Merge branch"', async () => {
    const commits = await fetchCommits('o', 'r', 'token', makeCombinedFetch([
      [
        makeCommit({ sha: 'merge222bbbb', message: 'Merge branch "feature" into main' }),
        makeCommit({ sha: 'real3333cccc' }),
      ],
    ]));
    expect(commits).toHaveLength(1);
    expect(commits[0].sha).toBe('real3333cccc');
  });

  it('does not throw when commit.author (GitHub account) is null', async () => {
    await expect(
      fetchCommits('o', 'r', 'token', makeCombinedFetch([
        [makeCommit({ author: null })],
      ])),
    ).resolves.toHaveLength(1);
  });

  it('sets login to null when GitHub account is absent', async () => {
    const commits = await fetchCommits('o', 'r', 'token', makeCombinedFetch([
      [makeCommit({ author: null })],
    ]));
    expect(commits[0].author.login).toBeNull();
  });

  it('paginates across multiple pages', async () => {
    // Build 100-item page 1 and a 1-item page 2
    const page1 = Array.from({ length: 100 }, (_, i) =>
      makeCommit({ sha: `${i.toString().padStart(12, '0')}` }),
    );
    const page2 = [makeCommit({ sha: 'lastlastlast' })];
    const commits = await fetchCommits('o', 'r', 'token', makeCombinedFetch([page1, page2]));
    expect(commits).toHaveLength(101);
  });

  it('truncates diff to PATCH_LINE_LIMIT lines', async () => {
    const longPatch = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');
    const commits = await fetchCommits('o', 'r', 'token', makeCombinedFetch([[makeCommit({})]], longPatch));
    const lines = commits[0].diffSummary.split('\n');
    // File header line + PATCH_LINE_LIMIT patch lines + truncation notice
    expect(lines.length).toBeLessThanOrEqual(PATCH_LINE_LIMIT + 5);
  });
});

// ── fetchIssues ──────────────────────────────────────────────────────────────

describe('fetchIssues', () => {
  it('returns issues from a single page', async () => {
    const issues = await fetchIssues('o', 'r', 'token', makeIssueFetch([
      [makeIssue({ number: 1 }), makeIssue({ number: 2 })],
    ]));
    expect(issues).toHaveLength(2);
  });

  it('skips pull requests (pull_request key present)', async () => {
    const issues = await fetchIssues('o', 'r', 'token', makeIssueFetch([
      [makeIssue({ number: 1 }), makeIssue({ number: 2, pull_request: true })],
    ]));
    expect(issues).toHaveLength(1);
    expect(issues[0].number).toBe(1);
  });

  it('maps milestone.due_on to dueDate', async () => {
    const issues = await fetchIssues('o', 'r', 'token', makeIssueFetch([
      [makeIssue({ number: 1, milestone: { due_on: '2024-12-01T00:00:00Z' } })],
    ]));
    expect(issues[0].dueDate).toBe('2024-12-01T00:00:00Z');
  });

  it('sets dueDate to null when there is no milestone', async () => {
    const issues = await fetchIssues('o', 'r', 'token', makeIssueFetch([
      [makeIssue({ number: 1, milestone: null })],
    ]));
    expect(issues[0].dueDate).toBeNull();
  });

  it('maps state "closed" correctly', async () => {
    const issues = await fetchIssues('o', 'r', 'token', makeIssueFetch([
      [makeIssue({ number: 1, state: 'closed' })],
    ]));
    expect(issues[0].state).toBe('closed');
  });
});
