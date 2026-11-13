/**
 * classifier.ts — classify contributions with the AI provider.
 *
 * One AI call per contribution:
 *   Input:  commit title, diff_summary, team's open tasks as "#N: title"
 *   Output: work_type, substance, summary, task_number, match_confidence
 *
 * Rules:
 *   - Skip contributions that already have a classifications row.
 *   - Write a task_matches row only when task_number is a real open task
 *     AND match_confidence is not 'low'.
 *   - Never overwrite a task_matches row that a person set by hand
 *     (matched_at IS NOT NULL is not the signal — we use a 'manual' column
 *     approach; in practice we just skip if a row already exists for the
 *     contribution_id).
 *   - model_version = "grok:<model>:prompt-v1"
 *
 * Mock mode: keyword rules for work_type; keyword overlap (4+ letter words)
 * for task matching.
 */

import * as z from 'zod';
import db from '../db/client.js';
import { completeJSON } from './provider.js';

// ── Schema ────────────────────────────────────────────────────────────────────

const ClassificationSchema = z.object({
  work_type: z.enum(['feature', 'fix', 'test', 'refactor', 'docs', 'formatting', 'generated']),
  substance: z.enum(['low', 'medium', 'high']),
  summary: z.string(),
  task_number: z.number().int().nullable(),
  match_confidence: z.enum(['low', 'medium', 'high']),
});

type Classification = z.infer<typeof ClassificationSchema>;

// ── Task row from DB ──────────────────────────────────────────────────────────

interface TaskRow {
  id: number;
  github_issue_number: number | null;
  title: string;
  status: string;
}

interface ContribRow {
  id: number;
  title: string;
  diff_summary: string | null;
}

// ── Mock classifier logic ─────────────────────────────────────────────────────

const WORK_TYPE_KEYWORDS: Record<string, string[]> = {
  test:       ['test', 'spec', 'jest', 'vitest', 'coverage', 'assert'],
  fix:        ['fix', 'bug', 'patch', 'hotfix', 'repair', 'resolve', 'revert'],
  refactor:   ['refactor', 'rename', 'restructure', 'reorganize', 'cleanup', 'extract', 'move'],
  docs:       ['doc', 'readme', 'comment', 'changelog', 'docs', 'licence', 'license'],
  formatting: ['format', 'lint', 'style', 'indent', 'whitespace', 'prettier', 'eslint'],
  generated:  ['generated', 'auto-generated', 'scaffold', 'boilerplate', 'codegen', 'lock', 'package-lock'],
  feature:    ['add', 'implement', 'create', 'build', 'feature', 'new', 'introduce', 'support'],
};

function mockWorkType(title: string, diffSummary: string | null): Classification['work_type'] {
  const text = `${title} ${diffSummary ?? ''}`.toLowerCase();
  for (const [type, keywords] of Object.entries(WORK_TYPE_KEYWORDS)) {
    if (keywords.some(k => text.includes(k))) {
      return type as Classification['work_type'];
    }
  }
  return 'feature';
}

function mockSubstance(diffSummary: string | null): Classification['substance'] {
  const lines = (diffSummary ?? '').split('\n').filter(l => l.startsWith('+') || l.startsWith('-')).length;
  if (lines >= 50) return 'high';
  if (lines >= 10) return 'medium';
  return 'low';
}

/** Words of 4+ letters shared between commit title and task title */
function sharedLongWords(a: string, b: string): number {
  const words = (s: string) =>
    new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const wa = words(a);
  const wb = words(b);
  let count = 0;
  for (const w of wa) if (wb.has(w)) count++;
  return count;
}

