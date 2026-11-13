import { Router, Request, Response } from 'express';
import db from '../db/client.js';

type TeamParams = { teamId: string };

const router = Router({ mergeParams: true });

// GET /api/teams/:teamId/suggestions
router.get('/', (req: Request<TeamParams>, res: Response) => {
  const rows = db.prepare(`
    SELECT s.id, s.status, s.rationale, s.checkin_message, s.generated_at,
           s.task_id, t.github_issue_number AS task_number, t.title AS task_title, t.due_date AS task_due_date,
           s.from_member_id, fm.github_login AS from_login, fm.display_name AS from_name,
           s.to_member_id,   tm.github_login AS to_login,   tm.display_name AS to_name,
           (SELECT COUNT(*) FROM tasks x WHERE x.team_id = s.team_id AND x.status = 'open' AND x.assignee_login = fm.github_login) AS from_open_tasks,
           (SELECT COUNT(*) FROM tasks x WHERE x.team_id = s.team_id AND x.status = 'open' AND x.assignee_login = tm.github_login) AS to_open_tasks
    FROM suggestions s
    JOIN tasks t    ON t.id = s.task_id
    JOIN members fm ON fm.id = s.from_member_id
    JOIN members tm ON tm.id = s.to_member_id
    WHERE s.team_id = ? AND s.status = 'pending'
    ORDER BY s.id ASC
  `).all(Number(req.params.teamId)) as Array<Record<string, unknown> & { rationale: string | null }>;

  res.json(rows.map(r => {
    let rationale: string[] = [];
    try { rationale = JSON.parse(r.rationale ?? '[]'); } catch { rationale = r.rationale ? [r.rationale] : []; }
    return { ...r, rationale };
  }));
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
