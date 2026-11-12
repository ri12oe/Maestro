import { Router, Request, Response } from 'express';
import db from '../db/client.js';

type TeamParams = { teamId: string };

const VALID_KINDS = ['design', 'research', 'meeting', 'coordination', 'other'] as const;

const router = Router({ mergeParams: true });

// POST /api/teams/:teamId/manual
router.post('/', (req: Request<TeamParams>, res: Response) => {
  const teamId = Number(req.params.teamId);
  const { member_id, title, body, kind, link, task_id } = req.body as Record<string, unknown>;

  if (typeof member_id !== 'number' && typeof member_id !== 'string') {
    res.status(400).json({ error: 'member_id is required' });
    return;
  }
  if (typeof title !== 'string' || !title.trim()) {
    res.status(400).json({ error: 'title is required' });
    return;
  }
  if (kind !== undefined && kind !== null && !VALID_KINDS.includes(kind as typeof VALID_KINDS[number])) {
    res.status(400).json({ error: `kind must be one of: ${VALID_KINDS.join(', ')}` });
    return;
  }

  const member = db.prepare('SELECT id FROM members WHERE id = ? AND team_id = ?')
    .get(Number(member_id), teamId);
  if (!member) { res.status(404).json({ error: 'Member not found' }); return; }

  // Validate task_id belongs to this team if provided
  if (task_id !== undefined && task_id !== null) {
    const task = db.prepare('SELECT id FROM tasks WHERE id = ? AND team_id = ?')
      .get(Number(task_id), teamId);
    if (!task) { res.status(404).json({ error: 'Task not found in this team' }); return; }
  }

  const result = db.prepare(`
    INSERT INTO contributions
      (team_id, member_id, source, title, body, kind, link, authored_at)
    VALUES
      (?, ?, 'manual', ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  `).run(teamId, Number(member_id), title.trim(), body ?? null, kind ?? null, link ?? null);

  // Optionally record task association via task_matches (manual — no embedding)
  if (task_id !== undefined && task_id !== null) {
    db.prepare(`
      INSERT INTO task_matches (contribution_id, task_id, similarity_score)
      VALUES (?, ?, 1.0)
      ON CONFLICT DO NOTHING
    `).run(result.lastInsertRowid, Number(task_id));
  }

  const contribution = db.prepare('SELECT * FROM contributions WHERE id = ?')
    .get(result.lastInsertRowid);

  res.status(201).json(contribution);
});

// GET /api/teams/:teamId/manual
router.get('/', (req: Request<TeamParams>, res: Response) => {
  const entries = db.prepare(`
    SELECT c.*, m.github_login, m.display_name
    FROM contributions c
    JOIN members m ON m.id = c.member_id
    WHERE c.team_id = ? AND c.source = 'manual'
    ORDER BY c.authored_at DESC
  `).all(Number(req.params.teamId));
  res.json(entries);
});

export default router;
