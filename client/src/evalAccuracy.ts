/** One decimal, the same rounding as the eval script (`50` → `50.0%`). */
export function accuracyPercentLabel(accuracy: number): string {
  return `${accuracy.toFixed(1)}%`;
}

/** `grok:grok-4.20-0309-non-reasoning:prompt-v2` → `grok-4.20-0309-non-reasoning`. */
export function modelShortName(provider: string, model: string): string | null {
  const prefix = `${provider}:`;
  const suffix = ':prompt-v2';
  if (!model.startsWith(prefix) || !model.endsWith(suffix)) return null;
  const name = model.slice(prefix.length, -suffix.length);
  return name.length > 0 ? name : null;
}

function providerName(provider: string): string {
  if (!provider) return provider;
  return provider.charAt(0).toUpperCase() + provider.slice(1);
}

/**
 * Short name that sits under the percentage.
 * Mock is never left as a bare "mock". A live provider is capitalized and,
 * when the stored model has a name, that name is in parentheses.
 */
export function providerCredit(provider: string, model?: string): string {
  if (provider === 'mock') return 'offline mock';
  const name = providerName(provider);
  const short = model ? modelShortName(provider, model) : null;
  return short ? `${name} (${short})` : name;
}

/** Corner badge. Only an offline run says "Offline mock". */
export function providerBadge(provider: string): string {
  return provider === 'mock' ? 'Offline mock' : providerName(provider);
}

/**
 * The line directly under a big accuracy number.
 * A crop of that number still names the provider and the holdout size.
 * Example: "90.0% · Grok (grok-4.20-0309-non-reasoning), 10 holdout commits".
 * An offline run stays "50.0% · offline mock, 10 holdout commits".
 */
export function accuracyCredit(input: { accuracy: number; provider: string; model?: string; holdoutSize: number }): string {
  const commits = input.holdoutSize === 1 ? 'holdout commit' : 'holdout commits';
  return `${accuracyPercentLabel(input.accuracy)} · ${providerCredit(input.provider, input.model)}, ${input.holdoutSize} ${commits}`;
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
