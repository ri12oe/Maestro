import { Router } from 'express';
import db from '../db/client.js';

const router = Router({ mergeParams: true });

// GET /api/teams/:teamId/suggestions
router.get('/', (req, res) => {
  const suggestions = db.prepare(`
    SELECT * FROM suggestions
    WHERE team_id = ? AND status = 'pending'
    ORDER BY generated_at DESC
  `).all(Number(req.params.teamId));
  res.json(suggestions);
});

// POST /api/teams/:teamId/suggestions/:suggestionId/respond
router.post('/:suggestionId/respond', (req, res) => {
  const { status } = req.body as { status?: string };
  const allowed = ['accepted', 'dismissed', 'discuss'];

  if (!status || !allowed.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    return;
  }

  const result = db.prepare(
    'UPDATE suggestions SET status = ? WHERE id = ? AND team_id = ?',
  ).run(status, Number(req.params.suggestionId), Number(req.params.teamId));

  if (result.changes === 0) { res.status(404).json({ error: 'Suggestion not found' }); return; }
  res.json({ ok: true });
});

export default router;
