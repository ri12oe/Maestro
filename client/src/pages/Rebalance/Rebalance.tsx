import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import type { RiskLevel, Suggestion } from '../../api/types.ts';
import { useApi } from '../../hooks/useApi.ts';
import { Page, useTeam } from '../../components/Layout.tsx';
import { ArrowRight, Check, EmptyState, ErrorState, Initials, Loading, RiskBadge, Toast } from '../../components/ui.tsx';
import './Rebalance.scss';

function display(name: string | null, login: string): string {
  return name || login;
}

// Survives leaving this page, so Undo is still there after checking the new owner.
const acceptedByTeam = new Map<number, Suggestion[]>();

function PersonChip({ name, open }: { name: string; open: number }) {
  return (
    <span className="person-chip">
      <Initials name={name} />
      <span>{name} · {open} open</span>
    </span>
  );
}

function AcceptedSuggestion({ s, teamId, onUndone }: {
  s: Suggestion; teamId: number; onUndone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const who = display(s.to_name, s.to_login);

  async function undo() {
    setBusy(true);
    setError(null);
    try {
      await api.respond(teamId, s.id, 'pending');
      onUndone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div className="suggestion suggestion--accepted" role="status">
      <Check className="suggestion__ok" />
      <div className="suggestion__accepted-copy">
        <p>
          Swap accepted. #{s.task_number} is now {who}&rsquo;s.{' '}
          <button
            type="button"
            className="link"
            disabled={busy}
            aria-label={busy ? `Undoing swap of #${s.task_number}` : `Undo swap of #${s.task_number}`}
            onClick={() => void undo()}
          >
            {busy ? 'Undoing…' : 'Undo'}
          </button>
        </p>
        {error && <p className="suggestion__error" role="alert">{error}</p>}
      </div>
    </div>
  );
}

function SuggestionCard({ s, level, teamId, onAnswered }: {
  s: Suggestion; level?: RiskLevel; teamId: number; onAnswered: (s: Suggestion, a: 'accepted' | 'dismissed') => void;
}) {
  const [busy, setBusy] = useState<'accepted' | 'dismissed' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const from = display(s.from_name, s.from_login);
  const to = display(s.to_name, s.to_login);

  async function answer(a: 'accepted' | 'dismissed') {
    setBusy(a);
    setError(null);
    try { await api.respond(teamId, s.id, a); onAnswered(s, a); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(null); }
  }

  return (
    <section className="suggestion" aria-labelledby={`sug-${s.id}`}>
      <div className="suggestion__head">
        <h2 id={`sug-${s.id}`} className="suggestion__title">#{s.task_number} {s.task_title}</h2>
        {level && <RiskBadge level={level} />}
      </div>

      <div className="suggestion__flow" aria-label={`Move from ${from} to ${to}`}>
        <PersonChip name={from} open={s.from_open_tasks} />
        <ArrowRight className="muted" />
        <PersonChip name={to} open={s.to_open_tasks} />
      </div>

      {s.rationale.length > 0 && (
        <div className="suggestion__section">
          <h3 className="suggestion__label">Why</h3>
          {s.rationale.map((r, i) => <p key={i} className="suggestion__body">{r}</p>)}
        </div>
      )}

      {s.checkin_message && (
        <div className="suggestion__section">
          <h3 className="suggestion__label">Check-in message</h3>
          <p className="suggestion__message">{s.checkin_message}</p>
          <div className="suggestion__copy">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={async () => {
                try { await navigator.clipboard.writeText(s.checkin_message ?? ''); setCopied(true); }
                catch { setCopied(false); }
              }}
            >
              {copied ? 'Copied' : 'Copy message'}
            </button>
            <span className="visually-hidden" role="status">{copied ? 'Message copied to clipboard.' : ''}</span>
          </div>
        </div>
      )}

      {error && <p className="suggestion__error" role="alert">{error}</p>}
      <div className="suggestion__actions">
        <button type="button" className="btn btn--primary" disabled={!!busy} onClick={() => answer('accepted')}>
          {busy === 'accepted' ? 'Accepting…' : 'Accept swap'}
        </button>
        <button type="button" className="btn btn--secondary" disabled={!!busy} onClick={() => answer('dismissed')}>
          {busy === 'dismissed' ? 'Dismissing…' : 'Dismiss'}
        </button>
      </div>
    </section>
  );
}

export default function Rebalance() {
  const { teamId, version, refresh } = useTeam();
  const suggestions = useApi(() => api.suggestions(teamId), [teamId, version]);
  const risks = useApi(() => api.risks(teamId), [teamId, version]);
  const [accepted, setAccepted] = useState<Suggestion[]>(() => acceptedByTeam.get(teamId) ?? []);
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);

  useEffect(() => { setAccepted(acceptedByTeam.get(teamId) ?? []); }, [teamId]);

  function remember(update: (prev: Suggestion[]) => Suggestion[]) {
    setAccepted(prev => {
      const next = update(prev);
      acceptedByTeam.set(teamId, next);
      return next;
    });
  }

  const pending = suggestions.data ?? [];
  const levelFor = (taskId: number) => risks.data?.find(r => r.task_id === taskId)?.level;

  return (
    <Page title="Rebalance" subtitle="Suggestions are based on recent activity and open tasks. Nothing changes until your team agrees.">
      {accepted.map(s => (
        <AcceptedSuggestion
          key={s.id}
          s={s}
          teamId={teamId}
          onUndone={() => {
            remember(prev => prev.filter(item => item.id !== s.id));
            suggestions.reload();
            refresh();
          }}
        />
      ))}

      {suggestions.loading && !suggestions.data && <Loading label="Loading suggestions…" />}
      {suggestions.error && <ErrorState message={suggestions.error} onRetry={suggestions.reload} />}
      {suggestions.data && pending.length === 0 && accepted.length === 0 && (
        <EmptyState heading="No suggestions" line="Workload looks balanced. Check back after the next sync." />
      )}
      {pending.map(s => (
        <SuggestionCard
          key={s.id}
          s={s}
          level={levelFor(s.task_id)}
          teamId={teamId}
          onAnswered={(sug, a) => {
            if (a === 'accepted') {
              remember(prev => (prev.some(item => item.id === sug.id) ? prev : [...prev, sug]));
              setToast('Swap saved');
            }
            else setToast('Suggestion dismissed');
            suggestions.reload();
            refresh();
          }}
        />
      ))}

      {toast && <Toast message={toast} onClose={closeToast} />}
    </Page>
  );
}
