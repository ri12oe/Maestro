import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client.ts';
import type { Contribution } from '../../api/types.ts';
import { useApi } from '../../hooks/useApi.ts';
import { Card, Empty, ErrorState, Loading, Pill } from '../../components/ui.tsx';
import { WORK_TYPE_LABEL, categoryShares } from '../../workTypes.ts';
import './MemberEvidence.scss';

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });

function DisputeForm({ onSubmit, onCancel }: { onSubmit: (note: string) => Promise<void>; onCancel: () => void }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      className="dispute"
      onSubmit={async e => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try { await onSubmit(note); } catch (err) { setError(err instanceof Error ? err.message : String(err)); setBusy(false); }
      }}
    >
      <label htmlFor="dispute-note">What should this be labeled instead? (optional)</label>
      <textarea id="dispute-note" rows={2} value={note} onChange={e => setNote(e.target.value)}
        placeholder="e.g. This was a large feature, not formatting" />
      {error && <p className="dispute__error" role="alert">{error}</p>}
      <div className="dispute__actions">
        <button type="submit" className="btn btn--primary btn--small" disabled={busy}>
          {busy ? 'Sending…' : 'Flag label'}
        </button>
        <button type="button" className="btn btn--secondary btn--small" onClick={onCancel} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

function ContributionRow({ c, teamId, onDisputed }: { c: Contribution; teamId: number; onDisputed: () => void }) {
  const [disputing, setDisputing] = useState(false);
  const manual = c.source === 'manual';

  return (
    <li className="contrib">
      <div className="contrib__main">
        <span className="contrib__date">{dateFmt.format(new Date(c.authored_at))}</span>
        <div className="contrib__body">
          <p className="contrib__title">
            {c.url ? <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a> : c.title}
          </p>
          {c.summary && <p className="contrib__summary">{c.summary}</p>}
          <div className="contrib__chips">
            {manual && <Pill>Logged{c.kind ? ` · ${c.kind}` : ''}</Pill>}
            {c.work_type && <Pill tone="accent">{WORK_TYPE_LABEL[c.work_type]}</Pill>}
            {c.substance && <Pill>{c.substance} substance</Pill>}
            {c.task_number != null && <Pill>#{c.task_number} {c.task_title}</Pill>}
            {!manual && c.additions != null && (
              <span className="contrib__size">+{c.additions} / −{c.deletions ?? 0} in {c.files_changed ?? 0} file{c.files_changed === 1 ? '' : 's'}</span>
            )}
          </div>
          {c.disputed ? (
            <p className="contrib__disputed">
              <Pill tone="risk">Label disputed</Pill>
              {c.dispute_note && <span>“{c.dispute_note}”</span>}
            </p>
          ) : null}
        </div>
        {c.work_type && !c.disputed && !disputing && (
          <button type="button" className="btn btn--secondary btn--small contrib__flag" onClick={() => setDisputing(true)}
            aria-label={`Flag the label on “${c.title}” as wrong`}>
            Wrong label?
          </button>
        )}
      </div>
      {disputing && (
        <DisputeForm
          onCancel={() => setDisputing(false)}
          onSubmit={async note => {
            await api.dispute(teamId, c.id, note);
            setDisputing(false);
            onDisputed();
          }}
        />
      )}
    </li>
  );
}

export default function MemberEvidence() {
  const params = useParams();
  const teamId = Number(params.teamId);
  const memberId = Number(params.memberId);
  const summary = useApi(() => api.summary(teamId), [teamId]);
  const contributions = useApi(() => api.contributions(teamId, { memberId }), [teamId, memberId]);

  if (summary.loading && !summary.data) return <Loading />;
  if (summary.error || !summary.data) return <ErrorState message={summary.error ?? 'No data'} onRetry={summary.reload} />;

  const member = summary.data.members.find(m => m.memberId === memberId);
  if (!member) return <ErrorState message="This person isn't on the team." />;

  const mix = categoryShares(member.substanceShares).filter(c => c.share > 0);
  const disputedCount = (contributions.data ?? []).filter(c => c.disputed).length;

  return (
    <>
      <Link to={`/teams/${teamId}`} className="back-link">← Team overview</Link>

      <header className="member-head">
        <span className="member-head__avatar" aria-hidden="true">{member.displayName.charAt(0)}</span>
        <div>
          <h1>{member.displayName}</h1>
          <p>
            {member.focusSummary} · {member.contributionCount} contribution{member.contributionCount === 1 ? '' : 's'}
            {' · '}{member.openTasks} open task{member.openTasks === 1 ? '' : 's'}
          </p>
        </div>
      </header>

      <Card title="Work mix" subtitle="Share of this person's own work, weighted by substance.">
        {mix.length ? (
          <div className="mix">
            {mix.map(c => (
              <span key={c.key} className="mix__item">
                <span className="mix__swatch" style={{ background: c.color }} aria-hidden="true" />
                {c.label} <strong>{Math.round(c.share * 100)}%</strong>
              </span>
            ))}
          </div>
        ) : <Empty>No classified work yet.</Empty>}
      </Card>

      <Card
        title="Contributions"
        subtitle={`Every label below was made by AI and links to the work itself. Think one is wrong? Flag it.${disputedCount ? ` ${disputedCount} flagged so far.` : ''}`}
      >
        {contributions.loading && !contributions.data && <Loading />}
        {contributions.error && <ErrorState message={contributions.error} onRetry={contributions.reload} />}
        {contributions.data && contributions.data.length === 0 && <Empty>No contributions yet.</Empty>}
        {contributions.data && contributions.data.length > 0 && (
          <ul className="contrib-list">
            {contributions.data.map(c => (
              <ContributionRow key={c.id} c={c} teamId={teamId} onDisputed={contributions.reload} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
