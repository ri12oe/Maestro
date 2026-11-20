import { describe, expect, it } from 'vitest';
import {
  ACCURACY_EXPLANATION,
  DISPUTE_REMINDER,
  accuracyCredit,
  accuracyPercentLabel,
  holdoutLine,
  recordedLine,
} from './evalAccuracy.ts';

describe('accuracy card copy', () => {
  it('prints accuracy to one decimal, matching the eval script', () => {
    expect(accuracyPercentLabel(50)).toBe('50.0%');
    expect(accuracyPercentLabel(66.666)).toBe('66.7%');
    expect(accuracyPercentLabel(100)).toBe('100.0%');
  });

  it('names the holdout size', () => {
    expect(holdoutLine(10)).toBe('Accuracy on the 10-commit holdout.');
    expect(holdoutLine(1)).toBe('Accuracy on the 1-commit holdout.');
  });

  it('puts the provider and the holdout size on the line under the percentage', () => {
    expect(accuracyCredit({ accuracy: 50, provider: 'mock', holdoutSize: 10 }))
      .toBe('50.0% · offline mock, 10 holdout commits');
    expect(accuracyCredit({ accuracy: 80, provider: 'grok', holdoutSize: 10 }))
      .toBe('80.0% · grok, 10 holdout commits');
    expect(accuracyCredit({ accuracy: 100, provider: 'grok', holdoutSize: 1 }))
      .toBe('100.0% · grok, 1 holdout commit');
    expect(accuracyCredit({ accuracy: 50, provider: 'mock', holdoutSize: 10 })).not.toMatch(/30/);
  });

  it('credits the offline mock classifier when that provider produced the file', () => {
    expect(recordedLine({ dateLabel: 'Nov 20', provider: 'mock', model: 'mock:prompt-v2' }))
      .toBe('Recorded Nov 20 with the offline mock classifier (mock:prompt-v2).');
  });

  it('credits a live provider by the name stored in the results file', () => {
    expect(recordedLine({ dateLabel: 'Nov 20', provider: 'grok', model: 'grok:grok-3-mini:prompt-v2' }))
      .toBe('Recorded Nov 20 with grok (grok:grok-3-mini:prompt-v2).');
    expect(recordedLine({ dateLabel: 'Nov 20', provider: 'grok', model: 'grok:grok-3-mini:prompt-v2' }))
      .not.toContain('mock');
  });

  it('talks about the classifier, and says every label can be disputed', () => {
    expect(ACCURACY_EXPLANATION).toContain('the AI');
    expect(ACCURACY_EXPLANATION).toContain('not anyone on the team');
    expect(DISPUTE_REMINDER).toBe('Every label can be disputed.');
    const copy = `${ACCURACY_EXPLANATION} ${DISPUTE_REMINDER}`;
    expect(copy).not.toMatch(/rank|grade|score|leaderboard|laz/i);
  });
});
