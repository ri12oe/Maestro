import { Router, Request, Response } from 'express';
import db from '../db/client.js';

type TeamParams = { teamId: string };

const router = Router({ mergeParams: true });

// GET /api/teams/:teamId/contributions?memberId=&source=&taskId=
router.get('/', (req: Request<TeamParams>, res: Response) => {
  const teamId = Number(req.params.teamId);
  const { memberId, source, taskId } = req.query as Record<string, string | undefined>;

  let sql = `
    SELECT c.*, cl.work_type, cl.substance, cl.summary, cl.disputed
    FROM contributions c
    LEFT JOIN classifications cl ON cl.contribution_id = c.id
    WHERE c.team_id = ?
  `;
  const params: unknown[] = [teamId];

  if (memberId) { sql += ' AND c.member_id = ?'; params.push(Number(memberId)); }
  if (source)   { sql += ' AND c.source = ?';    params.push(source); }
  if (taskId) {
    sql += ' AND c.id IN (SELECT contribution_id FROM task_matches WHERE task_id = ?)';
    params.push(Number(taskId));
  }

  sql += ' ORDER BY c.authored_at DESC';

  res.json(db.prepare(sql).all(...params));
});

// GET /api/teams/:teamId/contributions/:contributionId
router.get('/:contributionId', (req: Request<TeamParams & { contributionId: string }>, res: Response) => {
  const row = db.prepare(`
    SELECT c.*, cl.work_type, cl.substance, cl.summary, cl.disputed, cl.dispute_note,
           tm.task_id, tm.similarity_score
    FROM contributions c
    LEFT JOIN classifications cl ON cl.contribution_id = c.id
    LEFT JOIN task_matches tm ON tm.contribution_id = c.id
    WHERE c.id = ? AND c.team_id = ?
  `).get(Number(req.params.contributionId), Number(req.params.teamId));

  if (!row) { res.status(404).json({ error: 'Contribution not found' }); return; }
  res.json(row);
});

// POST /api/teams/:teamId/contributions/:contributionId/dispute
router.post('/:contributionId/dispute', (req: Request<TeamParams & { contributionId: string }>, res: Response) => {
  const { note } = req.body as { note?: string };
  const result = db.prepare(`
    UPDATE classifications
    SET disputed = 1, dispute_note = ?
    WHERE contribution_id = ?
      AND contribution_id IN (
        SELECT id FROM contributions WHERE id = ? AND team_id = ?
      )
  `).run(
    note ?? null,
    Number(req.params.contributionId),
    Number(req.params.contributionId),
    Number(req.params.teamId),
  );

  if (result.changes === 0) {
    res.status(404).json({ error: 'Classification not found or access denied' });
    return;
  }
  res.json({ ok: true });
});

export default router;