function mockClassify(
  title: string,
  diffSummary: string | null,
  openTasks: TaskRow[],
): Classification {
  const work_type = mockWorkType(title, diffSummary);
  const substance = mockSubstance(diffSummary);

  let best: { task: TaskRow; score: number } | null = null;
  for (const task of openTasks) {
    const score = sharedLongWords(title, task.title);
    if (score > 0 && (!best || score > best.score)) {
      best = { task, score };
    }
  }

  const task_number = best ? best.task.github_issue_number : null;
  const match_confidence: Classification['match_confidence'] =
    best ? (best.score >= 3 ? 'high' : 'medium') : 'low';

  const summary = `${work_type} work: ${title.slice(0, 80)}`;

  return { work_type, substance, summary, task_number, match_confidence };
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPrompt(
  title: string,
  diffSummary: string | null,
  openTasks: TaskRow[],
): string {
  const taskList = openTasks
    .filter(t => t.github_issue_number != null)
    .map(t => `#${t.github_issue_number}: ${t.title}`)
    .join('\n');

  return `You are classifying a software commit for a student project tracker.

Commit title: ${title}
Diff summary (may be truncated):
${diffSummary ?? '(no diff available)'}

Open tasks for this team:
${taskList || '(none)'}

Respond with a JSON object matching the schema. Rules:
- work_type: one of feature, fix, test, refactor, docs, formatting, generated
- substance: low (trivial/tiny), medium (meaningful), high (significant chunk of work)
- summary: one sentence describing what this commit does
- task_number: the integer issue number from the list above that this commit most likely addresses, or null
- match_confidence: low/medium/high — how confident you are in the task_number match (use low if no match)`;
}

// ── Model version ─────────────────────────────────────────────────────────────

function modelVersion(): string {
  const provider = process.env.AI_PROVIDER ?? 'mock';
  if (provider === 'grok') {
    const model = process.env.GROK_MODEL ?? 'grok-3-mini';
    return `grok:${model}:prompt-v1`;
  }
  return 'mock:prompt-v1';
}

// ── Confidence → similarity score ─────────────────────────────────────────────

function confidenceToScore(c: Classification['match_confidence']): number {
  return c === 'high' ? 0.9 : 0.7;
}

// ── Main classifier function ──────────────────────────────────────────────────

/**
 * Classify all unclassified contributions for a team.
 * Returns the number of contributions newly classified.
 */
export async function classifyTeam(teamId: number): Promise<number> {
  // Load open tasks
  const openTasks = db
    .prepare(
      `SELECT id, github_issue_number, title, status
       FROM tasks
       WHERE team_id = ? AND status = 'open'`,
    )
    .all(teamId) as TaskRow[];

  // Load contributions that do NOT yet have a classifications row
  const unclassified = db
    .prepare(
      `SELECT c.id, c.title, c.diff_summary
       FROM contributions c
       LEFT JOIN classifications cl ON cl.contribution_id = c.id
       WHERE c.team_id = ? AND cl.id IS NULL`,
    )
    .all(teamId) as ContribRow[];

  if (unclassified.length === 0) return 0;

  const provider = process.env.AI_PROVIDER ?? 'mock';
  const mv = modelVersion();

  const insertClassification = db.prepare(`
    INSERT INTO classifications
      (contribution_id, work_type, substance, summary, classified_at, model_version)
    VALUES
      (@contribution_id, @work_type, @substance, @summary,
       strftime('%Y-%m-%dT%H:%M:%SZ', 'now'), @model_version)
    ON CONFLICT (contribution_id) DO NOTHING
  `);

  // Insert a task_match only if no row already exists for this contribution
  // (prevents overwriting hand-set matches)
  const getTaskMatch = db.prepare(
    'SELECT id FROM task_matches WHERE contribution_id = ?',
  );

  const insertTaskMatch = db.prepare(`
    INSERT INTO task_matches (contribution_id, task_id, similarity_score, matched_at)
    VALUES (@contribution_id, @task_id, @similarity_score,
            strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
  `);

  // Map github_issue_number → task row for fast lookup
  const taskByNumber = new Map<number, TaskRow>();
  for (const t of openTasks) {
    if (t.github_issue_number != null) taskByNumber.set(t.github_issue_number, t);
  }

  let count = 0;

  for (const contrib of unclassified) {
    let result: Classification;

    if (provider === 'mock') {
      result = mockClassify(contrib.title, contrib.diff_summary, openTasks);
    } else {
      const prompt = buildPrompt(contrib.title, contrib.diff_summary, openTasks);
      result = await completeJSON(prompt, ClassificationSchema, 'CommitClassification');
    }

    insertClassification.run({
      contribution_id: contrib.id,
      work_type: result.work_type,
      substance: result.substance,
      summary: result.summary,
      model_version: mv,
    });

    // Write task_match if appropriate
    if (
      result.task_number != null &&
      result.match_confidence !== 'low' &&
      taskByNumber.has(result.task_number)
    ) {
      const task = taskByNumber.get(result.task_number)!;
      const existing = getTaskMatch.get(contrib.id) as { id: number } | undefined;
      if (!existing) {
        insertTaskMatch.run({
          contribution_id: contrib.id,
          task_id: task.id,
          similarity_score: confidenceToScore(result.match_confidence),
        });
      }
    }

    count++;
  }

  return count;
}
