import { Router } from 'express';
import db from '../db/client.js';
import { syncTeam } from '../ingestion/sync.js';
import { classifyTeam } from '../ai/classifier.js';
import { runReasoner } from '../ai/reasoner.js';

const router = Router();

/** Turn GitHub/API failures into messages a student can act on. */
export function explainSyncError(err: unknown, teamId: number): { status: number; error: string } {
  const message = err instanceof Error ? err.message : String(err);
  const team = db.prepare('SELECT repo_owner, repo_name FROM teams WHERE id = ?').get(teamId) as
    | { repo_owner: string; repo_name: string } | undefined;
  const repo = team ? `${team.repo_owner}/${team.repo_name}` : 'the repository';
  const gh = /GitHub .*failed: (\d{3})/.exec(message);
  const code = gh ? Number(gh[1]) : null;

  if (code === 404) return { status: 404, error: `GitHub couldn't find ${repo}. Check the spelling, or if it's private, make sure your token can read it.` };
  if (code === 401) return { status: 502, error: 'GitHub rejected the token in .env. It may have expired; create a new one and restart the server.' };
  if (code === 403 || code === 429) return { status: 503, error: 'GitHub is rate-limiting requests right now. Wait a few minutes, then retry.' };
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

  const result = db
    .prepare('INSERT INTO teams (name, repo_owner, repo_name) VALUES (?, ?, ?)')
    .run(name.trim(), repo_owner.trim(), repo_name.trim());

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
      error: 'The server has no GitHub token configured. Set the GITHUB_TOKEN environment variable (in .env locally, or in your host\'s variables), restart the server, then retry.',
    });
    return;
  }

  try {
    const result = await syncTeam(teamId);
    res.json({ ok: true, ...result });
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
