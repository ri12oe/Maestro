import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client.ts';
import type { Risk, Task } from '../../api/types.ts';
import { useApi } from '../../hooks/useApi.ts';
import { Card, Empty, ErrorState, LevelBadge, Loading, PageHeader, Pill } from '../../components/ui.tsx';
import { daysAgo, dueLabel, shortDate } from '../../dates.ts';
import './RiskRadar.scss';

function RiskCard({ risk, teamId, onDismissed }: { risk: Risk; teamId: number; onDismissed: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contributions = risk.evidence.filter(e => e.type === 'contribution').length;
  const tasks = risk.evidence.filter(e => e.type === 'task').length;
  // Where the risk comes from, in plain words
  const basis = risk.task_id
    ? 'the task’s status'
    : tasks ? `${tasks} open task assignment${tasks === 1 ? '' : 's'}` : 'commit history';
  // A task swap can help with a stalled task or an uneven workload, not with code ownership
  const swapCanHelp = tasks > 0;
  const due = risk.task_due_date ? dueLabel(risk.task_due_date) : null;

  return (
    <li className={`risk risk--${risk.level}`}>
      <div className="risk__top">
        <LevelBadge level={risk.level} />
        {risk.task_number != null && <Pill>#{risk.task_number} {risk.task_title}</Pill>}
        {due && <Pill tone={due.urgent ? 'risk' : 'neutral'}>{due.text}</Pill>}
      </div>
      <p className="risk__text">{risk.description}</p>
      <p className="risk__evidence">
        Based on {basis}
        {contributions ? ` and ${contributions} contribution${contributions === 1 ? '' : 's'}` : ''}.
      </p>
      {error && <p className="risk__error" role="alert">{error}</p>}
      <div className="risk__actions">
        {swapCanHelp && (
          <Link to={`/teams/${teamId}/rebalance`} className="btn btn--primary btn--small">See suggested swaps</Link>
        )}
        <button
          type="button"
          className="btn btn--secondary btn--small"
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
                  {t.github_issue_number != null && <span className="task-table__num">#{t.github_issue_number}</span>} {t.title}
                </td>
                <td>{t.assignee_name?.split(' ')[0] ?? t.assignee_login ?? <span className="muted">Unassigned</span>}</td>
                <td>
                  {t.last_activity_at
                    ? <>{daysAgo(t.last_activity_at)} <span className="muted">· {t.contribution_count} change{t.contribution_count === 1 ? '' : 's'}</span></>
                    : <span className="muted">No matched work</span>}
                </td>
                <td>{t.due_date ? <>{shortDate(t.due_date)}{due && <span className={due.urgent ? 'task-table__urgent' : 'muted'}> · {due.text}</span>}</> : <span className="muted">—</span>}</td>
                <td>
                  {t.status === 'closed'
                    ? <Pill tone="accent">Done</Pill>
                    : atRisk.has(t.id) ? <Pill tone="risk">At risk</Pill> : <Pill>Open</Pill>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function RiskRadar() {
  const teamId = Number(useParams().teamId);
  const risks = useApi(() => api.risks(teamId), [teamId]);
  const tasks = useApi(() => api.tasks(teamId), [teamId]);

  const atRisk = new Set((risks.data ?? []).map(r => r.task_id).filter((id): id is number => id != null));

  return (
    <>
      <PageHeader title="Risk radar">
        {risks.data && <Pill tone={risks.data.length ? 'risk' : 'accent'}>{risks.data.length} active risk{risks.data.length === 1 ? '' : 's'}</Pill>}
      </PageHeader>
      <p className="lead">
        Referee compares the plan with what has actually happened. Risks are detected by rules you can
        read; the AI only writes the wording. Every risk is about the project, never about a person.
      </p>

      {risks.loading && !risks.data && <Loading label="Loading risks…" />}
      {risks.error && <ErrorState message={risks.error} onRetry={risks.reload} />}
      {risks.data && risks.data.length === 0 && (
        <Card><Empty>Nothing at risk right now. Nice work.</Empty></Card>
      )}
      {risks.data && risks.data.length > 0 && (
        <ul className="risk-list">
          {risks.data.map(r => (
            <RiskCard key={r.id} risk={r} teamId={teamId} onDismissed={risks.reload} />
          ))}
        </ul>
      )}

      <Card title="Task progress" subtitle={`Activity comes from commits and logged work matched to each task. As of ${shortDate(new Date().toISOString())}.`}>
        {tasks.loading && !tasks.data && <Loading />}
        {tasks.error && <ErrorState message={tasks.error} onRetry={tasks.reload} />}
        {tasks.data && tasks.data.length === 0 && <Empty>No tasks yet. Referee reads them from the repo's GitHub Issues.</Empty>}
        {tasks.data && tasks.data.length > 0 && <TaskTable tasks={tasks.data} atRisk={atRisk} />}
      </Card>
    </>
  );
}
