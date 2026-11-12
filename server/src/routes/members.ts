import { Router } from 'express';
import db from '../db/client.js';

const router = Router({ mergeParams: true });

// GET /api/teams/:teamId/members
router.get('/', (req, res) => {
  const members = db
    .prepare('SELECT * FROM members WHERE team_id = ? ORDER BY added_at ASC')
    .all(Number(req.params.teamId));
  res.json(members);
});

// POST /api/teams/:teamId/members — add a member by GitHub login
router.post('/', (req, res) => {
  const teamId = Number(req.params.teamId);
  const { github_login, display_name } = req.body as Record<string, unknown>;

  if (typeof github_login !== 'string' || !github_login.trim()) {
    res.status(400).json({ error: 'github_login is required' });
    return;
  }

  const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
  if (!team) {
    res.status(404).json({ error: 'Team not found' });
    return;
  }

  const result = db
    .prepare(
      `INSERT INTO members (team_id, github_login, display_name)
       VALUES (?, ?, ?)
       ON CONFLICT DO NOTHING`,
    )
    .run(teamId, github_login.trim(), (display_name as string | undefined) ?? null);

  const member = db
    .prepare('SELECT * FROM members WHERE team_id = ? AND github_login = ?')
    .get(teamId, github_login.trim());

  res.status(result.changes > 0 ? 201 : 200).json(member);
});

// DELETE /api/teams/:teamId/members/:memberId
router.delete('/:memberId', (req, res) => {
  const result = db
    .prepare('DELETE FROM members WHERE id = ? AND team_id = ?')
    .run(Number(req.params.memberId), Number(req.params.teamId));

  if (result.changes === 0) {
    res.status(404).json({ error: 'Member not found' });
    return;
  }
  res.json({ ok: true });
});

export default router;
