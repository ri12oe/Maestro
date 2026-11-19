import { describe, expect, it } from 'vitest';
import { commitShaToken, shortCommitSha } from './sha.ts';

const REAL_SHA = 'abcdef0123456789abcdef0123456789abcdef01';

describe('commit sha display', () => {
  it('keeps a 40-hex GitHub sha and its 7-character prefix', () => {
    expect(REAL_SHA).toHaveLength(40);
    expect(commitShaToken(REAL_SHA)).toBe(REAL_SHA);
    expect(shortCommitSha(REAL_SHA)).toBe(REAL_SHA.slice(0, 7));
    expect(shortCommitSha(REAL_SHA)).toBe('abcdef0');
  });

  it('keeps the letter case of a 40-hex sha', () => {
    const upper = 'ABCDEF0123456789ABCDEF0123456789ABCDEF01';
    expect(shortCommitSha(upper)).toBe(upper.slice(0, 7));
    expect(shortCommitSha(upper)).toBe('ABCDEF0');
  });

  it('shows the token after the last colon of a demo sha', () => {
    const stored = 'demo:studybuddy:rio0008hhhh';
    expect(commitShaToken(stored)).toBe('rio0008hhhh');
    expect(shortCommitSha(stored)).toBe('rio0008');
  });

  it('returns undefined when there is no sha', () => {
    expect(shortCommitSha(null)).toBeUndefined();
    expect(shortCommitSha(undefined)).toBeUndefined();
  });
});
