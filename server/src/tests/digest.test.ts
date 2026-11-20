/**
 * digest.test.ts — Weekly digest for the seeded StudyBuddy demo.
 *
 * The route is the same assistant router as the other team AI routes, so it
 * sits behind the same site-password gate in the app. These tests cover the
 * seeded team, a missing team, the response shape, and the fairness rules:
 * the check-in is non-empty, talks about tasks and risks, and does not rank
 * or blame anyone.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const TODAY = new Date('2031-01-15T12:00:00.000Z');
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(TODAY);
process.env.AI_PROVIDER = 'mock';

const { seedDemo } = await import('../db/seed.js');
const { default: db } = await import('../db/client.js');
const { default: assistantRouter } = await import('../routes/assistant.js');

const app = express();
app.use(express.json());
app.use('/api/teams/:teamId', assistantRouter);

const BLAME = /top contributor|leaderboard|laziest|slack(?:er|ing)|freeload|pulling (?:their|his|her) weight|\brank(?:ing|ed|s)?\b|\bgrad(?:e|es|ed|ing)\b|\bscor(?:e|es|ed|ing)\b|most work|least work|did more|did less|\bblame\b|you didn't|you did not|hasn't contributed|others have room|one teammate/i;
const NAMES = /\b(Sam|Jordan|Priya|Rio)\b/;

interface Evidence { type: 'task' | 'contribution'; id: number; url: string | null }
interface Claim { text: string; evidence: Evidence[] }
interface DigestBody {
  days: number;
  windowStart: string;
  windowEnd: string;
  summary: Claim[];
  highlights: Claim[];
  risks: Claim[];
  checkIn: string;
  checkInClaims: Claim[];
  generatedAt: string;
}

let teamId = 0;

beforeAll(async () => {
  const result = await seedDemo(db, TODAY);
  teamId = result.teamId;
});

afterAll(() => { db.close(); });

function sentences(text: string): string[] {
  return text.split(/(?<=[.!?])\s+/).map(s => s.trim()).filter(Boolean);
}

describe('GET /api/teams/:teamId/digest', () => {
  it('returns 404 for an unknown team', async () => {
    const res = await request(app).get('/api/teams/9999/digest');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Team not found' });
  });

  it('returns a sourced digest for the seeded StudyBuddy team', async () => {
    const res = await request(app).get(`/api/teams/${teamId}/digest`);
    expect(res.status).toBe(200);
    const body = res.body as DigestBody;

    expect(body.days).toBe(7);
    expect(body.windowStart).toBe('2031-01-08');
    expect(body.windowEnd).toBe('2031-01-15');
    const summary = body.summary.map(s => s.text).join(' ');
    expect(sentences(summary).length).toBeGreaterThanOrEqual(2);
    expect(sentences(summary).length).toBeLessThanOrEqual(4);
    expect(summary).toMatch(/last 7 days/);
    expect(summary).not.toMatch(/closed this week|closed in that window/);
    expect(body.checkIn.length).toBeGreaterThan(0);
    expect(Array.isArray(body.highlights)).toBe(true);
    expect(Array.isArray(body.risks)).toBe(true);
    expect(body.highlights.length).toBeGreaterThan(0);
    expect(body.risks.length).toBeGreaterThan(0);

    const taskIds = new Set((db.prepare('SELECT id FROM tasks WHERE team_id = ?').all(teamId) as Array<{ id: number }>).map(t => t.id));
    const contribIds = new Set((db.prepare('SELECT id FROM contributions WHERE team_id = ?').all(teamId) as Array<{ id: number }>).map(c => c.id));
    for (const item of [...body.summary, ...body.checkInClaims, ...body.highlights, ...body.risks]) {
      expect(item.text.length).toBeGreaterThan(0);
      expect(item.evidence.length).toBeGreaterThan(0);
      for (const e of item.evidence) {
        expect(e.type === 'task' ? taskIds : contribIds).toContain(e.id);
        expect(e.url === null || typeof e.url === 'string').toBe(true);
      }
    }
    const urls = body.highlights.flatMap(h => h.evidence.map(e => e.url));
    expect(urls.some(u => typeof u === 'string' && u.startsWith('https://'))).toBe(true);

    expect(body.risks.some(r => /#12|Auth flow/.test(r.text))).toBe(true);
    expect(body.checkIn).toMatch(/#12|Auth flow/);
    expect(body.checkIn).toMatch(/open|due|risk|task/i);
  });

  it('keeps the check-in neutral: tasks and risks, not blame or a ranking', async () => {
    const res = await request(app).get(`/api/teams/${teamId}/digest`);
    const body = res.body as DigestBody;
    const prose = [body.summary.map(s => s.text).join(' '), body.checkIn, ...body.highlights.map(h => h.text), ...body.risks.map(r => r.text)].join('\n');

    expect(body.checkIn.length).toBeGreaterThan(0);
    expect(prose).not.toMatch(BLAME);
    expect(body.summary.map(s => s.text).join(' ')).not.toMatch(NAMES);
    expect(body.checkIn).not.toMatch(NAMES);
    expect(body.checkIn).not.toMatch(/sam-builds|rio-dev|priya-code|jordan-qa/);
    expect(body.checkIn).toMatch(/#\d+|Auth flow|task|risk|due|open/i);
    expect(body.checkIn).not.toMatch(/you (didn't|did not|haven't|never)/i);
  });

  it('caches the digest for the week until refresh', async () => {
    const first = await request(app).get(`/api/teams/${teamId}/digest`);
    const contribId = (first.body as DigestBody).highlights
      .flatMap(h => h.evidence)
      .find(e => e.type === 'contribution')?.id;
    expect(contribId).toEqual(expect.any(Number));

    db.prepare('UPDATE classifications SET summary = ? WHERE contribution_id = ?').run('CACHE_MARKER unique digest line', contribId);
    const cached = await request(app).get(`/api/teams/${teamId}/digest`);
    expect(JSON.stringify(cached.body.highlights)).toBe(JSON.stringify(first.body.highlights));
    expect(JSON.stringify(cached.body.highlights)).not.toContain('CACHE_MARKER');

    const fresh = await request(app).get(`/api/teams/${teamId}/digest?refresh=1`);
    expect(JSON.stringify(fresh.body.highlights)).toContain('CACHE_MARKER');
  });

  it('rebuilds the digest when a risk is rewritten', async () => {
    const first = await request(app).get(`/api/teams/${teamId}/digest`);
    db.prepare(`UPDATE risks SET description = description || ' REWRITTEN', generated_at = '2031-02-01T00:00:00Z' WHERE team_id = ? AND level = 'high'`).run(teamId);
    const next = await request(app).get(`/api/teams/${teamId}/digest`);
    expect(JSON.stringify(next.body.risks)).toContain('REWRITTEN');
    expect(JSON.stringify(next.body.risks)).not.toBe(JSON.stringify((first.body as DigestBody).risks));
  });
});
