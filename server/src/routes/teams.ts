import { Router } from 'express';
import db from '../db/client.js';
import { syncTeam } from '../ingestion/sync.js';
import { classifyTeam } from '../ai/classifier.js';

const router = Router();

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

// POST /api/teams/:teamId/sync — trigger full GitHub sync
router.post('/:teamId/sync', async (req, res) => {
  const teamId = Number(req.params.teamId);

  const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }

  try {
    const result = await syncTeam(teamId);
    res.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
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
    const classified = await classifyTeam(teamId);
    res.json({ ok: true, classified });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

export default router;
