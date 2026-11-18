import { Router, Request, Response } from 'express';
import db from '../db/client.js';

type TeamParams = { teamId: string };

const router = Router({ mergeParams: true });

// GET /api/teams/:teamId/members
router.get('/', (req: Request<TeamParams>, res: Response) => {
  const members = db
    .prepare('SELECT * FROM members WHERE team_id = ? ORDER BY added_at ASC')
    .all(Number(req.params.teamId));
  res.json(members);
});

// POST /api/teams/:teamId/members — add a member by GitHub login
router.post('/', (req: Request<TeamParams>, res: Response) => {
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
router.delete('/:memberId', (req: Request<TeamParams & { memberId: string }>, res: Response) => {
  const memberId = Number(req.params.memberId);
  const teamId = Number(req.params.teamId);

  // contributions.member_id and suggestions.from/to_member_id reference members
  // with no ON DELETE action, so deleting a linked member throws a foreign-key error.
  const hasContributions = db
    .prepare('SELECT 1 FROM contributions WHERE team_id = ? AND member_id = ? LIMIT 1')
    .get(teamId, memberId);
  const hasSuggestions = db
    .prepare(
      'SELECT 1 FROM suggestions WHERE team_id = ? AND (from_member_id = ? OR to_member_id = ?) LIMIT 1',
    )
    .get(teamId, memberId, memberId);

  if (hasContributions || hasSuggestions) {
    res.status(409).json({
      error: "Can't remove this member because they have logged work or suggestions. Keep them on the team so that history stays.",
    });
    return;
  }

  const result = db
    .prepare('DELETE FROM members WHERE id = ? AND team_id = ?')
    .run(memberId, teamId);

  if (result.changes === 0) {
    res.status(404).json({ error: 'Member not found' });
    return;
  }
  res.json({ ok: true });
});

export default router;
