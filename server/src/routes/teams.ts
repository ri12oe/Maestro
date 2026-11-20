import { Router } from 'express';
import db from '../db/client.js';
import { GitHubApiError } from '../ingestion/github.js';
import { IngestError, syncTeam, type SyncStage } from '../ingestion/sync.js';
import { classifyTeam } from '../ai/classifier.js';
import { runReasoner } from '../ai/reasoner.js';

const SYNC_STAGES: readonly SyncStage[] = ['ingest', 'classify', 'match', 'reason', 'all'];

function readStage(body: unknown): SyncStage | null {
  if (!body || typeof body !== 'object' || !('stage' in body) || (body as { stage?: unknown }).stage == null) {
    return 'all';
  }
  const stage = (body as { stage: unknown }).stage;
  return typeof stage === 'string' && (SYNC_STAGES as readonly string[]).includes(stage) ? stage as SyncStage : null;
}

/** Oldest team for this GitHub repository, compared case-insensitively. */
function findTeamByRepo(owner: string, repo: string): Record<string, unknown> | undefined {
  return db.prepare(`
    SELECT * FROM teams
    WHERE lower(repo_owner) = lower(?) AND lower(repo_name) = lower(?)
    ORDER BY id ASC
    LIMIT 1
  `).get(owner, repo) as Record<string, unknown> | undefined;
}

const router = Router();

/** True for a real calendar day written YYYY-MM-DD. */
function isIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isDeadline(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && isIsoDate(value));
}

/** Turn GitHub/API failures into messages a student can act on. */
export function explainSyncError(err: unknown, teamId: number): { status: number; error: string } {
  if (err instanceof IngestError) return { status: err.status, error: err.message };

  const message = err instanceof Error ? err.message : String(err);
  const team = db.prepare('SELECT repo_owner, repo_name FROM teams WHERE id = ?').get(teamId) as
    | { repo_owner: string; repo_name: string } | undefined;
  const repo = team ? `${team.repo_owner}/${team.repo_name}` : 'the repository';
  const gh = err instanceof GitHubApiError
    ? err.status
    : Number(/GitHub .*failed: (\d{3})/.exec(message)?.[1]);
  const code = Number.isFinite(gh) && gh > 0 ? gh : null;

  if (code === 404) {
    return {
      status: 404,
      error: `GitHub couldn't find ${repo}. Check the spelling, or paste a public repository. A private repository only works when the server token can read it. Then press Try again.`,
    };
  }
  if (code === 401) {
    return {
      status: 502,
      error: 'GitHub rejected the token in .env. Create a new read-only token, put it in GITHUB_TOKEN, restart the server, then press Try again.',
    };
  }
  if (code === 403 || code === 429) {
    const reset = err instanceof GitHubApiError ? err.resetAt : null;
    const when = reset
      ? `Try again after ${reset}.`
      : 'Wait for the limit to reset, then press Try again.';
    return { status: 503, error: `GitHub is rate-limiting requests right now. ${when}` };
  }
  return { status: 500, error: `Sync failed: ${message}` };
}

// GET /api/teams — list teams (for the team picker on the Connect screen)
router.get('/', (_req, res) => {
  const teams = db.prepare(`
    SELECT t.id, t.name, t.repo_owner, t.repo_name, t.created_at,
           (SELECT COUNT(*) FROM members m WHERE m.team_id = t.id AND m.github_login IS NOT NULL) AS member_count,
           (SELECT COUNT(*) FROM contributions c WHERE c.team_id = t.id) AS contribution_count
    FROM teams t
    ORDER BY t.created_at DESC, t.id DESC
  `).all();
  res.json(teams);
});

// POST /api/teams — create a team
router.post('/', (req, res) => {
  const { name, repo_owner, repo_name } = req.body as Record<string, unknown>;

  if (typeof name !== 'string' || !name.trim()) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  if (typeof repo_owner !== 'string' || !repo_owner.trim()) {
    res.status(400).json({ error: 'repo_owner is required' });
    return;
  }
  if (typeof repo_name !== 'string' || !repo_name.trim()) {
    res.status(400).json({ error: 'repo_name is required' });
    return;
  }

  const owner = repo_owner.trim();
  const repo = repo_name.trim();
  const existing = findTeamByRepo(owner, repo);
  if (existing) {
    res.status(200).json({ ...existing, reused: true });
    return;
  }

  const result = db
    .prepare('INSERT INTO teams (name, repo_owner, repo_name) VALUES (?, ?, ?)')
    .run(name.trim(), owner, repo);

  const team = db
    .prepare('SELECT * FROM teams WHERE id = ?')
    .get(result.lastInsertRowid);

  res.status(201).json(team);
});

// GET /api/teams/:teamId — get a team
router.get('/:teamId', (req, res) => {
  const team = db
    .prepare('SELECT * FROM teams WHERE id = ?')
    .get(Number(req.params.teamId));

  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }
  res.json(team);
});

// PATCH /api/teams/:teamId — team settings.
// { deadline: 'YYYY-MM-DD' | null } sets or clears the team deadline.
// { report_enabled: boolean } turns the project report on or off for the whole team.
// Either key, or both, may be sent.
router.patch('/:teamId', (req, res) => {
  const teamId = Number(req.params.teamId);
  const existing = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
  if (!existing) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const hasDeadline = 'deadline' in body;
  const hasReport = 'report_enabled' in body;
  if ((!hasDeadline && !hasReport) || (hasDeadline && !isDeadline(body.deadline))) {
    res.status(400).json({ error: 'deadline must be YYYY-MM-DD or null' });
    return;
  }
  if (hasReport && typeof body.report_enabled !== 'boolean') {
    res.status(400).json({ error: 'report_enabled must be true or false' });
    return;
  }

  db.transaction(() => {
    if (hasDeadline) db.prepare('UPDATE teams SET deadline = ? WHERE id = ?').run(body.deadline, teamId);
    if (hasReport) db.prepare('UPDATE teams SET report_enabled = ? WHERE id = ?').run(body.report_enabled ? 1 : 0, teamId);
  })();
  const team = db.prepare('SELECT * FROM teams WHERE id = ?').get(teamId);
  res.json(team);
});

// DELETE /api/teams/:teamId — disconnect a team; child rows follow ON DELETE CASCADE
router.delete('/:teamId', (req, res) => {
  const teamId = Number(req.params.teamId);

  const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }

  db.prepare('DELETE FROM teams WHERE id = ?').run(teamId);
  res.json({ ok: true });
});

// POST /api/teams/:teamId/sync — trigger full GitHub sync
router.post('/:teamId/sync', async (req, res) => {
  const teamId = Number(req.params.teamId);

  const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }

  if (!process.env.GITHUB_TOKEN) {
    res.status(503).json({
      error: 'The server has no GitHub token configured. Set the GITHUB_TOKEN environment variable (in .env locally, or in your host\'s variables), restart the server, then press Try again.',
    });
    return;
  }

  const stage = readStage(req.body);
  if (!stage) {
    res.status(400).json({ error: 'stage must be ingest, classify, match, reason, or all' });
    return;
  }

  try {
    const result = await syncTeam(teamId, stage);
    res.json({ ok: true, stage, ...result });
  } catch (err) {
    const { status, error } = explainSyncError(err, teamId);
    res.status(status).json({ error });
  }
});

// POST /api/teams/:teamId/classify — classify any still-unclassified contributions
router.post('/:teamId/classify', async (req, res) => {
  const teamId = Number(req.params.teamId);

  const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }

  try {
    const { classified, failed } = await classifyTeam(teamId);
    await runReasoner(teamId);
    res.json({ ok: true, classified, failed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
