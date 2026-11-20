/**
 * sync.ts — orchestrates a full GitHub sync for a team.
 *
 * 1. Fetch all commits + Issues from GitHub.
 * 2. Upsert members for unknown contributors.
 *    - When a member is found by email but has no github_login and the commit
 *      has one, fill it in.
 * 3. Persist contributions (skipping already-stored SHAs).
 * 4. Persist tasks (upsert by github_issue_number).
 * 5. Run the AI classifier on any unclassified contributions.
 * 6. Run the risk reasoner.
 */

import db from '../db/client.js';
import {
  fetchCommits, fetchIssues, fetchPulls, authorKey, isBotAuthor,
  COMMIT_WINDOW, ISSUE_WINDOW, PR_WINDOW,
} from './github.js';
import { classifyTeam, rematchNewTasks } from '../ai/classifier.js';
import { runReasoner } from '../ai/reasoner.js';

/** Which part of the pipeline a sync request runs. `all` is ingest, then classify, match, and reason. */
export type SyncStage = 'ingest' | 'classify' | 'match' | 'reason' | 'all';

export interface SyncResult {
  newContributions: number;
  updatedTasks: number;
  newMembers: number;
  classified: number;
  classifyFailed: number;
  risksDetected: number;
  relinked: number;
  /** Plain-language gap, such as a repository with no issues. Null when there is nothing to add. */
  notice: string | null;
  /** True when older commits or issues were left outside the window. */
  capped: boolean;
  window: { commits: number; issues: number; pulls: number };
}

/** A sync that stopped on purpose, with a message the student can act on. */
export class IngestError extends Error {
  readonly status: number;
  constructor(message: string, status = 422) {
    super(message);
    this.name = 'IngestError';
    this.status = status;
  }
}

function emptyResult(): SyncResult {
  return {
    newContributions: 0,
    updatedTasks: 0,
    newMembers: 0,
    classified: 0,
    classifyFailed: 0,
    risksDetected: 0,
    relinked: 0,
    notice: null,
    capped: false,
    window: { commits: COMMIT_WINDOW, issues: ISSUE_WINDOW, pulls: PR_WINDOW },
  };
}

const NO_COMMITS = `This repository has no commits in the latest ${COMMIT_WINDOW}, so there is nothing to analyze yet. Push a commit, then press Try again.`;
const NO_ISSUES = `This repository has no GitHub Issues in the latest ${ISSUE_WINDOW}, so there is no task plan to match. The contribution map still works. Add Issues, then sync again, if you want risks tied to tasks.`;

function markSynced(teamId: number): void {
  db.prepare("UPDATE teams SET last_synced_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?").run(teamId);
}

function countRisks(teamId: number): number {
  return (db.prepare(
    'SELECT COUNT(*) AS n FROM risks WHERE team_id = ? AND dismissed = 0',
  ).get(teamId) as { n: number }).n;
}

