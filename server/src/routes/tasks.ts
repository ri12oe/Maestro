import { Router, Request, Response } from 'express';
import db from '../db/client.js';

type TeamParams = { teamId: string };

const router = Router({ mergeParams: true });

// GET /api/teams/:teamId/tasks
router.get('/', (req: Request<TeamParams>, res: Response) => {
  const tasks = db
    .prepare('SELECT id, team_id, github_issue_number, title, body, assignee_login, status, due_date, synced_at FROM tasks WHERE team_id = ? ORDER BY github_issue_number ASC')
    .all(Number(req.params.teamId));
  res.json(tasks);
});

// GET /api/teams/:teamId/tasks/:taskId
router.get('/:taskId', (req: Request<TeamParams & { taskId: string }>, res: Response) => {
  const task = db
    .prepare('SELECT id, team_id, github_issue_number, title, body, assignee_login, status, due_date, synced_at FROM tasks WHERE id = ? AND team_id = ?')
    .get(Number(req.params.taskId), Number(req.params.teamId));

  if (!task) { res.status(404).json({ error: 'Task not found' }); return; }

  const matched = db.prepare(`
    SELECT c.*, cl.work_type, cl.substance, cl.summary, tm.similarity_score
    FROM task_matches tm
    JOIN contributions c ON c.id = tm.contribution_id
    LEFT JOIN classifications cl ON cl.contribution_id = c.id
    WHERE tm.task_id = ?
    ORDER BY tm.similarity_score DESC
  `).all(Number(req.params.taskId));

  res.json({ ...task as object, contributions: matched });
});

export default router;
