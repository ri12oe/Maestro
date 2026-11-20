import { Router, Request, Response } from 'express';
import db from '../db/client.js';
import { ask, digest, digestWeekOf, planCheck, type Digest, type PlanCheck } from '../ai/assistant.js';

type TeamParams = { teamId: string };
const router = Router({ mergeParams: true });

export const MAX_QUESTION = 300;
const ASKS_PER_MINUTE = 20;

/**
 * Plan check is cached until the team's data changes, or the calendar day rolls.
 * The digest uses digestCacheVersion instead: one entry per team per week.
 */
function dataVersion(teamId: number): string {
  const row = db.prepare(`
    SELECT
      (SELECT last_synced_at FROM teams WHERE id = @t) AS synced,
      (SELECT deadline FROM teams WHERE id = @t) AS deadline,
      (SELECT COUNT(*) || ':' || IFNULL(MAX(id), 0) FROM contributions WHERE team_id = @t) AS contribs,
      (SELECT COUNT(*) || ':' || IFNULL(SUM(status = 'closed'), 0) FROM tasks WHERE team_id = @t) AS tasks,
      (SELECT COUNT(*) FROM risks WHERE team_id = @t AND dismissed = 0) AS risks
  `).get({ t: teamId }) as Record<string, unknown>;
  return `${new Date().toISOString().slice(0, 10)}|${Object.values(row).join('|')}`;
}

/** Per team per week, until contributions, tasks, risks, suggestions, labels (including a human correction), or the deadline change. */
function digestCacheVersion(teamId: number, weekOf: string): string {
  const row = db.prepare(`
    SELECT
      (SELECT deadline FROM teams WHERE id = @t) AS deadline,
      (SELECT COUNT(*) || ':' || IFNULL(MAX(id), 0) FROM contributions WHERE team_id = @t) AS contribs,
      (SELECT COUNT(*) || ':' || IFNULL(SUM(status = 'closed'), 0) FROM tasks WHERE team_id = @t) AS tasks,
      (SELECT IFNULL(MAX(id), 0) || ':' || IFNULL(MAX(generated_at), '') || ':' || IFNULL(SUM(length(description)), 0) || ':' || COUNT(*) FROM risks WHERE team_id = @t AND dismissed = 0) AS risks,
      (SELECT IFNULL(MAX(id), 0) || ':' || IFNULL(MAX(generated_at), '') || ':' || IFNULL(SUM(length(IFNULL(rationale, '') || IFNULL(checkin_message, ''))), 0) || ':' || IFNULL(SUM(status = 'pending'), 0) FROM suggestions WHERE team_id = @t) AS suggestions,
      (SELECT COUNT(*) || ':' || IFNULL(MAX(classified_at), '') || ':' || IFNULL(MAX(corrected_at), '') || ':' || IFNULL(group_concat(work_type || '/' || substance, ',' ORDER BY contribution_id), '') FROM classifications cl JOIN contributions c ON c.id = cl.contribution_id WHERE c.team_id = @t) AS labels
  `).get({ t: teamId }) as Record<string, unknown>;
  return `${weekOf}|${Object.values(row).join('|')}`;
}

const cache = new Map<string, { version: string; value: Digest | PlanCheck }>();
export function clearAssistantCache() { cache.clear(); }

async function cached<T extends Digest | PlanCheck>(key: string, teamId: number, refresh: boolean, make: () => Promise<T | null>, version = dataVersion(teamId)): Promise<T | null> {
  const hit = cache.get(key);
  if (!refresh && hit && hit.version === version) return hit.value as T;
  const value = await make();
  if (value) cache.set(key, { version, value });
  return value;
}

const recentAsks = new Map<number, number[]>();
function allowAsk(teamId: number): boolean {
  const now = Date.now();
  const list = (recentAsks.get(teamId) ?? []).filter(t => now - t < 60_000);
  if (list.length >= ASKS_PER_MINUTE) { recentAsks.set(teamId, list); return false; }
  list.push(now);
  recentAsks.set(teamId, list);
  return true;
}

function teamExists(teamId: number): boolean {
  return !!db.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId);
}

function aiError(res: Response, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('[assistant]', msg);
  res.status(502).json({ error: 'Maestro couldn’t reach the AI provider. Try again in a minute.' });
}

// POST /api/teams/:teamId/ask  { question }
router.post('/ask', async (req: Request<TeamParams>, res: Response) => {
  const teamId = Number(req.params.teamId);
  const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
  if (!question) { res.status(400).json({ error: 'Ask a question.' }); return; }
  if (question.length > MAX_QUESTION) { res.status(400).json({ error: `Keep questions under ${MAX_QUESTION} characters.` }); return; }
  if (!teamExists(teamId)) { res.status(404).json({ error: 'Team not found' }); return; }
  if (!allowAsk(teamId)) { res.status(429).json({ error: 'That’s a lot of questions at once. Try again in a minute.' }); return; }
  try { res.json(await ask(teamId, question)); }
  catch (err) { aiError(res, err); }
});

// GET /api/teams/:teamId/digest?days=7&refresh=1
// Cached per team per week until contributions, tasks, risks, suggestions, labels, or the deadline change.
router.get('/digest', async (req: Request<TeamParams>, res: Response) => {
  const teamId = Number(req.params.teamId);
  const days = Math.min(30, Math.max(1, Number(req.query.days) || 7));
  if (!teamExists(teamId)) { res.status(404).json({ error: 'Team not found' }); return; }
  const weekOf = digestWeekOf(new Date(), days);
  try {
    const body = await cached(
      `digest:${teamId}:${weekOf}`,
      teamId,
      req.query.refresh === '1',
      () => digest(teamId, days),
      digestCacheVersion(teamId, weekOf),
    );
    if (!body) { res.status(404).json({ error: 'Team not found' }); return; }
    res.json(body);
  } catch (err) { aiError(res, err); }
});

// GET /api/teams/:teamId/plan-check?refresh=1
router.get('/plan-check', async (req: Request<TeamParams>, res: Response) => {
  const teamId = Number(req.params.teamId);
  if (!teamExists(teamId)) { res.status(404).json({ error: 'Team not found' }); return; }
  try { res.json(await cached(`plan:${teamId}`, teamId, req.query.refresh === '1', () => planCheck(teamId))); }
  catch (err) { aiError(res, err); }
});

export default router;