export async function syncTeam(teamId: number, stage: SyncStage = 'all'): Promise<SyncResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN env var is required for sync');

  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId) as
    | { id: number; repo_owner: string; repo_name: string }
    | undefined;

  if (!team) throw new Error(`Team ${teamId} not found`);

  if (stage === 'classify') {
    const { classified, failed } = await classifyTeam(teamId);
    markSynced(teamId);
    return { ...emptyResult(), classified, classifyFailed: failed };
  }

  if (stage === 'match') {
    const { linked } = await rematchNewTasks(teamId);
    markSynced(teamId);
    return { ...emptyResult(), relinked: linked };
  }

  if (stage === 'reason') {
    await runReasoner(teamId);
    markSynced(teamId);
    return { ...emptyResult(), risksDetected: countRisks(teamId) };
  }

  const { repo_owner: owner, repo_name: repo } = team;

  // ── Load SHAs already stored for this team ───────────────────────────────
  const storedRows = db.prepare(
    'SELECT github_sha FROM contributions WHERE team_id = ? AND github_sha IS NOT NULL',
  ).all(teamId) as Array<{ github_sha: string }>;
  const knownShas = new Set(storedRows.map(r => r.github_sha));

  // ── 1. Fetch the recent window from GitHub ──────────────────────────────
  const [commits, issues, pulls] = await Promise.all([
    fetchCommits(owner, repo, token, undefined, knownShas),
    fetchIssues(owner, repo, token),
    fetchPulls(owner, repo, token),
  ]);

  if (commits.length === 0 && knownShas.size === 0) {
    throw new IngestError(NO_COMMITS);
  }

  const prBySha = new Map<string, number>();
  for (const pull of pulls) {
    if (pull.headSha) prBySha.set(pull.headSha, pull.number);
    if (pull.mergeSha) prBySha.set(pull.mergeSha, pull.number);
  }
  for (const commit of commits) {
    const prNumber = prBySha.get(commit.sha);
    if (prNumber != null) commit.prNumber = prNumber;
  }

  let newContributions = 0;
  let newMembers = 0;

  // ── 2. Upsert members and persist contributions ───────────────────────────
  const insertMember = db.prepare(`
    INSERT INTO members (team_id, github_login, email, display_name)
    VALUES (@team_id, @github_login, @email, @display_name)
    ON CONFLICT DO NOTHING
  `);

  const getMemberByLogin = db.prepare(
    'SELECT id FROM members WHERE team_id = ? AND github_login = ?',
  );

  const getMemberByEmail = db.prepare(
    'SELECT id, github_login FROM members WHERE team_id = ? AND email = ?',
  );

  const getUnknownMember = db.prepare(
    "SELECT id FROM members WHERE team_id = ? AND github_login IS NULL AND email IS NULL AND display_name = 'Unknown Contributor'",
  );

  const updateLogin = db.prepare(
    'UPDATE members SET github_login = ? WHERE id = ?',
  );

  const insertContribution = db.prepare(`
    INSERT INTO contributions
      (team_id, member_id, source, github_sha, github_pr_number, title,
       diff_summary, files_changed, additions, deletions, url, paths, authored_at)
    VALUES
      (@team_id, @member_id, 'commit', @github_sha, @github_pr_number, @title,
       @diff_summary, @files_changed, @additions, @deletions, @url, @paths, @authored_at)
    ON CONFLICT (team_id, github_sha) DO NOTHING
  `);

  const syncTx = db.transaction(() => {
    for (const commit of commits) {
      const { author } = commit;
      if (isBotAuthor(author)) continue; // automation, not a teammate

      // Find or create member — prefer login lookup, then email lookup
      let member = author.login
        ? (getMemberByLogin.get(teamId, author.login) as { id: number } | undefined)
        : null;

      if (!member && author.email) {
        const byEmail = getMemberByEmail.get(teamId, author.email) as
          | { id: number; github_login: string | null }
          | undefined;

        if (byEmail) {
          // Fill in github_login if the commit has one and the row doesn't
          if (author.login && !byEmail.github_login) {
            updateLogin.run(author.login, byEmail.id);
          }
          member = byEmail;
        }
      }

      if (!member) {
        if (author.login || author.email) {
          // New contributor with an identity — insert them
          insertMember.run({
            team_id: teamId,
            github_login: author.login ?? null,
            email: author.email || null,
            display_name: author.name || authorKey(author),
          });
          newMembers++;
          member = (author.login
            ? getMemberByLogin.get(teamId, author.login)
            : getMemberByEmail.get(teamId, author.email)) as { id: number };
        } else {
          // No login or email — reuse the single shared "Unknown Contributor" for this team
          member = getUnknownMember.get(teamId) as { id: number } | undefined;
          if (!member) {
            insertMember.run({
              team_id: teamId,
              github_login: null,
              email: null,
              display_name: 'Unknown Contributor',
            });
            newMembers++;
            member = getUnknownMember.get(teamId) as { id: number };
          }
        }
      }

      const result = insertContribution.run({
        team_id: teamId,
        member_id: member.id,
        github_sha: commit.sha,
        github_pr_number: commit.prNumber,
        title: commit.title,
        diff_summary: commit.diffSummary || null,
        files_changed: commit.filesChanged ?? null,
        additions: commit.additions ?? null,
        deletions: commit.deletions ?? null,
        url: commit.url,
        paths: commit.paths.length > 0 ? JSON.stringify(commit.paths) : null,
        authored_at: commit.author.date,
      });

      if (result.changes > 0) newContributions++;
    }
  });

  syncTx();

  // ── 3. Upsert tasks from Issues ──────────────────────────────────────────
  const upsertTask = db.prepare(`
    INSERT INTO tasks
      (team_id, github_issue_number, title, body, assignee_login, status, due_date, synced_at)
    VALUES
      (@team_id, @github_issue_number, @title, @body, @assignee_login, @status, @due_date,
       strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
    ON CONFLICT (team_id, github_issue_number) DO UPDATE SET
      title          = excluded.title,
      body           = excluded.body,
      assignee_login = excluded.assignee_login,
      status         = excluded.status,
      due_date       = excluded.due_date,
      synced_at      = excluded.synced_at
  `);

  const taskTx = db.transaction(() => {
    for (const issue of issues) {
      upsertTask.run({
        team_id: teamId,
        github_issue_number: issue.number,
        title: issue.title,
        body: issue.body ?? null,
        assignee_login: issue.assigneeLogin ?? null,
        status: issue.state,
        due_date: issue.dueDate ?? null,
      });
    }
  });

  taskTx();

  const taskCount = (db.prepare(
    'SELECT COUNT(*) AS n FROM tasks WHERE team_id = ?',
  ).get(teamId) as { n: number }).n;
  const notice = taskCount === 0 && !issues.capped ? NO_ISSUES : null;
  const ingested: SyncResult = {
    ...emptyResult(),
    newContributions,
    updatedTasks: issues.length,
    newMembers,
    notice,
    capped: commits.capped || issues.capped || pulls.capped,
  };

  // Ingest alone is the first real step on the connect screen. `all` continues
  // through classify, match, and reason, which is what Sync now still does.
  if (stage === 'ingest') {
    markSynced(teamId);
    return ingested;
  }

  // ── 4. Classify any unclassified contributions ───────────────────────────
  const { classified, failed: classifyFailed } = await classifyTeam(teamId);

  // ── 4b. Link older commits to Issues that were created after them ──────────
  const { linked: relinked } = await rematchNewTasks(teamId);

  // ── 5. Run risk reasoner ─────────────────────────────────────────────────
  await runReasoner(teamId);
  markSynced(teamId);

  return {
    ...ingested,
    classified,
    classifyFailed,
    relinked,
    risksDetected: countRisks(teamId),
  };
}
