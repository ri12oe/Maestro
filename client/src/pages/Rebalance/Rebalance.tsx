import { useId, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../../api/client.ts';
import type { Suggestion } from '../../api/types.ts';
import { useApi } from '../../hooks/useApi.ts';
import { Card, Empty, ErrorState, Loading, PageHeader, Pill } from '../../components/ui.tsx';
import { dueLabel } from '../../dates.ts';
import './Rebalance.scss';

type Answer = 'accepted' | 'discuss' | 'dismissed';

function first(name: string | null, login: string): string {
  return name?.split(' ')[0] || login;
}

const CONFIRMATION: Record<Answer, (s: Suggestion) => string> = {
  accepted: s => `Swap accepted: #${s.task_number} ${s.task_title} is now assigned to ${first(s.to_name, s.to_login)} in Referee. Remember to update the assignee on GitHub too.`,
  discuss: s => `Marked for discussion. Bring #${s.task_number} ${s.task_title} up with the team — the check-in message below can start the conversation.`,
  dismissed: s => `Dismissed. Referee won't suggest moving #${s.task_number} ${s.task_title} to ${first(s.to_name, s.to_login)} again.`,
};

function CheckinMessage({ initial }: { initial: string }) {
  const [text, setText] = useState(initial);
  const [copied, setCopied] = useState(false);
  const id = useId();

  return (
    <div className="checkin">
      <label htmlFor={id} className="checkin__label">Check-in message for the team</label>
      <p className="checkin__hint">Written about the work, not the person. Edit it before sending.</p>
      <textarea id={id} rows={4} value={text} onChange={e => { setText(e.target.value); setCopied(false); }} />
      <div>
        <button
          type="button"
          className="btn btn--secondary btn--small"
          onClick={async () => {
            try { await navigator.clipboard.writeText(text); setCopied(true); }
            catch { setCopied(false); }
          }}
        >
          {copied ? 'Copied' : 'Copy message'}
        </button>
        <span className="checkin__status" role="status">{copied ? 'Message copied to clipboard.' : ''}</span>
      </div>
    </div>
  );
}

function SuggestionCard({ s, teamId, onAnswered }: {
  s: Suggestion; teamId: number; onAnswered: (s: Suggestion, a: Answer) => void;
}) {
  const [busy, setBusy] = useState<Answer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const from = first(s.from_name, s.from_login);
  const to = first(s.to_name, s.to_login);
  const due = s.task_due_date ? dueLabel(s.task_due_date) : null;

  async function answer(a: Answer) {
    setBusy(a);
    setError(null);
    try { await api.respond(teamId, s.id, a); onAnswered(s, a); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(null); }
  }

  return (
    <Card className="swap">
      <div className="swap__task">
        <span className="swap__eyebrow">Task</span>
        <h2>#{s.task_number} {s.task_title}</h2>
        {due && <Pill tone={due.urgent ? 'risk' : 'neutral'}>{due.text}</Pill>}
      </div>

      <div className="swap__flow" aria-label={`Move from ${from} to ${to}`}>
        <div className="swap__person">
          <span className="swap__eyebrow">From</span>
          <strong>{from}</strong>
          <span>{s.from_open_tasks} open task{s.from_open_tasks === 1 ? '' : 's'} → {s.from_open_tasks - 1}</span>
        </div>
        <svg className="swap__arrow" width="32" height="20" viewBox="0 0 32 20" aria-hidden="true">
          <path d="M2 10h26M20 3l8 7-8 7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <div className="swap__person swap__person--to">
          <span className="swap__eyebrow">To</span>
          <strong>{to}</strong>
          <span>{s.to_open_tasks} open task{s.to_open_tasks === 1 ? '' : 's'} → {s.to_open_tasks + 1}</span>
        </div>
      </div>

      {s.rationale.length > 0 && (
        <div className="swap__why">
          <h3>Why this swap</h3>
          <ul>{s.rationale.map((r, i) => <li key={i}>{r}</li>)}</ul>
        </div>
      )}

      {error && <p className="swap__error" role="alert">{error}</p>}
      <div className="swap__actions">
        <button type="button" className="btn btn--primary" disabled={!!busy} onClick={() => answer('accepted')}>
          {busy === 'accepted' ? 'Accepting…' : 'Accept swap'}
        </button>
        <button type="button" className="btn btn--secondary" disabled={!!busy} onClick={() => answer('discuss')}>
          Discuss with team
        </button>
        <button type="button" className="btn btn--ghost" disabled={!!busy} onClick={() => answer('dismissed')}>
          Dismiss
        </button>
      </div>

      {s.checkin_message && <CheckinMessage initial={s.checkin_message} />}
    </Card>
  );
}

export default function Rebalance() {
  const teamId = Number(useParams().teamId);
  const suggestions = useApi(() => api.suggestions(teamId), [teamId]);
  const [answered, setAnswered] = useState<Array<{ s: Suggestion; a: Answer }>>([]);

  return (
    <>
      <PageHeader title="Rebalance suggestions" />
      <p className="lead">
        Suggested task swaps based on the risks and on each person's open work. A swap is only suggested if it
        leaves the work more evenly spread. The team decides.
      </p>

      {answered.map(({ s, a }) => (
        <div key={s.id} className={`answered answered--${a}`} role="status">{CONFIRMATION[a](s)}</div>
      ))}

      {suggestions.loading && !suggestions.data && <Loading label="Loading suggestions…" />}
      {suggestions.error && <ErrorState message={suggestions.error} onRetry={suggestions.reload} />}
      {suggestions.data && suggestions.data.length === 0 && (
        <Card>
          <Empty>No swaps to suggest right now. Check the <Link to={`/teams/${teamId}/risks`}>risk radar</Link> for anything that needs attention.</Empty>
        </Card>
      )}
      {suggestions.data?.map(s => (
        <SuggestionCard
          key={s.id}
          s={s}
          teamId={teamId}
          onAnswered={(sug, a) => { setAnswered(prev => [...prev, { s: sug, a }]); suggestions.reload(); }}
        />
      ))}
    </>
  );
}
