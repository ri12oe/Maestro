/**
 * GitHub REST API helpers for Group Project Referee.
 *
 * Responsibilities:
 *  - Fetch all commits for a repo (paginated), each with per-file list and
 *    a diff patch truncated to 200 lines. Merge commits are skipped.
 *  - Fetch all Issues (open + closed) with milestone due_on.
 *  - Map a commit's author to { login, email, name } — never throws on
 *    commits with no GitHub account.
 */

export const PATCH_LINE_LIMIT = 200;

export interface GitHubCommitSummary {
  sha: string;
  author: {
    login: string | null;  // null when commit has no linked GitHub account
    email: string;
    name: string;
    date: string;          // ISO-8601
  };
  message: string;         // full commit message
  title: string;           // first line of commit message
  url: string;
  isMerge: boolean;
  prNumber: number | null;
  files: Array<{ filename: string; additions: number; deletions: number }>;
  diffSummary: string;     // patch truncated to PATCH_LINE_LIMIT lines
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  assigneeLogin: string | null;
  dueDate: string | null;   // ISO-8601 from milestone.due_on; null if no milestone
  url: string;
}

type FetchFn = (url: string, init?: RequestInit) => Promise<Response>;

function buildHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function truncatePatch(patch: string | undefined): string {
  if (!patch) return '';
  const lines = patch.split('\n');
  if (lines.length <= PATCH_LINE_LIMIT) return patch;
  return lines.slice(0, PATCH_LINE_LIMIT).join('\n') + `\n[... truncated at ${PATCH_LINE_LIMIT} lines]`;
}

function isMergeCommit(message: string, parentCount: number): boolean {
  return parentCount > 1 || /^Merge (branch|pull request)/i.test(message);
}

/**
 * Fetch a single commit detail (files + patch).
 * Returns null if the request fails (e.g. 404 on deleted branch commit).
 */
async function fetchCommitDetail(
  owner: string,
  repo: string,
  sha: string,
  token: string,
  fetchFn: FetchFn,
): Promise<{ files: GitHubCommitSummary['files']; diffSummary: string } | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`;
  const res = await fetchFn(url, { headers: buildHeaders(token) });
  if (!res.ok) return null;

  const data = await res.json() as {
    files?: Array<{
      filename: string;
      additions: number;
      deletions: number;
      patch?: string;
    }>;
  };

  const files = (data.files ?? []).map(f => ({
    filename: f.filename,
    additions: f.additions,
    deletions: f.deletions,
  }));

  const diffSummary = (data.files ?? [])
    .map(f => {
      const header = `--- ${f.filename} (+${f.additions}/-${f.deletions})`;
      return f.patch ? `${header}\n${f.patch}` : header;
    })
    .join('\n\n');

  return { files, diffSummary: truncatePatch(diffSummary) };
}

/**
 * Fetch all commits for a repo, paginated.
 * Skips merge commits and any SHAs already present in knownShas.
 * Never throws on commits with no GitHub login.
 */
export async function fetchCommits(
  owner: string,
  repo: string,
  token: string,
  fetchFn: FetchFn = globalThis.fetch,
  knownShas: ReadonlySet<string> = new Set(),
): Promise<GitHubCommitSummary[]> {
  const results: GitHubCommitSummary[] = [];
  let page = 1;

  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=100&page=${page}`;
    const res = await fetchFn(url, { headers: buildHeaders(token) });

    if (!res.ok) {
      throw new Error(`GitHub commits fetch failed: ${res.status} ${await res.text()}`);
    }

    const commits = await res.json() as Array<{
      sha: string;
      commit: {
        message: string;
        author: { name: string; email: string; date: string } | null;
      };
      author: { login: string } | null;  // linked GitHub account (may be absent)
      parents: Array<{ sha: string }>;
      html_url: string;
    }>;

    console.log(`[github] page ${page}: got ${commits.length} commits`);
    if (commits.length === 0) break;

    for (const c of commits) {
      const message = c.commit.message ?? '';
      const parentCount = c.parents?.length ?? 1;

      if (isMergeCommit(message, parentCount)) continue;
      if (knownShas.has(c.sha)) continue;  // already stored — skip detail fetch

      const detail = await fetchCommitDetail(owner, repo, c.sha, token, fetchFn);

      results.push({
        sha: c.sha,
        author: {
          login: c.author?.login ?? null,  // gracefully null — never crashes
          email: c.commit.author?.email ?? '',
          name: c.commit.author?.name ?? '',
          date: c.commit.author?.date ?? new Date().toISOString(),
        },
        message,
        title: message.split('\n')[0].trim(),
        url: c.html_url,
        isMerge: false,
        prNumber: null,
        files: detail?.files ?? [],
        diffSummary: detail?.diffSummary ?? '',
      });
    }

    // GitHub returns fewer items on the last page
    if (commits.length < 100) break;
    page++;
  }

  return results;
}

/**
 * Fetch all Issues (open + closed) for a repo, paginated.
 * Pull requests appear in the issues endpoint but have a `pull_request` key — skip them.
 */
export async function fetchIssues(
  owner: string,
  repo: string,
  token: string,
  fetchFn: FetchFn = globalThis.fetch,
): Promise<GitHubIssue[]> {
  const results: GitHubIssue[] = [];
  let page = 1;

  while (true) {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=100&page=${page}`;
    const res = await fetchFn(url, { headers: buildHeaders(token) });

    if (!res.ok) {
      throw new Error(`GitHub issues fetch failed: ${res.status} ${await res.text()}`);
    }

    const issues = await res.json() as Array<{
      number: number;
      title: string;
      body: string | null;
      state: string;
      assignee: { login: string } | null;
      milestone: { due_on: string | null } | null;
      html_url: string;
      pull_request?: unknown;  // present on PRs — skip
    }>;

    if (issues.length === 0) break;

    for (const i of issues) {
      if (i.pull_request !== undefined) continue;  // skip PRs

      results.push({
        number: i.number,
        title: i.title,
        body: i.body,
        state: i.state === 'closed' ? 'closed' : 'open',
        assigneeLogin: i.assignee?.login ?? null,
        dueDate: i.milestone?.due_on ?? null,
        url: i.html_url,
      });
    }

    if (issues.length < 100) break;
    page++;
  }

  return results;
}

/**
 * Map a GitHubCommitSummary author to a stable member key.
 * Returns the best available identifier: prefer github_login, fall back to email.
 */
export function authorKey(author: GitHubCommitSummary['author']): string {
  return author.login || author.email || 'unknown';
}
