import { Router } from 'express';
import db from '../db/client.js';

const router = Router({ mergeParams: true });

// GET /api/teams/:teamId/risks
router.get('/', (req, res) => {
  const risks = db.prepare(`
    SELECT * FROM risks
    WHERE team_id = ? AND dismissed = 0
    ORDER BY CASE level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, generated_at DESC
  `).all(Number(req.params.teamId));
  res.json(risks);
});

// POST /api/teams/:teamId/risks/:riskId/dismiss
router.post('/:riskId/dismiss', (req, res) => {
  const result = db.prepare(
    'UPDATE risks SET dismissed = 1 WHERE id = ? AND team_id = ?',
  ).run(Number(req.params.riskId), Number(req.params.teamId));

  if (result.changes === 0) { res.status(404).json({ error: 'Risk not found' }); return; }
  res.json({ ok: true });
});

export default router;
