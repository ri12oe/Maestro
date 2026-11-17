import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { sitePassword } from '../middleware/sitePassword.js';

function appWith(password?: string, user?: string) {
  const app = express();
  app.use(sitePassword(password, user));
  app.get('/api/ping', (_req, res) => res.json({ ok: true }));
  return app;
}

const basic = (u: string, p: string) => 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64');

describe('site password gate', () => {
  it('does nothing when no password is set', async () => {
    const res = await request(appWith(undefined)).get('/api/ping');
    expect(res.status).toBe(200);
  });

  it('asks for sign-in when a password is set and none is given', async () => {
    const res = await request(appWith('s3cret')).get('/api/ping');
    expect(res.status).toBe(401);
    expect(res.headers['www-authenticate']).toMatch(/Basic/);
  });

  it('rejects a wrong password or username', async () => {
    const app = appWith('s3cret');
    expect((await request(app).get('/api/ping').set('Authorization', basic('maestro', 'nope'))).status).toBe(401);
    expect((await request(app).get('/api/ping').set('Authorization', basic('someone', 's3cret'))).status).toBe(401);
  });

  it('lets the right credentials through, including a custom username', async () => {
    expect((await request(appWith('s3cret')).get('/api/ping').set('Authorization', basic('maestro', 's3cret'))).status).toBe(200);
    expect((await request(appWith('pw:with:colons', 'judge')).get('/api/ping').set('Authorization', basic('judge', 'pw:with:colons'))).status).toBe(200);
  });

  it('lets exactly /api/health through with no credentials', async () => {
    const app = express();
    app.use(sitePassword('s3cret'));
    app.get('/api/health', (_req, res) => res.json({ ok: true }));
    app.get('/api/teams', (_req, res) => res.json([]));
    app.get('/api/healthz', (_req, res) => res.json({ ok: true }));
    app.get('/api/health/extra', (_req, res) => res.json({ ok: true }));

    expect((await request(app).get('/api/health')).status).toBe(200);
    expect((await request(app).get('/api/health').set('Authorization', basic('maestro', 'nope'))).status).toBe(200);
    expect((await request(app).get('/api/teams')).status).toBe(401);
    expect((await request(app).get('/api/healthz')).status).toBe(401);
    expect((await request(app).get('/api/health/extra')).status).toBe(401);
  });
});
