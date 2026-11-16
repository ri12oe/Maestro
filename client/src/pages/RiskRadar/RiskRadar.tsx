import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.ts';
import type { Risk, RiskLevel, Task } from '../../api/types.ts';
import { useApi } from '../../hooks/useApi.ts';
import { Page, useTeam } from '../../components/Layout.tsx';
import { ArrowRight, Card, Chip, chipsClass, EmptyState, ErrorState, linkClass, Loading, RiskBadge, Tag, textBtnClass } from '../../components/ui.tsx';
import { daysAgo, dueLabel, shortDate } from '../../dates.ts';

type Filter = 'all' | RiskLevel;
const FILTERS: Array<{ value: Filter; label: string }> = [
  { value: 'all', label: 'All' }, { value: 'high', label: 'High' }, { value: 'medium', label: 'Medium' }, { value: 'low', label: 'Low' },
];

const STRIPE: Record<RiskLevel, string> = {
  high: 'before:bg-error',
  medium: 'before:bg-primary',
  low: 'before:bg-muted',
};

const thClass = 'pb-3 pr-4 text-left font-normal whitespace-nowrap text-muted';
const tdClass = 'border-t border-neutral py-3 pr-4 align-top';

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
    <li className={`relative flex flex-col gap-2 overflow-hidden rounded-card border border-neutral bg-base-200 p-5 md:pl-6 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[''] ${STRIPE[risk.level]}`}>
      <div className="flex items-center gap-3">
        <RiskBadge level={risk.level} />
        <span className="text-label">{title ?? risk.description}</span>
      </div>
      {title && <p className="text-[18px] leading-7 tracking-[-0.005em]">{risk.description}</p>}
      {evidence && <p className="text-muted">{evidence}</p>}
      {error && <p className="text-error" role="alert">{error}</p>}
      <div className="mt-1 flex items-center gap-4">
        {swapCanHelp && (
          <Link to={`/teams/${teamId}/rebalance`} className={linkClass}>See rebalance suggestion <ArrowRight size={16} /></Link>
        )}
        <button
          type="button"
          className={`${textBtnClass} ${swapCanHelp ? '' : 'pl-0!'}`}
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
    <div className="min-w-0 overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={thClass} scope="col">Task</th>
            <th className={thClass} scope="col">Owner</th>
            <th className={thClass} scope="col">Last activity</th>
            <th className={thClass} scope="col">Due</th>
            <th className={thClass} scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map(t => {
            const due = t.due_date && t.status === 'open' ? dueLabel(t.due_date) : null;
            return (
              <tr key={t.id}>
                <td className={`${tdClass} min-w-[200px] text-label`}>
                  {t.github_issue_number != null && <span className="text-muted">#{t.github_issue_number}</span>} {t.title}
                </td>
                <td className={tdClass}>{t.assignee_name ?? t.assignee_login ?? <span className="text-muted">Unassigned</span>}</td>
                <td className={tdClass}>
                  {t.last_activity_at
                    ? <>{daysAgo(t.last_activity_at)} <span className="text-muted">· {t.contribution_count} change{t.contribution_count === 1 ? '' : 's'}</span></>
                    : <span className="text-muted">No matched work</span>}
                </td>
                <td className={tdClass}>{t.due_date ? <>{shortDate(t.due_date)}{due && <span className={due.urgent ? 'text-error' : 'text-muted'}> · {due.text}</span>}</> : <span className="text-muted">—</span>}</td>
                <td className={tdClass}>{t.status === 'closed' ? <Tag>Done</Tag> : atRisk.has(t.id) ? <span className="text-badge whitespace-nowrap rounded-full bg-risk-high-bg px-2 py-1 text-error">At risk</span> : <Tag>Open</Tag>}</td>
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
          <div className={chipsClass} role="group" aria-label="Filter by level">
            {FILTERS.map(f => (
              <Chip key={f.value} filter selected={filter === f.value} onClick={() => setFilter(f.value)}>{f.label}</Chip>
            ))}
          </div>
          {shown.length === 0
            ? <p className="text-muted">No {filter} risks.</p>
            : <ul className="flex list-none flex-col gap-4">{shown.map(r => <RiskCard key={r.id} risk={r} teamId={teamId} onDismissed={onDismissed} nameFor={nameFor} />)}</ul>}
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
