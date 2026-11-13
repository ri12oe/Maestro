import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client.ts';
import { useApi } from '../../hooks/useApi.ts';
import ContributionMap from '../../components/ContributionMap.tsx';
import { Card, Empty, ErrorState, LevelBadge, Loading, PageHeader, Pill, StatCard } from '../../components/ui.tsx';
import './Overview.scss';

function firstName(name: string | null, login: string): string {
  return name?.split(' ')[0] || login;
}

export default function Overview() {
  const teamId = Number(useParams().teamId);
  const summary = useApi(() => api.summary(teamId), [teamId]);
  const risks = useApi(() => api.risks(teamId), [teamId]);
  const suggestions = useApi(() => api.suggestions(teamId), [teamId]);

  if (summary.loading && !summary.data) return <Loading label="Loading team overview…" />;
  if (summary.error || !summary.data) {
    return <ErrorState message={summary.error ?? 'No data'} onRetry={summary.reload} />;
  }

  const { team, statCards, members } = summary.data;
  const topRisks = (risks.data ?? []).slice(0, 2);
  const suggestion = suggestions.data?.[0];

  return (
    <>
      <PageHeader eyebrow={team.repo} title={`${team.name} — overview`}>
        {statCards.tasksAtRisk > 0
          ? <Pill tone="risk">{statCards.tasksAtRisk} task{statCards.tasksAtRisk === 1 ? '' : 's'} at risk</Pill>
          : <Pill tone="accent">No tasks at risk</Pill>}
      </PageHeader>

      <div className="grid-3">
        <StatCard label="Tasks done" value={`${statCards.tasksDone} of ${statCards.tasksTotal}`} />
        <StatCard label="Tasks at risk" value={statCards.tasksAtRisk} tone={statCards.tasksAtRisk ? 'risk' : 'default'} />
        <StatCard label="Suggestions waiting" value={statCards.pendingSuggestions} tone={statCards.pendingSuggestions ? 'accent' : 'default'} />
      </div>

      <div className="split">
        <div className="split__main">
          <Card
            title="Contribution map"
            subtitle="Weighted by what each change was, not how many lines it touched. Select a person to see the evidence."
          >
            {members.length
              ? <ContributionMap teamId={teamId} members={members} />
              : <Empty>No contributions yet. Sync the repo to get started.</Empty>}
          </Card>
        </div>

        <div className="split__side">
          <Card title="Risk radar">
            {risks.loading && !risks.data && <Loading />}
            {risks.error && <ErrorState message={risks.error} onRetry={risks.reload} />}
            {risks.data && topRisks.length === 0 && <Empty>Nothing at risk right now.</Empty>}
            {topRisks.map(r => (
              <div key={r.id} className={`risk-preview risk-preview--${r.level}`}>
                <LevelBadge level={r.level} />
                <p>{r.description}</p>
              </div>
            ))}
            {(risks.data?.length ?? 0) > 0 && (
              <Link to={`/teams/${teamId}/risks`} className="overview__more">
                See all {risks.data!.length} risk{risks.data!.length === 1 ? '' : 's'}
              </Link>
            )}
          </Card>

          {suggestion && (
            <Card title="Suggested swap" className="overview__swap">
              <p>
                Move <strong>#{suggestion.task_number} {suggestion.task_title}</strong> from{' '}
                {firstName(suggestion.from_name, suggestion.from_login)} to{' '}
                {firstName(suggestion.to_name, suggestion.to_login)}.
              </p>
              {suggestion.rationale[0] && <p className="overview__why">{suggestion.rationale[0]}</p>}
              <Link to={`/teams/${teamId}/rebalance`} className="btn btn--primary">Review suggestion</Link>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
