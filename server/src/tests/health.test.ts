/**
 * health.test.ts — GET /api/health
 *
 * Railway probes this path with no credentials. It stays 200 after `SELECT 1`
 * while the site password is set. Every other path still asks for auth.
 * A thrown query is 503 with a fixed error and none of the thrown text.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import request from 'supertest';
import Database from 'better-sqlite3';

const tmpDir = mkdtempSync(join(tmpdir(), 'health-'));
process.env.DB_PATH = join(tmpDir, 'test.db');
process.env.SITE_PASSWORD = 's3cret';
process.env.SITE_USER = 'maestro';

const { default: db } = await import('../db/client.js');
const { default: healthRouter, createHealthRouter } = await import('../routes/health.js');
const { default: teamsRouter } = await import('../routes/teams.js');
const { sitePassword } = await import('../middleware/sitePassword.js');

function gatedApp(health = healthRouter) {
  const app = express();
  app.use(sitePassword());
  app.use(express.json());
  app.use('/api/health', health);
  app.use('/api/teams', teamsRouter);
  app.get('/api/healthz', (_req, res) => res.json({ ok: true }));
  app.get('/api/health/extra', (_req, res) => res.json({ ok: true }));
  app.get('/', (_req, res) => res.type('html').send('<p>home</p>'));
  return app;
}

afterAll(() => {
  db.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
});

describe('GET /api/health', () => {
  it('returns 200 { ok: true } with the site password set and no auth header', async () => {
    const res = await request(gatedApp()).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['www-authenticate']).toBeUndefined();
    expect(res.body).toEqual({ ok: true });
    expect(res.text).not.toContain(tmpDir);
    expect(res.text).not.toContain('s3cret');
    expect(res.text).not.toContain('SITE_PASSWORD');
  });

  it('still returns 401 for every other path when no credentials are sent', async () => {
    const app = gatedApp();
    for (const path of ['/api/teams', '/api/healthz', '/api/health/extra', '/']) {
      const res = await request(app).get(path);
      expect(res.status, path).toBe(401);
      expect(res.headers['www-authenticate']).toMatch(/Basic/);
    }
  });

  it('returns 503 { ok: false, error } when the database query throws', async () => {
    const closed = new Database(':memory:');
    closed.close();
    const leaked = `unable to open ${process.env.DB_PATH} SITE_PASSWORD=s3cret`;
    const failing = createHealthRouter({
      prepare() {
        throw new Error(leaked);
      },
    });

    const injected = await request(gatedApp(failing)).get('/api/health');
    expect(injected.status).toBe(503);
    expect(injected.body).toEqual({ ok: false, error: 'Database check failed' });
    expect(injected.text).not.toContain(leaked);
    expect(injected.text).not.toContain(tmpDir);
    expect(injected.text).not.toContain('s3cret');

    const real = await request(gatedApp(createHealthRouter(closed))).get('/api/health');
    expect(real.status).toBe(503);
    expect(real.body).toEqual({ ok: false, error: 'Database check failed' });
    expect(real.text).not.toContain('not open');
  });
});
