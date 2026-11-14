import { afterEach, describe, expect, it } from 'vitest';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { defaultDbPath, repoRoot, resolveDbPath } from '../db/paths.js';

const originalCwd = process.cwd();
const originalDbPath = process.env.DB_PATH;

afterEach(() => {
  process.chdir(originalCwd);
  if (originalDbPath === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = originalDbPath;
});

describe('resolveDbPath', () => {
  it('resolves a relative path against the repo root regardless of cwd', () => {
    expect(existsSync(join(repoRoot(), 'package.json'))).toBe(true);

    process.chdir(join(repoRoot(), 'server'));
    expect(resolveDbPath('./dev.db')).toBe(join(repoRoot(), 'dev.db'));

    process.env.DB_PATH = './dev.db';
    expect(resolveDbPath()).toBe(join(repoRoot(), 'dev.db'));

    process.chdir(tmpdir());
    expect(resolveDbPath('./dev.db')).toBe(join(repoRoot(), 'dev.db'));
    expect(resolveDbPath('data/custom.db')).toBe(join(repoRoot(), 'data', 'custom.db'));
  });

  it('keeps an absolute path unchanged', () => {
    process.chdir(join(repoRoot(), 'server'));
    expect(resolveDbPath('/data/maestro.db')).toBe('/data/maestro.db');

    process.env.DB_PATH = '/data/maestro.db';
    expect(resolveDbPath()).toBe('/data/maestro.db');
  });

  it('uses the default when DB_PATH is unset', () => {
    delete process.env.DB_PATH;
    process.chdir(join(repoRoot(), 'server'));

    expect(resolveDbPath()).toBe(defaultDbPath());
    expect(resolveDbPath(undefined)).toBe(join(repoRoot(), 'dev.db'));
  });
});
