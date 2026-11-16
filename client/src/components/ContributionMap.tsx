import { Link } from 'react-router-dom';
import type { MemberSummary } from '../api/types.ts';
import { categoryShares } from '../workTypes.ts';
import { Legend, StackedBar } from './ui.tsx';

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export function memberBarLabel(m: MemberSummary): string {
  const cats = categoryShares(m.substanceShares).filter(c => c.share > 0);
  const mix = cats.length ? cats.map(c => `${c.label} ${pct(c.share)}`).join(', ') : 'no classified work yet';
  return `${m.displayName}: ${m.contributionCount} items, ${m.openTasks} open — ${mix}`;
}

export function itemsSummary(m: MemberSummary): string {
  return `${m.contributionCount} item${m.contributionCount === 1 ? '' : 's'} · ${m.openTasks} open`;
}

/**
 * One stacked bar per member, in the order given (alphabetical from the API —
 * never sorted by amount). Bar length is the member's substance-weighted work
 * relative to the busiest member; segments show the mix of work types.
 */
export default function ContributionMap({ teamId, members }: { teamId: number; members: MemberSummary[] }) {
  const maxWeight = Math.max(1, ...members.map(m => m.totalWeight));

  return (
    <div className="flex flex-col gap-4">
      <Legend />
      <ul className="flex list-none flex-col gap-4">
        {members.map(m => (
          <li key={m.memberId} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 md:grid-cols-[120px_minmax(0,1fr)_auto] md:gap-4">
            <Link to={`/teams/${teamId}/members/${m.memberId}`} className="block min-w-0 truncate text-label underline decoration-[rgba(237,237,239,0.35)] underline-offset-[3px] [&:hover]:decoration-[rgb(237,237,239)] max-md:col-start-1 max-md:row-start-1">{m.displayName}</Link>
            <StackedBar className="max-md:col-span-2 max-md:row-start-2" segments={categoryShares(m.substanceShares)} length={m.totalWeight / maxWeight} label={memberBarLabel(m)} />
            <span className="text-right whitespace-nowrap text-muted max-md:col-start-2 max-md:row-start-1">{itemsSummary(m)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
