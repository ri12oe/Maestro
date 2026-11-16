export type DeadlineSource = 'team' | 'milestones';

/** Latest GitHub milestone due date, or null when none of the tasks have one. */
function milestoneDeadline(dueDates: readonly (string | null | undefined)[]): string | null {
  let latest: string | null = null;
  for (const due of dueDates) {
    if (due && (latest === null || due > latest)) latest = due;
  }
  return latest;
}

/**
 * The project deadline to show. A date the team stored wins; otherwise the
 * latest GitHub milestone due date among the tasks.
 */
export function effectiveDeadline(
  stored: string | null | undefined,
  dueDates: readonly (string | null | undefined)[],
): { date: string | null; source: DeadlineSource | null } {
  if (stored) return { date: stored, source: 'team' };
  const date = milestoneDeadline(dueDates);
  return { date, source: date ? 'milestones' : null };
}
