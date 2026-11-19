import { afterEach, describe, expect, it } from 'vitest';
import { dayLabel, daysAgo, shortDate } from './dates.ts';

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

/** Hours between the local midnights of two instants. DST makes this 23 or 25. */
function localMidnightGapHours(earlier: Date, later: Date): number {
  return (new Date(later.toDateString()).getTime() - new Date(earlier.toDateString()).getTime()) / 3_600_000;
}

describe('dayLabel', () => {
  it('agrees with daysAgo across the US spring-forward', () => {
    useTz('America/New_York');
    // 8 Mar 2026 is 23 hours long (02:00 jumps to 03:00). Flooring that midnight gap by 24h yields 0, so the old label said Today.
    const now = localDate(2026, 3, 9, 0, 30);
    const springForwardDay = localDate(2026, 3, 8, 12, 0);
    expect(localMidnightGapHours(springForwardDay, now)).toBe(23);
    expect(dayLabel(springForwardDay.toISOString(), now)).toBe('Yesterday');
    expect(daysAgo(springForwardDay.toISOString(), now)).toBe('yesterday');
    expect(dayLabel(now.toISOString(), now)).toBe('Today');
    expect(daysAgo(now.toISOString(), now)).toBe('today');

    // Two calendar days later the same 23-hour gap floors to 1, so the old label said Yesterday.
    const twoDaysLater = localDate(2026, 3, 10, 9, 0);
    expect(localMidnightGapHours(springForwardDay, twoDaysLater)).toBe(47);
    expect(daysAgo(springForwardDay.toISOString(), twoDaysLater)).toBe('2 days ago');
    expect(dayLabel(springForwardDay.toISOString(), twoDaysLater)).toBe(shortDate(springForwardDay.toISOString()));
  });

  it('agrees with daysAgo across the US fall-back', () => {
    useTz('America/New_York');
    // 1 Nov 2026 is 25 hours long (02:00 falls back to 01:00). The next morning is still one calendar day later.
    const now = localDate(2026, 11, 2, 0, 30);
    const fallBackDay = localDate(2026, 11, 1, 12, 0);
    expect(localMidnightGapHours(fallBackDay, now)).toBe(25);
    expect(dayLabel(fallBackDay.toISOString(), now)).toBe('Yesterday');
    expect(daysAgo(fallBackDay.toISOString(), now)).toBe('yesterday');
    expect(dayLabel(now.toISOString(), now)).toBe('Today');
    expect(daysAgo(now.toISOString(), now)).toBe('today');

    // Both 01:30 instants on the fall-back night are that same calendar day.
    const first130 = new Date('2026-11-01T05:30:00Z');
    const second130 = new Date('2026-11-01T06:30:00Z');
    expect(first130.getHours()).toBe(1);
    expect(second130.getHours()).toBe(1);
    expect(dayLabel(first130.toISOString(), now)).toBe('Yesterday');
    expect(dayLabel(second130.toISOString(), now)).toBe('Yesterday');

    const dayBefore = localDate(2026, 10, 31, 12, 0);
    expect(localMidnightGapHours(dayBefore, now)).toBe(49);
    expect(daysAgo(dayBefore.toISOString(), now)).toBe('2 days ago');
    expect(dayLabel(dayBefore.toISOString(), now)).toBe(shortDate(dayBefore.toISOString()));
  });
});
