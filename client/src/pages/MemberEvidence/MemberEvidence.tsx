import { useId, useState, type CSSProperties } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client.ts';
import type { Contribution, MemberSummary, Risk, Task } from '../../api/types.ts';
import { useApi } from '../../hooks/useApi.ts';
import { Page, useTeam } from '../../components/Layout.tsx';
import { itemsSummary, memberBarLabel } from '../../components/ContributionMap.tsx';
import {
  Card, EmptyState, ErrorState, Legend, Loading, OptionCard, RiskBadge, StackedBar, StatCard, Tag,
} from '../../components/ui.tsx';
import { WORK_TYPE_LABEL, categoryShares, substanceLabel, workTypeColor } from '../../workTypes.ts';
import { daysAgo, shortDate } from '../../dates.ts';
import './MemberEvidence.scss';

const REASONS = ['Wrong work type', 'Wrong task', 'Credit belongs to someone else', 'Other'];

function DisputePanel({ onSubmit, onCancel }: { onSubmit: (note: string) => Promise<void>; onCancel: () => void }) {
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const groupId = useId();

  return (
    <form
      className="dispute"
      onSubmit={async e => {
        e.preventDefault();
        if (!reason) { setError('Choose what’s wrong with this.'); return; }
        setBusy(true);
        setError(null);
        // The API stores one note per dispute, so the chosen reason leads the note.
        try { await onSubmit(note.trim() ? `${reason}: ${note.trim()}` : reason); }
        catch (err) { setError(err instanceof Error ? err.message : String(err)); setBusy(false); }
      }}
    >
      <fieldset className="dispute__options">
        <legend className="field__label">What&rsquo;s wrong with this?</legend>
        {REASONS.map(r => (
          <OptionCard key={r} name={groupId} value={r} checked={reason === r} onChange={setReason} title={r} />
        ))}
      </fieldset>
      <label htmlFor={noteId} className="visually-hidden">Add a note (optional)</label>
      <textarea id={noteId} className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note (optional)" />
      {error && <p className="dispute__error" role="alert">{error}</p>}
      <div className="dispute__actions">
        <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Sending…' : 'Send dispute'}</button>
        <button type="button" className="btn btn--secondary" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

function ContributionRow({ c, teamId, onDisputed }: { c: Contribution; teamId: number; onDisputed: () => void }) {
  const [disputing, setDisputing] = useState(false);
  const typeLabel = c.work_type ? WORK_TYPE_LABEL[c.work_type] : c.source === 'manual' ? 'Logged' : 'Unlabeled';
  const substance = substanceLabel(c.substance);
  const summary = c.summary ?? c.title;

  return (
    <li className={`contrib${disputing ? ' is-open' : ''}`}>
      <div className="contrib__row">
        <span className="contrib__date">{shortDate(c.authored_at)}</span>
        <span className="contrib__type"><span className="contrib__dot" style={{ background: workTypeColor(c.work_type) }} aria-hidden="true" />{typeLabel}</span>
        <span className="contrib__details">
          <span className="contrib__summary">
            {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{summary}</a> : summary}
          </span>
          <span className="contrib__task">
            {c.task_number != null ? `#${c.task_number} ${c.task_title}` : 'Not linked to a task'}
          </span>
        </span>
        <span className="contrib__tags">
          {c.source === 'manual' && c.work_type && <Tag>Logged</Tag>}
          {substance && <Tag>{substance}</Tag>}
          {c.disputed ? <Tag>Disputed</Tag> : null}
        </span>
        {c.work_type && !c.disputed && (
          <button type="button" className="text-btn contrib__dispute" onClick={() => setDisputing(d => !d)}
            aria-expanded={disputing} aria-label={`Dispute the label on “${summary}”`}>
            Dispute
          </button>
        )}
      </div>
      {disputing && (
        <DisputePanel
          onCancel={() => setDisputing(false)}
          onSubmit={async note => { await api.dispute(teamId, c.id, note); setDisputing(false); onDisputed(); }}
        />
      )}
    </li>
  );
}

function lastActive(contribs: Contribution[] | null): string {
  if (!contribs?.length) return '—';
  const latest = contribs.reduce((a, b) => (a.authored_at > b.authored_at ? a : b)).authored_at;
  const text = daysAgo(latest);
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function AssignedTasks({ member, tasks, risks }: { member: MemberSummary; tasks: Task[]; risks: Risk[] }) {
  const mine = tasks.filter(t => t.status === 'open' && t.assignee_login === member.login);
  return (
    <Card title="Assigned tasks">
      {mine.length === 0 ? <p className="muted">No open tasks assigned.</p> : (
        <ul className="assigned">
          {mine.map(t => {
            const risk = risks.find(r => r.task_id === t.id);
            return (
              <li key={t.id}>
                <span className="assigned__title">{t.github_issue_number != null && `#${t.github_issue_number} `}{t.title}</span>
                {risk && <RiskBadge level={risk.level} />}
                <span className="assigned__due">{t.due_date ? `Due ${shortDate(t.due_date)}` : 'No due date'}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

export default function MemberEvidence() {
  const memberId = Number(useParams().memberId);
  const { teamId, version } = useTeam();
  const summary = useApi(() => api.summary(teamId), [teamId, version]);
  const contributions = useApi(() => api.contributions(teamId, { memberId }), [teamId, memberId, version]);
  const tasks = useApi(() => api.tasks(teamId), [teamId, version]);
  const risks = useApi(() => api.risks(teamId), [teamId, version]);

  const member = summary.data?.members.find(m => m.memberId === memberId);
  const back = { to: `/teams/${teamId}`, label: 'Back to overview' };

  if (summary.loading && !summary.data) return <Page title="Loading…" back={back}><Loading /></Page>;
  if (summary.error || !summary.data) return <Page title="Member" back={back}><ErrorState message={summary.error ?? 'No data'} onRetry={summary.reload} /></Page>;
  if (!member) return <Page title="Member" back={back}><ErrorState message="This person isn't on the team." /></Page>;

  return (
    <Page title={member.displayName} back={back}>
      <div className="stats" style={{ '--cols': 3 } as CSSProperties}>
        <StatCard label="Contributions" value={member.contributionCount} />
        <StatCard label="Open tasks" value={member.openTasks} />
        <StatCard label="Last active" value={lastActive(contributions.data)} />
      </div>

      <div className="work-mix">
        <div className="work-mix__bar">
          <StackedBar segments={categoryShares(member.substanceShares)} length={member.totalWeight ? 1 : 0} label={memberBarLabel(member)} />
          <span className="muted">{itemsSummary(member)}</span>
        </div>
        <Legend />
      </div>

      {tasks.data && <AssignedTasks member={member} tasks={tasks.data} risks={risks.data ?? []} />}

      <Card title="Contributions">
        {contributions.loading && !contributions.data && <Loading />}
        {contributions.error && <ErrorState message={contributions.error} onRetry={contributions.reload} />}
        {contributions.data && contributions.data.length === 0 && (
          <EmptyState heading="No contributions yet" line="Commits and logged work will show up here after the next sync." />
        )}
        {contributions.data && contributions.data.length > 0 && (
          <ul className="contrib-list">
            {contributions.data.map(c => (
              <ContributionRow key={c.id} c={c} teamId={teamId} onDisputed={contributions.reload} />
            ))}
          </ul>
        )}
      </Card>
    </Page>
  );
}
