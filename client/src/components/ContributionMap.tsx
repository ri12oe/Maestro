import { Link } from 'react-router-dom';
import type { MemberSummary } from '../api/types.ts';
import { WORK_CATEGORIES, categoryShares } from '../workTypes.ts';
import './ContributionMap.scss';

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/**
 * One stacked bar per member, in the order given (alphabetical from the API —
 * never sorted by amount). Bar length is the member's substance-weighted work
 * on one shared scale; segments show the mix of work types.
 */
export default function ContributionMap({ teamId, members }: { teamId: number; members: MemberSummary[] }) {
  const maxWeight = Math.max(1, ...members.map(m => m.totalWeight));

  return (
    <div className="cmap">
      <ul className="cmap__legend" aria-label="Legend">
        {WORK_CATEGORIES.map(c => (
          <li key={c.key}>
            <span className="cmap__swatch" style={{ background: c.color }} aria-hidden="true" />
            {c.label}
          </li>
        ))}
      </ul>

      <ul className="cmap__rows">
        {members.map(m => {
          const cats = categoryShares(m.substanceShares).filter(c => c.share > 0);
          const width = (m.totalWeight / maxWeight) * 100;
          const description = cats.length
            ? cats.map(c => `${c.label} ${pct(c.share)}`).join(', ')
            : 'no classified work yet';
          const quiet = m.contributionCount === 0;

          return (
            <li key={m.memberId}>
              <Link to={`/teams/${teamId}/members/${m.memberId}`} className="cmap__row">
                <span className="cmap__head">
                  <span className="cmap__name">{m.displayName}</span>
                  <span className="cmap__focus">{m.focusSummary}</span>
                </span>
                <span className="cmap__track">
                  <span
                    className="cmap__bar"
                    style={{ width: `${Math.max(width, quiet ? 0 : 2)}%` }}
                    role="img"
                    aria-label={`${m.displayName}: ${m.contributionCount} contributions — ${description}`}
                  >
                    {cats.map(c => (
                      <span key={c.key} style={{ width: pct(c.share), background: c.color }} />
                    ))}
                  </span>
                </span>
                <span className="cmap__meta">
                  {m.contributionCount} contribution{m.contributionCount === 1 ? '' : 's'}
                  {' · '}
                  {m.openTasks} open task{m.openTasks === 1 ? '' : 's'}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
