import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.ts';
import type { Risk, RiskLevel, Task } from '../../api/types.ts';
import { useApi } from '../../hooks/useApi.ts';
import { Page, useTeam } from '../../components/Layout.tsx';
import { ArrowRight, Card, Chip, EmptyState, ErrorState, Loading, RiskBadge, Tag } from '../../components/ui.tsx';
import { daysAgo, dueLabel, shortDate } from '../../dates.ts';
import './RiskRadar.scss';

type Filter = 'all' | RiskLevel;
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' },
];

function evidenceLine(risk: Risk, nameFor: (login: string) => string): string {
  const parts: string[] = [];
  if (risk.task_assignee) parts.push(`Owner: ${nameFor(risk.task_assignee)}`);
  if (risk.task_due_date) parts.push(`Due ${shortDate(risk.task_due_date)} (${dueLabel(risk.task_due_date).text})`);
  const contributions = risk.evidence.filter(e => e.type === 'contribution').length;
  const tasks = risk.evidence.filter(e => e.type === 'task').length;
  if (contributions) parts.push(`Based on ${contributions} contribution${contributions === 1 ? '' : 's'}`);
  else if (!risk.task_id && tasks) parts.push(`Based on ${tasks} open task assignment${tasks === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

function RiskCard({ risk, teamId, onDismissed, nameFor }: {
  risk: Risk; teamId: number; onDismissed: () => void; nameFor: (login: string) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A task swap can help with a stalled task or an uneven workload, not with code ownership.
  const swapCanHelp = risk.evidence.some(e => e.type === 'task');
  const title = risk.task_number != null ? `#${risk.task_number} ${risk.task_title}` : null;
  const evidence = evidenceLine(risk, nameFor);

  return (
    <li className={`risk-card risk-card--${risk.level}`}>
      <div className="risk-card__head">
        <RiskBadge level={risk.level} />
        <span className="risk-card__title">{title ?? risk.description}</span>
      </div>
      {title && <p className="risk-card__text">{risk.description}</p>}
      {evidence && <p className="risk-card__evidence">{evidence}</p>}
      {error && <p className="risk-card__error" role="alert">{error}</p>}
      <div className="risk-card__actions">
        {swapCanHelp && (
          <Link to={`/teams/${teamId}/rebalance`} className="link">See rebalance suggestion <ArrowRight size={16} /></Link>
        )}
        <button
          type="button"
          className="text-btn"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try { await api.dismissRisk(teamId, risk.id); onDismissed(); }
            catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
          }}
        >
          {busy ? 'Dismissing…' : 'Dismiss'}
        </button>
      </div>
    </li>
  );
}

function TaskTable({ tasks, atRisk }: { tasks: Task[]; atRisk: Set<number> }) {
  return (
    <div className="task-table">
      <table>
        <thead>
          <tr>
            <th scope="col">Task</th>
            <th scope="col">Owner</th>
            <th scope="col">Last activity</th>
            <th scope="col">Due</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map(t => {
            const due = t.due_date && t.status === 'open' ? dueLabel(t.due_date) : null;
            return (
              <tr key={t.id}>
                <td className="task-table__title">
                  {t.github_issue_number != null && <span className="muted">#{t.github_issue_number}</span>} {t.title}
                </td>
                <td>{t.assignee_name ?? t.assignee_login ?? <span className="muted">Unassigned</span>}</td>
                <td>
                  {t.last_activity_at
                    ? <>{daysAgo(t.last_activity_at)} <span className="muted">· {t.contribution_count} change{t.contribution_count === 1 ? '' : 's'}</span></>
                    : <span className="muted">No matched work</span>}
                </td>
                <td>{t.due_date ? <>{shortDate(t.due_date)}{due && <span className={due.urgent ? 'task-table__urgent' : 'muted'}> · {due.text}</span>}</> : <span className="muted">—</span>}</td>
                <td>{t.status === 'closed' ? <Tag>Done</Tag> : atRisk.has(t.id) ? <span className="task-table__at-risk">At risk</span> : <Tag>Open</Tag>}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function RiskRadar() {
  const { teamId, version, refresh, summary } = useTeam();
  const risks = useApi(() => api.risks(teamId), [teamId, version]);
  const nameFor = (login: string) => summary?.members.find(m => m.login === login)?.displayName ?? login;
  const tasks = useApi(() => api.tasks(teamId), [teamId, version]);
  const [filter, setFilter] = useState<Filter>('all');

  const all = risks.data ?? [];
  const shown = filter === 'all' ? all : all.filter(r => r.level === filter);
  const atRisk = new Set(all.map(r => r.task_id).filter((id): id is number => id != null));
  const onDismissed = () => { risks.reload(); refresh(); };

  return (
    <Page title="Risk radar" subtitle="Risks are recalculated after every sync.">
      {risks.loading && !risks.data && <Loading label="Loading risks…" />}
      {risks.error && <ErrorState message={risks.error} onRetry={risks.reload} />}
      {risks.data && all.length === 0 && (
        <EmptyState bulb="happy" heading="Nothing at risk right now" line="Maestro will flag tasks that go quiet close to their due date." />
      )}
      {all.length > 0 && (
        <>
          <div className="chips" role="group" aria-label="Filter by level">
            {FILTERS.map(f => (
              <Chip key={f.value} filter selected={filter === f.value} onClick={() => setFilter(f.value)}>{f.label}</Chip>
            ))}
          </div>
          {shown.length === 0
            ? <p className="muted">No {filter} risks.</p>
            : <ul className="risk-list">{shown.map(r => <RiskCard key={r.id} risk={r} teamId={teamId} onDismissed={onDismissed} nameFor={nameFor} />)}</ul>}
        </>
      )}

      {tasks.data && tasks.data.length > 0 && (
        <Card title="Task progress" subtitle="Activity comes from commits and logged work matched to each task.">
          <TaskTable tasks={tasks.data} atRisk={atRisk} />
        </Card>
      )}
      {tasks.error && <ErrorState message={tasks.error} onRetry={tasks.reload} />}
    </Page>
  );
}
