import { useCallback, useEffect, useState } from 'react';
import { api } from '../../api/client.ts';
import type { RiskLevel, Suggestion } from '../../api/types.ts';
import { useApi } from '../../hooks/useApi.ts';
import { Page, useTeam } from '../../components/Layout.tsx';
import { ArrowRight, Check, EmptyState, ErrorState, Initials, linkClass, Loading, primaryBtnClass, RiskBadge, secondaryBtnClass, srOnlyClass, Toast } from '../../components/ui.tsx';

function display(name: string | null, login: string): string {
  return name || login;
}

// Survives leaving this page, so Undo is still there after checking the new owner.
const acceptedByTeam = new Map<number, Suggestion[]>();

const suggestionClass = 'flex w-full max-w-[720px] flex-col gap-6 rounded-card border border-neutral bg-base-200 p-5 md:p-6';
const bodyClass = 'text-[18px] leading-7 tracking-[-0.005em]';

function PersonChip({ name, open }: { name: string; open: number }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-neutral bg-base-300 py-1.5 pr-3 pl-1.5 [&_.initials]:size-6! [&_.initials]:bg-base-100! [&_.initials]:text-[12px]! [&_.initials]:[line-height:16px]! [&_.initials]:[font-weight:500]!">
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
    <div className="flex w-full max-w-[720px] items-start gap-3 rounded-card border border-neutral bg-base-200 p-5 text-label md:px-6 md:py-5" role="status">
      <Check className="mt-0.5 shrink-0 text-success" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <p>
          Swap accepted. #{s.task_number} is now {who}&rsquo;s.{' '}
          <button
            type="button"
            className={`${linkClass} inline! align-baseline! underline! underline-offset-[3px]! focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-[0.55]`}
            disabled={busy}
            aria-label={busy ? `Undoing swap of #${s.task_number}` : `Undo swap of #${s.task_number}`}
            onClick={() => void undo()}
          >
            {busy ? 'Undoing…' : 'Undo'}
          </button>
        </p>
        {error && <p className="text-error" role="alert">{error}</p>}
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
    <section className={suggestionClass} aria-labelledby={`sug-${s.id}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 id={`sug-${s.id}`} className="text-card">#{s.task_number} {s.task_title}</h2>
        {level && <RiskBadge level={level} />}
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2" aria-label={`Move from ${from} to ${to}`}>
        <PersonChip name={from} open={s.from_open_tasks} />
        <ArrowRight className="text-muted" />
        <PersonChip name={to} open={s.to_open_tasks} />
      </div>

      {s.rationale.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-label font-medium! text-muted">Why</h3>
          {s.rationale.map((r, i) => <p key={i} className={bodyClass}>{r}</p>)}
        </div>
      )}

      {s.checkin_message && (
        <div className="flex flex-col gap-2">
          <h3 className="text-label font-medium! text-muted">Check-in message</h3>
          <p className={`${bodyClass} rounded-control border border-neutral bg-base-100 p-4`}>{s.checkin_message}</p>
          <div className="flex">
            <button
              type="button"
              className={secondaryBtnClass}
              onClick={async () => {
                try { await navigator.clipboard.writeText(s.checkin_message ?? ''); setCopied(true); }
                catch { setCopied(false); }
              }}
            >
              {copied ? 'Copied' : 'Copy message'}
            </button>
            <span className={srOnlyClass} role="status">{copied ? 'Message copied to clipboard.' : ''}</span>
          </div>
        </div>
      )}

      {error && <p className="text-error" role="alert">{error}</p>}
      <div className="flex flex-wrap gap-3 border-t border-neutral pt-5">
        <button type="button" className={primaryBtnClass} disabled={!!busy} onClick={() => answer('accepted')}>
          {busy === 'accepted' ? 'Accepting…' : 'Accept swap'}
        </button>
        <button type="button" className={secondaryBtnClass} disabled={!!busy} onClick={() => answer('dismissed')}>
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
