/**
 * production-client.test.ts — Express serves the built Vite client in production.
 *
 * `/` and a deep client route return index.html. A file under /assets/ is
 * served with its content type. An API route still returns JSON, and an
 * unknown /api path is a JSON 404 rather than index.html.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import express from 'express';
import request from 'supertest';
import { serveProductionClient } from '../serveClient.js';

const dist = mkdtempSync(join(tmpdir(), 'prod-client-'));
mkdirSync(join(dist, 'assets'));
const indexHtml = '<!doctype html><title>fixture</title><div id="root"></div>';
writeFileSync(join(dist, 'index.html'), indexHtml);
writeFileSync(join(dist, 'assets', 'app.js'), 'console.log("fixture")\n');

const app = express();
app.use(express.json());
app.get('/api/teams', (_req, res) => {
  res.json([]);
});
serveProductionClient(app, dist);

afterAll(() => {
  rmSync(dist, { recursive: true, force: true });
});

describe('production client', () => {
  it('serves index.html at /', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toBe(indexHtml);
  });

  it('falls back to index.html for a deep client route', async () => {
    const res = await request(app).get('/teams/1');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toBe(indexHtml);
  });

  it('serves a static asset with its content type', async () => {
    const res = await request(app).get('/assets/app.js');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.text).toBe('console.log("fixture")\n');
  });

  it('keeps an API route as JSON', async () => {
    const res = await request(app).get('/api/teams');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual([]);
  });

  it('returns JSON 404 for an unknown /api path', async () => {
    const get = await request(app).get('/api/does-not-exist');
    expect(get.status).toBe(404);
    expect(get.headers['content-type']).toMatch(/application\/json/);
    expect(get.body).toEqual({ error: 'Not found' });

    const post = await request(app).post('/api/does-not-exist');
    expect(post.status).toBe(404);
    expect(post.headers['content-type']).toMatch(/application\/json/);
    expect(post.body).toEqual({ error: 'Not found' });
  });
});
