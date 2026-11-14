import { Link } from 'react-router-dom';
import type { MemberSummary } from '../api/types.ts';
import { categoryShares } from '../workTypes.ts';
import { Legend, StackedBar } from './ui.tsx';
import './ContributionMap.scss';

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
    <div className="cmap">
      <Legend />
      <ul className="cmap__rows">
        {members.map(m => (
          <li key={m.memberId} className="cmap__row">
            <Link to={`/teams/${teamId}/members/${m.memberId}`} className="cmap__name">{m.displayName}</Link>
            <StackedBar segments={categoryShares(m.substanceShares)} length={m.totalWeight / maxWeight} label={memberBarLabel(m)} />
            <span className="cmap__meta">{itemsSummary(m)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
