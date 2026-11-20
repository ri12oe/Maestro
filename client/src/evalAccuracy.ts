/** One decimal, the same rounding as the eval script (`50` → `50.0%`). */
export function accuracyPercentLabel(accuracy: number): string {
  return `${accuracy.toFixed(1)}%`;
}

export function holdoutLine(holdoutSize: number): string {
  const commits = holdoutSize === 1 ? 'commit' : 'commits';
  return `Accuracy on ${holdoutSize} hand-labeled holdout ${commits}.`;
}

/** Names the provider that produced the file. Mock is labeled as the offline classifier. */
export function recordedLine(input: { dateLabel: string; provider: string; model: string }): string {
  const who = input.provider === 'mock'
    ? `the offline mock classifier (${input.model})`
    : `${input.provider} (${input.model})`;
  return `Recorded ${input.dateLabel} with ${who}.`;
}

export const ACCURACY_EXPLANATION =
  "This is how often the classifier's label matched a hand label. It checks the AI, not anyone on the team.";

export const DISPUTE_REMINDER = 'Every label can be disputed.';
