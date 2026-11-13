import { Router, Request, Response } from 'express';
import db from '../db/client.js';

type TeamParams = { teamId: string };

const router = Router({ mergeParams: true });

// GET /api/teams/:teamId/suggestions
router.get('/', (req: Request<TeamParams>, res: Response) => {
  const suggestions = db.prepare(`
    SELECT * FROM suggestions
    WHERE team_id = ? AND status = 'pending'
    ORDER BY generated_at DESC
  `).all(Number(req.params.teamId));
  res.json(suggestions);
});

// POST /api/teams/:teamId/suggestions/:suggestionId/respond
router.post('/:suggestionId/respond', (req: Request<TeamParams & { suggestionId: string }>, res: Response) => {
  const { status } = req.body as { status?: string };
  const allowed = ['accepted', 'dismissed', 'discuss'];

  if (!status || !allowed.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    return;
  }

  const teamId = Number(req.params.teamId);
  const suggestionId = Number(req.params.suggestionId);

  const updateSuggestion = db.prepare(
    'UPDATE suggestions SET status = ? WHERE id = ? AND team_id = ?',
  );
  const result = updateSuggestion.run(status, suggestionId, teamId);

  if (result.changes === 0) { res.status(404).json({ error: 'Suggestion not found' }); return; }

  // When accepted: update the task's assignee_login to the to_member's github_login (local only)
  if (status === 'accepted') {
    const sug = db.prepare(`
      SELECT s.task_id, m.github_login AS to_login
      FROM suggestions s
      JOIN members m ON m.id = s.to_member_id
      WHERE s.id = ? AND s.team_id = ?
    `).get(suggestionId, teamId) as { task_id: number; to_login: string } | undefined;

    if (sug) {
      db.prepare('UPDATE tasks SET assignee_login = ? WHERE id = ?').run(
        sug.to_login,
        sug.task_id,
      );
    }
  }

  res.json({ ok: true });
});

export default router;
