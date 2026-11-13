import { Router, Request, Response } from 'express';
import db from '../db/client.js';

type TeamParams = { teamId: string };

const router = Router({ mergeParams: true });

// GET /api/teams/:teamId/risks
router.get('/', (req: Request<TeamParams>, res: Response) => {
  const rows = db.prepare(`
    SELECT r.*, t.github_issue_number AS task_number, t.title AS task_title,
           t.due_date AS task_due_date, t.assignee_login AS task_assignee
    FROM risks r
    LEFT JOIN tasks t ON t.id = r.task_id
    WHERE r.team_id = ? AND r.dismissed = 0
    ORDER BY CASE r.level WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, r.id ASC
  `).all(Number(req.params.teamId)) as Array<Record<string, unknown> & { evidence: string | null }>;

  res.json(rows.map(r => {
    let evidence: Array<{ type: string; id: number }> = [];
    try { evidence = JSON.parse(r.evidence ?? '[]'); } catch { /* keep empty */ }
    return { ...r, evidence };
  }));
});

// POST /api/teams/:teamId/risks/:riskId/dismiss
router.post('/:riskId/dismiss', (req: Request<TeamParams & { riskId: string }>, res: Response) => {
  const result = db.prepare(
    'UPDATE risks SET dismissed = 1 WHERE id = ? AND team_id = ?',
  ).run(Number(req.params.riskId), Number(req.params.teamId));

  if (result.changes === 0) { res.status(404).json({ error: 'Risk not found' }); return; }
  res.json({ ok: true });
});

export default router;
