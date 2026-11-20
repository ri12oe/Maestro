import { Router, Request, Response } from 'express';
import * as z from 'zod';
import db from '../db/client.js';
import { SUBSTANCES, WORK_TYPES } from '../ai/classifier.js';
import { runReasoner } from '../ai/reasoner.js';

type TeamParams = { teamId: string };

const router = Router({ mergeParams: true });

const labelColumns = `cl.work_type, cl.substance, cl.summary, cl.disputed, cl.dispute_note,
           cl.original_work_type, cl.original_substance, cl.corrected_at`;

// GET /api/teams/:teamId/contributions?memberId=&source=&taskId=
router.get('/', (req: Request<TeamParams>, res: Response) => {
  const teamId = Number(req.params.teamId);
  const { memberId, source, taskId } = req.query as Record<string, string | undefined>;

  let sql = `
    SELECT c.id, c.member_id, c.source, c.github_sha, c.title, c.body, c.kind, c.link, c.url,
           c.files_changed, c.additions, c.deletions, c.authored_at,
           ${labelColumns},
           t.id AS task_id, t.github_issue_number AS task_number, t.title AS task_title
    FROM contributions c
    LEFT JOIN effective_classifications cl ON cl.contribution_id = c.id
    LEFT JOIN task_matches tm ON tm.contribution_id = c.id
    LEFT JOIN tasks t ON t.id = tm.task_id
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
    SELECT c.*, ${labelColumns},
           tm.task_id, tm.similarity_score
    FROM contributions c
    LEFT JOIN effective_classifications cl ON cl.contribution_id = c.id
    LEFT JOIN task_matches tm ON tm.contribution_id = c.id
    WHERE c.id = ? AND c.team_id = ?
  `).get(Number(req.params.contributionId), Number(req.params.teamId));

  if (!row) { res.status(404).json({ error: 'Contribution not found' }); return; }
  res.json(row);
});

const DisputeBody = z.object({
  note: z.string().nullable().optional(),
  work_type: z.enum(WORK_TYPES).optional(),
  substance: z.enum(SUBSTANCES).optional(),
  undo: z.boolean().optional(),
});

type LabelRow = {
  work_type: (typeof WORK_TYPES)[number];
  substance: (typeof SUBSTANCES)[number];
  original_work_type: (typeof WORK_TYPES)[number] | null;
  original_substance: (typeof SUBSTANCES)[number] | null;
  corrected_at: string | null;
  disputed: number;
  dispute_note: string | null;
};

function disputeError(error: z.ZodError): string {
  const issue = error.issues[0];
  const field = issue?.path[0];
  if (field === 'work_type') {
    return `work_type must be one of: ${WORK_TYPES.join(', ')}`;
  }
  if (field === 'substance') {
    return `substance must be one of: ${SUBSTANCES.join(', ')}`;
  }
  if (field === 'note') return 'note must be a string';
  if (field === 'undo') return 'undo must be a boolean';
  return 'Invalid dispute';
}

function readLabel(teamId: number, contributionId: number): LabelRow | undefined {
  return db.prepare(`
    SELECT cl.work_type, cl.substance, cl.original_work_type, cl.original_substance,
           cl.corrected_at, cl.disputed, cl.dispute_note
    FROM classifications cl
    JOIN contributions c ON c.id = cl.contribution_id
    WHERE cl.contribution_id = ? AND c.team_id = ?
  `).get(contributionId, teamId) as LabelRow | undefined;
}

function labelPayload(row: LabelRow) {
  return {
    ok: true as const,
    disputed: (row.disputed ? 1 : 0) as 0 | 1,
    work_type: row.work_type,
    substance: row.substance,
    original_work_type: row.original_work_type,
    original_substance: row.original_substance,
    corrected_at: row.corrected_at,
  };
}

// POST /api/teams/:teamId/contributions/:contributionId/dispute
// A note alone flags the label. work_type and/or substance replace the
// effective label and keep the AI label in original_* so it can be undone.
// { undo: true } restores that AI label. A correction or an undo re-runs the
// risk reasoner before the response, the same step a sync finishes with.
router.post('/:contributionId/dispute', async (req: Request<TeamParams & { contributionId: string }>, res: Response) => {
  const parsed = DisputeBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: disputeError(parsed.error) });
    return;
  }
  const body = parsed.data;
  if (body.undo && (body.work_type !== undefined || body.substance !== undefined)) {
    res.status(400).json({ error: 'undo cannot be combined with a new label' });
    return;
  }

  const teamId = Number(req.params.teamId);
  const contributionId = Number(req.params.contributionId);
  const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
  if (!team) { res.status(404).json({ error: 'Team not found' }); return; }
  const contribution = db.prepare('SELECT id FROM contributions WHERE id = ? AND team_id = ?').get(contributionId, teamId);
  if (!contribution) { res.status(404).json({ error: 'Contribution not found' }); return; }

  const current = readLabel(teamId, contributionId);
  if (!current) { res.status(404).json({ error: 'Classification not found' }); return; }

  const note = body.note === undefined ? undefined : (body.note?.trim() || null);
  const correcting = body.work_type !== undefined || body.substance !== undefined;
  let refreshRisks = false;

  if (body.undo) {
    if (!current.corrected_at || !current.original_work_type || !current.original_substance) {
      res.status(409).json({ error: 'This label has no correction to undo' });
      return;
    }
    db.prepare(`
      UPDATE classifications
      SET work_type = original_work_type,
          substance = original_substance,
          original_work_type = NULL,
          original_substance = NULL,
          corrected_at = NULL,
          disputed = 0,
          dispute_note = NULL
      WHERE contribution_id = ?
        AND corrected_at IS NOT NULL
    `).run(contributionId);
    refreshRisks = true;
  } else if (correcting) {
    const nextType = body.work_type ?? current.work_type;
    const nextSubstance = body.substance ?? current.substance;
    // The first correction snapshots the AI label. A later correction keeps it.
    const originalType = current.original_work_type ?? current.work_type;
    const originalSubstance = current.original_substance ?? current.substance;
    const disputeNote = note === undefined ? current.dispute_note : note;
    db.prepare(`
      UPDATE classifications
      SET work_type = ?,
          substance = ?,
          original_work_type = ?,
          original_substance = ?,
          corrected_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now'),
          disputed = 1,
          dispute_note = ?
      WHERE contribution_id = ?
    `).run(nextType, nextSubstance, originalType, originalSubstance, disputeNote, contributionId);
    refreshRisks = true;
  } else {
    const disputeNote = note === undefined ? current.dispute_note : note;
    db.prepare(`
      UPDATE classifications
      SET disputed = 1, dispute_note = ?
      WHERE contribution_id = ?
    `).run(disputeNote, contributionId);
  }

  if (refreshRisks) {
    try {
      await runReasoner(teamId);
    } catch (err) {
      console.error('[dispute] risk refresh failed:', err instanceof Error ? err.message : err);
      res.status(500).json({ error: 'The label was saved, but risks could not be refreshed' });
      return;
    }
  }

  const saved = readLabel(teamId, contributionId);
  if (!saved) { res.status(404).json({ error: 'Classification not found' }); return; }
  res.json(labelPayload(saved));
});

export default router;
