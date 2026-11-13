/**
 * GET /api/teams/:teamId/summary
 *
 * Returns:
 *   statCards:
 *     tasksDone      — count of closed tasks
 *     tasksTotal     — count of all tasks
 *     tasksAtRisk    — number of distinct tasks with an active (non-dismissed) risk
 *     pendingSuggestions — count of pending suggestions
 *   members: (alphabetical order, never sorted by work amount)
 *     memberId, login, displayName
 *     workCounts    — { [work_type]: count } from classifications
 *     substanceShares — weighted share per work_type (low=1, medium=2, high=3)
 *     focusSummary  — one-line description of dominant work area
 */

import { Router, Request, Response } from 'express';
import db from '../db/client.js';

type TeamParams = { teamId: string };

const router = Router({ mergeParams: true });

const SUBSTANCE_WEIGHT: Record<string, number> = { low: 1, medium: 2, high: 3 };

function focusSummary(
  workCounts: Record<string, number>,
  topDirs: string[],
): string {
  const sorted = Object.entries(workCounts).sort((a, b) => b[1] - a[1]);
  if (sorted.length === 0) return 'No contributions yet';

  const topType = sorted[0][0];
  const dirHint = topDirs.length > 0 ? `, active in ${topDirs.slice(0, 2).join(' & ')}` : '';

  const typeLabel: Record<string, string> = {
    feature: 'Feature development',
    fix: 'Bug fixes',
    test: 'Testing',
    refactor: 'Refactoring',
    docs: 'Documentation',
    formatting: 'Code style',
    generated: 'Generated files',
    design: 'Design & UX',
    other: 'General contributions',
  };

  return `${typeLabel[topType] ?? topType}${dirHint}`;
}

router.get('/', (req: Request<TeamParams>, res: Response) => {
  const teamId = Number(req.params.teamId);

  const team = db.prepare('SELECT id FROM teams WHERE id = ?').get(teamId);
  if (!team) { res.status(404).json({ error: 'Team not found' }); return; }

  // ── Stat cards ──────────────────────────────────────────────────────────
  const { tasks_done: tasksDone, tasks_total: tasksTotal } = db.prepare(`
    SELECT
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS tasks_done,
      COUNT(*) AS tasks_total
    FROM tasks WHERE team_id = ?
  `).get(teamId) as { tasks_done: number; tasks_total: number };

  const { n: tasksAtRisk } = db.prepare(
    'SELECT COUNT(DISTINCT task_id) AS n FROM risks WHERE team_id = ? AND dismissed = 0 AND task_id IS NOT NULL',
  ).get(teamId) as { n: number };

  const { n: pendingSuggestions } = db.prepare(
    "SELECT COUNT(*) AS n FROM suggestions WHERE team_id = ? AND status = 'pending'",
  ).get(teamId) as { n: number };

  // ── Members (alphabetical) ───────────────────────────────────────────────
  const members = db.prepare(`
    SELECT id, github_login, display_name
    FROM members
    WHERE team_id = ? AND github_login IS NOT NULL AND display_name != 'Unknown Contributor'
    ORDER BY display_name ASC
  `).all(teamId) as Array<{ id: number; github_login: string; display_name: string }>;

  const memberData = members.map(m => {
    // Work-type × substance counts
    const classRows = db.prepare(`
      SELECT cl.work_type, cl.substance, COUNT(*) AS n
      FROM classifications cl
      JOIN contributions c ON c.id = cl.contribution_id
      WHERE c.member_id = ?
      GROUP BY cl.work_type, cl.substance
    `).all(m.id) as Array<{ work_type: string; substance: string; n: number }>;

    const workCounts: Record<string, number> = {};
    const weightedTotals: Record<string, number> = {};
    let totalWeight = 0;

    for (const r of classRows) {
      workCounts[r.work_type] = (workCounts[r.work_type] ?? 0) + r.n;
      const w = (SUBSTANCE_WEIGHT[r.substance] ?? 1) * r.n;
      weightedTotals[r.work_type] = (weightedTotals[r.work_type] ?? 0) + w;
      totalWeight += w;
    }

    const substanceShares: Record<string, number> = {};
    if (totalWeight > 0) {
      for (const [wt, w] of Object.entries(weightedTotals)) {
        substanceShares[wt] = Math.round((w / totalWeight) * 100) / 100;
      }
    }

    // Top directories from paths
    const pathRows = db.prepare(`
      SELECT paths FROM contributions
      WHERE member_id = ? AND source = 'commit' AND paths IS NOT NULL
    `).all(m.id) as Array<{ paths: string }>;

    const dirCounts = new Map<string, number>();
    for (const row of pathRows) {
      let paths: string[];
      try { paths = JSON.parse(row.paths); } catch { continue; }
      for (const p of paths) {
        const d = p.split('/')[0];
        if (d) dirCounts.set(d, (dirCounts.get(d) ?? 0) + 1);
      }
    }
    const topDirs = [...dirCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2)
      .map(([d]) => d);

    return {
      memberId: m.id,
      login: m.github_login,
      displayName: m.display_name,
      workCounts,
      substanceShares,
      focusSummary: focusSummary(workCounts, topDirs),
    };
  });

  res.json({
    statCards: {
      tasksDone: tasksDone ?? 0,
      tasksTotal: tasksTotal ?? 0,
      tasksAtRisk: tasksAtRisk ?? 0,
      pendingSuggestions: pendingSuggestions ?? 0,
    },
    members: memberData,
  });
});

export default router;
