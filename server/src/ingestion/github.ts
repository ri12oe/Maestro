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

/**
 * How much of a repository one sync reads.
 * The newest commits, pull requests, and issues — not the whole history —
 * so a judge's first connect stays around a minute and inside GitHub's rate limit.
 */
export const COMMIT_WINDOW = 30;
export const ISSUE_WINDOW = 30;
export const PR_WINDOW = 20;

/** List pages walked while filling the window. A safety stop, not a second cap. */
const MAX_LIST_PAGES = 3;
const DETAIL_CONCURRENCY = 4;

/** A GitHub response the sync can explain (missing repo, bad token, rate limit). */
export class GitHubApiError extends Error {
  readonly status: number;
  /** ISO-8601 time the caller can retry, from Retry-After or X-RateLimit-Reset. */
  readonly resetAt: string | null;

  constructor(resource: string, status: number, body: string, resetAt: string | null) {
    super(`GitHub ${resource} fetch failed: ${status} ${body}`);
    this.name = 'GitHubApiError';
    this.status = status;
    this.resetAt = resetAt;
  }
}

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
  paths: string[];         // just the filenames, for SPOF analysis
  diffSummary: string;     // patch truncated to PATCH_LINE_LIMIT lines
  filesChanged: number;    // total files touched
  additions: number;       // total lines added
  deletions: number;       // total lines deleted
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

function readHeader(res: Response, name: string): string | null {
  const headers = res.headers;
  if (!headers || typeof headers.get !== 'function') return null;
  return headers.get(name);
}

/** When GitHub says to wait: Retry-After seconds, else X-RateLimit-Reset epoch seconds. */
function resetAtFrom(res: Response): string | null {
  const retry = readHeader(res, 'retry-after')?.trim();
  if (retry && /^\d+$/.test(retry)) {
    return new Date(Date.now() + Number(retry) * 1000).toISOString();
  }
  const reset = readHeader(res, 'x-ratelimit-reset')?.trim();
  if (reset && /^\d+$/.test(reset)) {
    return new Date(Number(reset) * 1000).toISOString();
  }
  return null;
}

async function githubError(resource: string, res: Response): Promise<GitHubApiError> {
  const body = await res.text();
  return new GitHubApiError(resource, res.status, body, resetAtFrom(res));
}

function withCapped<T>(items: T[], capped: boolean): T[] & { capped: boolean } {
  return Object.assign(items, { capped });
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  }
  const workers = Math.min(limit, items.length);
  if (workers === 0) return out;
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
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
): Promise<{ files: GitHubCommitSummary['files']; paths: string[]; diffSummary: string; filesChanged: number; additions: number; deletions: number } | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/commits/${sha}`;
  const res = await fetchFn(url, { headers: buildHeaders(token) });
  // A missing commit (force-push, deleted branch) is skipped. Auth and rate
  // limits are the same failure as the list call, so they are not swallowed.
  if (!res.ok) {
    if (res.status === 401 || res.status === 403 || res.status === 429) {
      throw await githubError('commits', res);
    }
    return null;
  }

  const data = await res.json() as {
    files?: Array<{
      filename: string;
      additions: number;
      deletions: number;
      patch?: string;
    }>;
  };

  const rawFiles = data.files ?? [];
  const files = rawFiles.map(f => ({
    filename: f.filename,
    additions: f.additions,
    deletions: f.deletions,
  }));

  const diffSummary = rawFiles
    .map(f => {
      const header = `--- ${f.filename} (+${f.additions}/-${f.deletions})`;
      return f.patch ? `${header}\n${f.patch}` : header;
    })
    .join('\n\n');

  const filesChanged = rawFiles.length;
  const additions = rawFiles.reduce((s, f) => s + (f.additions ?? 0), 0);
  const deletions = rawFiles.reduce((s, f) => s + (f.deletions ?? 0), 0);
  const paths = rawFiles.map(f => f.filename);

  return { files, paths, diffSummary: truncatePatch(diffSummary), filesChanged, additions, deletions };
}

interface ListedCommit {
  sha: string;
  author: GitHubCommitSummary['author'];
  message: string;
  title: string;
  url: string;
  /** Already stored. Counts toward the window, but does not need another detail call. */
  known: boolean;
}

/**
 * Fetch the newest commits for a repo.
 * Merge commits and bot authors are skipped. SHAs in `knownShas` are not
 * fetched again. Stops at `limit` non-merge, non-bot commits (the window),
 * and at {@link MAX_LIST_PAGES} so a long history cannot walk the API.
 * Never throws on a commit with no GitHub login.
 * `capped` is true when older commits were left outside the window.
 */
export async function fetchCommits(
  owner: string,
  repo: string,
  token: string,
  fetchFn: FetchFn = globalThis.fetch,
  knownShas: ReadonlySet<string> = new Set(),
  limit: number = COMMIT_WINDOW,
): Promise<GitHubCommitSummary[] & { capped: boolean }> {
  const listed: ListedCommit[] = [];
  let capped = false;

  for (let page = 1; page <= MAX_LIST_PAGES && listed.length < limit; page++) {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=100&page=${page}`;
    const res = await fetchFn(url, { headers: buildHeaders(token) });

    if (!res.ok) throw await githubError('commits', res);

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
    if (!Array.isArray(commits) || commits.length === 0) break;

    for (const c of commits) {
      const message = c.commit?.message ?? '';
      const parentCount = c.parents?.length ?? 1;
      if (isMergeCommit(message, parentCount)) continue;

      const author: GitHubCommitSummary['author'] = {
        login: c.author?.login ?? null,  // gracefully null — never crashes
        email: c.commit?.author?.email ?? '',
        name: c.commit?.author?.name ?? '',
        date: c.commit?.author?.date ?? new Date().toISOString(),
      };
      if (isBotAuthor(author)) continue;

      if (listed.length >= limit) {
        capped = true;
        break;
      }

      listed.push({
        sha: c.sha,
        author,
        message,
        title: message.split('\n')[0].trim(),
        url: c.html_url,
        known: knownShas.has(c.sha),
      });
    }

    if (listed.length >= limit && commits.length === 100) capped = true;
    if (commits.length < 100) break;
    if (page === MAX_LIST_PAGES && commits.length === 100 && listed.length < limit) capped = true;
  }

  const fresh = listed.filter(c => !c.known);
  const details = await mapPool(fresh, DETAIL_CONCURRENCY, commit =>
    fetchCommitDetail(owner, repo, commit.sha, token, fetchFn),
  );

  const results = fresh.map((commit, index) => {
    const detail = details[index];
    return {
      sha: commit.sha,
      author: commit.author,
      message: commit.message,
      title: commit.title,
      url: commit.url,
      isMerge: false,
      prNumber: null,
      files: detail?.files ?? [],
      paths: detail?.paths ?? [],
      diffSummary: detail?.diffSummary ?? '',
      filesChanged: detail?.filesChanged ?? 0,
      additions: detail?.additions ?? 0,
      deletions: detail?.deletions ?? 0,
    };
  });
  return withCapped(results, capped);
}

