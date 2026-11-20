/** One decimal, the same rounding as the eval script (`50` → `50.0%`). */
export function accuracyPercentLabel(accuracy: number): string {
  return `${accuracy.toFixed(1)}%`;
}

/** Short name that sits under the percentage. Mock is never left as a bare "mock". */
export function providerCredit(provider: string): string {
  return provider === 'mock' ? 'offline mock' : provider;
}

/**
 * The line directly under a big accuracy number.
 * A crop of that number still names the provider and the holdout size.
 * Example: "50.0% · offline mock, 10 holdout commits".
 */
export function accuracyCredit(input: { accuracy: number; provider: string; holdoutSize: number }): string {
  const commits = input.holdoutSize === 1 ? 'holdout commit' : 'holdout commits';
  return `${accuracyPercentLabel(input.accuracy)} · ${providerCredit(input.provider)}, ${input.holdoutSize} ${commits}`;
}

export function holdoutLine(holdoutSize: number): string {
  return `Accuracy on the ${holdoutSize}-commit holdout.`;
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
