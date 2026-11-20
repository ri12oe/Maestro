/**
 * team-report.test.ts — the project report is one team-wide opt-in.
 *
 * PATCH /api/teams/:teamId with { report_enabled: boolean } turns it on or off.
 * New teams start with it off. migration_006 adds the column to an older database.
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import Database from 'better-sqlite3';
import express from 'express';
import request from 'supertest';

const tmpDir = mkdtempSync(join(tmpdir(), 'team-report-'));
process.env.DB_PATH = join(tmpDir, 'test.db');
process.env.AI_PROVIDER = 'mock';

const { default: db } = await import('../db/client.js');
const { default: teamsRouter } = await import('../routes/teams.js');
const { runMigration } = await import('../db/migrate.js');

const app = express();
app.use(express.json());
app.use('/api/teams', teamsRouter);

afterAll(() => {
  db.close();
  try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* Windows may hold the file briefly */ }
});

let teamSeq = 0;
async function newTeam(): Promise<number> {
  teamSeq += 1;
  const created = await request(app).post('/api/teams').send({ name: 'Alpha', repo_owner: 'acme', repo_name: `app-${teamSeq}` });
  expect(created.status).toBe(201);
  return created.body.id as number;
}

describe('PATCH /api/teams/:teamId report_enabled', () => {
  it('starts off, turns on, and turns off again', async () => {
    const teamId = await newTeam();
    expect((await request(app).get(`/api/teams/${teamId}`)).body.report_enabled).toBe(0);

    const on = await request(app).patch(`/api/teams/${teamId}`).send({ report_enabled: true });
    expect(on.status).toBe(200);
    expect(on.body.report_enabled).toBe(1);

    const off = await request(app).patch(`/api/teams/${teamId}`).send({ report_enabled: false });
    expect(off.status).toBe(200);
    expect(off.body.report_enabled).toBe(0);
  });

  it('leaves the deadline alone when only report_enabled is sent', async () => {
    const teamId = await newTeam();
    await request(app).patch(`/api/teams/${teamId}`).send({ deadline: '2026-12-04' });
    const res = await request(app).patch(`/api/teams/${teamId}`).send({ report_enabled: true });
    expect(res.body.deadline).toBe('2026-12-04');
  });

  it('accepts both keys in one request', async () => {
    const teamId = await newTeam();
    const res = await request(app).patch(`/api/teams/${teamId}`).send({ deadline: '2026-12-01', report_enabled: true });
    expect(res.status).toBe(200);
    expect(res.body.deadline).toBe('2026-12-01');
    expect(res.body.report_enabled).toBe(1);
  });

  it.each(['yes', 1, null])('rejects report_enabled = %s', async value => {
    const teamId = await newTeam();
    const res = await request(app).patch(`/api/teams/${teamId}`).send({ report_enabled: value });
    expect(res.status).toBe(400);
  });

  it('still rejects an empty body', async () => {
    const teamId = await newTeam();
    const res = await request(app).patch(`/api/teams/${teamId}`).send({});
    expect(res.status).toBe(400);
  });
});

describe('migration_006', () => {
  it('adds report_enabled to a database without it', () => {
    const path = join(tmpDir, 'old.db');
    const old = new Database(path);
    old.exec(`CREATE TABLE teams (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, repo_owner TEXT NOT NULL, repo_name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')), last_synced_at TEXT,
      is_demo INTEGER NOT NULL DEFAULT 0, deadline TEXT)`);
    old.prepare("INSERT INTO teams (name, repo_owner, repo_name) VALUES ('Old', 'acme', 'old')").run();
    old.close();

    runMigration(path);

    const after = new Database(path);
    const row = after.prepare('SELECT report_enabled FROM teams').get() as { report_enabled: number };
    after.close();
    expect(row.report_enabled).toBe(0);
  });
});