/**
 * Fetch the newest Issues (open + closed), most recently updated first.
 * Pull requests appear in the issues endpoint but have a `pull_request` key — skip them.
 * Stops at `limit` issues. `capped` is true when older issues were left out.
 */
export async function fetchIssues(
  owner: string,
  repo: string,
  token: string,
  fetchFn: FetchFn = globalThis.fetch,
  limit: number = ISSUE_WINDOW,
): Promise<GitHubIssue[] & { capped: boolean }> {
  const results: GitHubIssue[] = [];
  let capped = false;
  const perPage = Math.min(100, Math.max(1, limit));

  for (let page = 1; page <= MAX_LIST_PAGES && results.length < limit; page++) {
    const url = `https://api.github.com/repos/${owner}/${repo}/issues?state=all&sort=updated&direction=desc&per_page=${perPage}&page=${page}`;
    const res = await fetchFn(url, { headers: buildHeaders(token) });

    if (!res.ok) throw await githubError('issues', res);

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

    if (!Array.isArray(issues) || issues.length === 0) break;

    for (const i of issues) {
      if (i.pull_request !== undefined) continue;  // skip PRs
      if (results.length >= limit) {
        capped = true;
        break;
      }

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

    if (issues.length === perPage && results.length >= limit) capped = true;
    if (issues.length < perPage) break;
    if (page === MAX_LIST_PAGES && issues.length === perPage && results.length < limit) capped = true;
  }

  return withCapped(results, capped);
}

export interface GitHubPullRef {
  number: number;
  /** Head commit SHA, when GitHub sent one. */
  headSha: string | null;
  /** Merge commit SHA, when the pull request has one. */
  mergeSha: string | null;
}

/**
 * The newest pull requests. One list call. Used to record `github_pr_number`
 * on a commit that is the pull request's head or merge commit. Pull requests
 * are not their own contribution rows.
 */
export async function fetchPulls(
  owner: string,
  repo: string,
  token: string,
  fetchFn: FetchFn = globalThis.fetch,
  limit: number = PR_WINDOW,
): Promise<GitHubPullRef[] & { capped: boolean }> {
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=${Math.min(100, Math.max(1, limit))}`;
  const res = await fetchFn(url, { headers: buildHeaders(token) });
  if (!res.ok) throw await githubError('pulls', res);

  const pulls = await res.json() as Array<{
    number: number;
    head?: { sha?: string } | null;
    merge_commit_sha?: string | null;
  }>;

  const list = Array.isArray(pulls) ? pulls : [];
  const results = list.slice(0, limit).map(pull => ({
    number: pull.number,
    headSha: pull.head?.sha ?? null,
    mergeSha: pull.merge_commit_sha ?? null,
  }));
  return withCapped(results, list.length > limit);
}

/**
 * Map a GitHubCommitSummary author to a stable member key.
 * Returns the best available identifier: prefer github_login, fall back to email.
 */
export function authorKey(author: GitHubCommitSummary['author']): string {
  return author.login || author.email || 'unknown';
}

/**
 * True for automation accounts (dependabot[bot], github-actions[bot], renovate[bot]…).
 * GitHub marks every app/bot login with a "[bot]" suffix; their commits are not a
 * teammate's work, so they are left out of the team picture.
 */
export function isBotAuthor(author: GitHubCommitSummary['author']): boolean {
  return !!author.login && /\[bot\]$/i.test(author.login);
}
