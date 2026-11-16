import { Link } from 'react-router-dom';
import { api } from '../../api/client.ts';
import type { Risk } from '../../api/types.ts';
import { useApi } from '../../hooks/useApi.ts';
import ContributionMap from '../../components/ContributionMap.tsx';
import { Page, useTeam } from '../../components/Layout.tsx';
import { ArrowRight, Card, cardClass, EmptyState, ErrorState, linkClass, primaryBtnClass, RiskBadge, Skeleton, srOnlyClass, statCardClass, StatCard } from '../../components/ui.tsx';

const overviewClass = 'flex flex-col gap-4 md:gap-6';
const colsClass = 'grid items-start gap-4 md:gap-6 min-[1101px]:grid-cols-[minmax(0,1fr)_360px]';
const sideClass = 'flex flex-col gap-4 md:gap-6';
const statsClass = 'grid grid-flow-row grid-cols-2 gap-3 md:grid-cols-4 md:gap-4';
import { effectiveDeadline } from '../../deadline.ts';
import { shortDate } from '../../dates.ts';

function firstName(name: string | null, login: string): string {
  return name?.split(' ')[0] || login;
}

export function daysUntil(iso: string, now = new Date()): number {
  const due = new Date(iso.length === 10 ? `${iso}T23:59:59Z` : iso);
  return Math.max(0, Math.ceil((due.getTime() - now.getTime()) / 86_400_000));
}

/** "#12 Auth flow: No matched activity…" — task first, then the plain explanation. */
export function riskLine(r: Risk): string {
  if (r.task_number == null || r.description.includes(`#${r.task_number}`)) return r.description;
  return `#${r.task_number} ${r.task_title}: ${r.description}`;
}

function OverviewSkeleton() {
  return (
    <div className={overviewClass} aria-busy="true">
      <span className={srOnlyClass} role="status">Loading team overview…</span>
      <div className={statsClass}>
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={statCardClass}><Skeleton w={80} /><Skeleton w={56} h={28} /></div>
        ))}
      </div>
      <div className={colsClass}>
        <div className={cardClass}>
          <Skeleton w={160} h={18} /><Skeleton w={280} />
          {[90, 200, 190, 320].map((w, i) => (
            <div key={i} className="flex items-center gap-4"><Skeleton w={100} /><Skeleton w={w} /></div>
          ))}
        </div>
        <div className={sideClass}>
          <div className={cardClass}><Skeleton w={140} h={18} /><Skeleton w="90%" /><Skeleton w="75%" /></div>
          <div className={cardClass}><Skeleton w={140} h={18} /><Skeleton w="70%" /><Skeleton w={120} h={44} /></div>
        </div>
      </div>
    </div>
  );
}

export default function Overview() {
  const { teamId, version } = useTeam();
  const summary = useApi(() => api.summary(teamId), [teamId, version]);
  const risks = useApi(() => api.risks(teamId), [teamId, version]);
  const suggestions = useApi(() => api.suggestions(teamId), [teamId, version]);
  const tasks = useApi(() => api.tasks(teamId), [teamId, version]);
  const team = useApi(() => api.team(teamId), [teamId, version]);

  let body;
  if (summary.loading && !summary.data) {
    body = <OverviewSkeleton />;
  } else if (summary.error || !summary.data) {
    body = <ErrorState message={summary.error ?? 'No data'} onRetry={summary.reload} />;
  } else {
    const { statCards, members } = summary.data;
    const topRisks = (risks.data ?? []).slice(0, 2);
    const suggestion = suggestions.data?.find(s => s.status === 'pending');
    const deadline = tasks.data && (team.data != null || !team.loading)
      ? effectiveDeadline(team.data?.deadline, tasks.data.map(t => t.due_date))
      : null;

    body = (
      <div className={overviewClass}>
        <div className={statsClass}>
          <StatCard label="Tasks done" value={`${statCards.tasksDone} of ${statCards.tasksTotal}`} />
          <StatCard label="At risk" value={statCards.tasksAtRisk} tone={statCards.tasksAtRisk ? 'risk' : 'default'} />
          <StatCard label="Suggestions" value={statCards.pendingSuggestions} />
          <StatCard
            label="Days to deadline"
            value={deadline?.date ? daysUntil(deadline.date) : '—'}
            sublabel={deadline?.date
              ? `${shortDate(deadline.date)} · ${deadline.source === 'team' ? 'set by the team' : 'from milestones'}`
              : deadline ? 'No milestone due date' : undefined}
          />
        </div>

        <div className={colsClass}>
          <Card title="Who did what" subtitle="Weighted by how substantial each change was">
            {members.length
              ? <ContributionMap teamId={teamId} members={members} />
              : <EmptyState heading="No contributions yet" line="Sync the repo to see who did what." />}
          </Card>

          <div className={sideClass}>
            <Card title="Needs attention">
              {risks.error && <ErrorState message={risks.error} onRetry={risks.reload} />}
              {risks.loading && !risks.data && <><Skeleton w="90%" /><Skeleton w="75%" /></>}
              {risks.data && topRisks.length === 0 && <p className="text-muted">Nothing at risk right now.</p>}
              {topRisks.length > 0 && (
                <ul className="flex list-none flex-col gap-4">
                  {topRisks.map(r => (
                    <li key={r.id} className="flex items-start gap-3"><RiskBadge level={r.level} className="mt-0.5" /><span>{riskLine(r)}</span></li>
                  ))}
                </ul>
              )}
              {(risks.data?.length ?? 0) > 0 && (
                <Link to={`/teams/${teamId}/risks`} className={linkClass}>See all risks <ArrowRight size={16} /></Link>
              )}
            </Card>

            {suggestion && (
              <Card title="Suggested swap">
                <div className="flex flex-col gap-1">
                  <span className="text-label">#{suggestion.task_number} {suggestion.task_title}</span>
                  <span className="text-muted">
                    {suggestion.from_name ?? suggestion.from_login} → {suggestion.to_name ?? suggestion.to_login}
                  </span>
                </div>
                <div>
                  <Link to={`/teams/${teamId}/rebalance`} className={primaryBtnClass}
                    aria-label={`Review the suggestion to move #${suggestion.task_number} to ${firstName(suggestion.to_name, suggestion.to_login)}`}>
                    Review
                  </Link>
                </div>
              </Card>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <Page title="Overview">{body}</Page>;
}
