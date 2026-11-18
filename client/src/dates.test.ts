import { afterEach, describe, expect, it } from 'vitest';
import { daysAgo } from './dates.ts';

/**
 * Node reads the timezone from `process.env.TZ` when local date parts are read.
 * The client tsconfig has no Node types, so the test reaches `process` through `globalThis`.
 */
const nodeProcess = (globalThis as unknown as { process: { env: { TZ?: string } } }).process;
const previousTz = nodeProcess.env.TZ;

afterEach(() => {
  if (previousTz === undefined) delete nodeProcess.env.TZ;
  else nodeProcess.env.TZ = previousTz;
});

function useTz(tz: string): void {
  nodeProcess.env.TZ = tz;
}

/** Local calendar date in the timezone `useTz` just set. */
function localDate(year: number, month: number, day: number, hour = 0, minute = 0): Date {
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

describe('daysAgo', () => {
  it('labels 23:59 on the previous local day as yesterday just after midnight', () => {
    useTz('UTC');
    const now = localDate(2026, 11, 18, 0, 1);
    const prior = localDate(2026, 11, 17, 23, 59);
    expect(daysAgo(prior.toISOString(), now)).toBe('yesterday');
    expect(daysAgo(now.toISOString(), now)).toBe('today');
  });

  it('does not label 25 hours ago as yesterday when that instant is the day before yesterday', () => {
    useTz('America/Los_Angeles');
    const now = localDate(2026, 11, 18, 0, 30);
    const then = new Date(now.getTime() - 25 * 60 * 60 * 1000);
    expect(then.getDate()).toBe(16);
    expect(daysAgo(then.toISOString(), now)).toBe('2 days ago');
  });

  it.each([
    'America/Indianapolis',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'UTC',
  ])('labels a noon-UTC manual date for yesterday and today in %s', (tz) => {
    useTz(tz);
    // Morning of 18 Nov in UTC-8 through UTC: noon UTC on the 17th is still under 24h ago.
    const now = new Date('2026-11-18T08:30:00Z');
    expect(daysAgo('2026-11-17T12:00:00Z', now)).toBe('yesterday');
    expect(daysAgo('2026-11-18T12:00:00Z', now)).toBe('today');
  });

  it('keeps an older local calendar day as N days ago', () => {
    useTz('UTC');
    const now = localDate(2026, 11, 18, 15, 0);
    const then = localDate(2026, 11, 13, 23, 0);
    expect(daysAgo(then.toISOString(), now)).toBe('5 days ago');
  });
});
