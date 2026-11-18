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

type AcceptedSuggestion = {
  status: string;
  task_id: number;
  from_login: string | null;
  to_login: string | null;
  assignee_login: string | null;
};

// POST /api/teams/:teamId/suggestions/:suggestionId/respond
// status `pending` undoes an accept: the suggestion goes back to pending and the
// task returns to the member who held it (from_login). That revert runs only
// while the suggestion is still accepted and the task is still assigned to the
// member who received it (to_login). Anything else is a 409 and writes nothing.
// Accepted rows are kept across reasoner runs, not replaced; a later accept
// moves the task, which this check refuses.
// Accept is the only other response that writes anything besides the suggestion
// row, and that write is local: tasks.assignee_login = to_login.
router.post('/:suggestionId/respond', (req: Request<TeamParams & { suggestionId: string }>, res: Response) => {
  const { status } = req.body as { status?: string };
  const allowed = ['accepted', 'dismissed', 'discuss', 'pending'];

  if (!status || !allowed.includes(status)) {
    res.status(400).json({ error: `status must be one of: ${allowed.join(', ')}` });
    return;
  }

  const teamId = Number(req.params.teamId);
  const suggestionId = Number(req.params.suggestionId);

  if (status === 'pending') {
    undoAcceptedSuggestion(teamId, suggestionId, res);
    return;
  }

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

function undoAcceptedSuggestion(teamId: number, suggestionId: number, res: Response): void {
  const sug = db.prepare(`
    SELECT s.status, s.task_id,
           fm.github_login AS from_login,
           tm.github_login AS to_login,
           t.assignee_login AS assignee_login
    FROM suggestions s
    JOIN members fm ON fm.id = s.from_member_id
    JOIN members tm ON tm.id = s.to_member_id
    JOIN tasks t ON t.id = s.task_id
    WHERE s.id = ? AND s.team_id = ?
  `).get(suggestionId, teamId) as AcceptedSuggestion | undefined;

  if (!sug) { res.status(404).json({ error: 'Suggestion not found' }); return; }
  const refused = undoRefusal(sug);
  if (refused) { res.status(409).json({ error: refused }); return; }

  // Re-check both rows inside the write. A sync or another accept can move the
  // task between the read above and this update; that must not land halfway.
  let reverted: true | string = true;
  try {
    reverted = db.transaction(() => {
      const moved = db.prepare(
        'UPDATE tasks SET assignee_login = ? WHERE id = ? AND assignee_login IS ?',
      ).run(sug.from_login, sug.task_id, sug.to_login);
      if (moved.changes !== 1) return 'Cannot undo this suggestion because the task is no longer assigned to the member who received it';
      const updated = db.prepare(
        `UPDATE suggestions SET status = 'pending' WHERE id = ? AND team_id = ? AND status = 'accepted'`,
      ).run(suggestionId, teamId);
      if (updated.changes !== 1) throw new Error('status');
      return true as const;
    })();
  } catch {
    reverted = 'Only an accepted suggestion can be set back to pending';
  }

  if (reverted !== true) { res.status(409).json({ error: reverted }); return; }
  res.json({ ok: true });
}

/** Why this undo must not write, or null when the accept is still the current assignment. */
function undoRefusal(sug: AcceptedSuggestion): string | null {
  if (sug.status !== 'accepted') return 'Only an accepted suggestion can be set back to pending';
  if (sug.assignee_login !== sug.to_login) {
    return 'Cannot undo this suggestion because the task is no longer assigned to the member who received it';
  }
  if (!sug.from_login) return 'Cannot undo this suggestion because the original assignee has no GitHub login';
  return null;
}

export default router;
