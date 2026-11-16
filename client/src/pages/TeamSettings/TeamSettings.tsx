import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../api/client.ts';
import { useApi } from '../../hooks/useApi.ts';
import { Page, useTeam } from '../../components/Layout.tsx';
import { Card, ErrorState, fieldClass, fieldHelpClass, fieldRowClass, inputClass, Loading, PersonRow, secondaryBtnClass, srOnlyClass } from '../../components/ui.tsx';
import { effectiveDeadline, type DeadlineSource } from '../../deadline.ts';

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function sourceHint(source: DeadlineSource | null): string {
  if (source === 'team') return 'Set by the team.';
  if (source === 'milestones') return 'From GitHub milestones.';
  return 'No milestone due date.';
}

export default function TeamSettings() {
  const { teamId, summary, version, refresh, reload } = useTeam();
  const members = useApi(() => api.members(teamId), [teamId, version]);
  const tasks = useApi(() => api.tasks(teamId), [teamId, version]);
  const teamRecord = useApi(() => api.team(teamId), [teamId, version]);
  const [login, setLogin] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // null follows the date in effect (stored, or the milestone date). A string is an edit.
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState<'save' | 'clear' | null>(null);
  const [deadlineError, setDeadlineError] = useState<string | null>(null);
  // Keeps the field in sync after a save before the refetch lands.
  const [localDeadline, setLocalDeadline] = useState<string | null | undefined>(undefined);

  const team = summary?.team;
  const people = (members.data ?? []).filter(m => m.github_login);
  const stored = localDeadline !== undefined ? localDeadline : (teamRecord.data?.deadline ?? null);
  const canResolve = teamRecord.data != null || localDeadline !== undefined;
  const resolved = canResolve
    ? effectiveDeadline(stored, (tasks.data ?? []).map(t => t.due_date))
    : null;
  const baseline = resolved?.date ? resolved.date.slice(0, 10) : '';
  const dateValue = draft ?? baseline;

  async function add(e: FormEvent) {
    e.preventDefault();
    const value = login.trim().replace(/^@/, '');
    if (!value) { setError('Enter a GitHub username.'); return; }
    setBusy(true);
    setError(null);
    try { await api.addMember(teamId, value); setLogin(''); members.reload(); refresh(); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }

  async function remove(id: number) {
    setRemoving(id);
    setError(null);
    try { await api.removeMember(teamId, id); members.reload(); refresh(); }
    catch (err) { setError(message(err)); }
    finally { setRemoving(null); }
  }

  async function persist(deadline: string | null, action: 'save' | 'clear') {
    setSaving(action);
    setDeadlineError(null);
    try {
      const updated = await api.setDeadline(teamId, deadline);
      setLocalDeadline(updated.deadline);
      setDraft(null);
      try {
        await api.classify(teamId);
        reload();
      } catch (err) {
        setDeadlineError(message(err));
      }
    } catch (err) {
      setDeadlineError(message(err));
    } finally {
      setSaving(null);
    }
  }

  function save(e: FormEvent) {
    e.preventDefault();
    if (!dateValue || dateValue === baseline || saving) return;
    void persist(dateValue, 'save');
  }

  return (
    <Page title="Team settings">
      <div className="flex w-full max-w-[720px] flex-col gap-4 md:gap-6">
        <Card title="Repository">
          <div className="flex items-center justify-between gap-4 max-md:flex-col max-md:items-start">
            <div>
              <p className="text-label">{team?.repo ?? '—'}</p>
              <p className="text-muted">
                {team?.isDemo ? 'Demo data, not connected to GitHub'
                  : team?.lastSyncedAt ? `Last synced ${dateFmt.format(new Date(team.lastSyncedAt))}, ${timeFmt.format(new Date(team.lastSyncedAt))}`
                  : 'Not synced yet'}
              </p>
            </div>
            <Link to="/" className={secondaryBtnClass}>Change repository</Link>
          </div>
        </Card>

        <Card title="Members">
          {members.loading && !members.data && <Loading />}
          {members.error && <ErrorState message={members.error} onRetry={members.reload} />}
          {people.length > 0 && (
            <ul className="flex list-none flex-col gap-2">
              {people.map(m => (
                <PersonRow key={m.id} name={m.display_name ?? m.github_login!} username={m.github_login}
                  onRemove={() => remove(m.id)} removing={removing === m.id} />
              ))}
            </ul>
          )}
          <form className={fieldRowClass} onSubmit={add} noValidate>
            <label htmlFor="add-member" className={srOnlyClass}>GitHub username</label>
            <input id="add-member" className={inputClass} value={login} onChange={e => setLogin(e.target.value)} placeholder="username" autoComplete="off" />
            <button type="submit" className={secondaryBtnClass} disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
          </form>
          {error && <p className="text-error" role="alert">{error}</p>}
        </Card>

        <Card title="Deadline">
          {teamRecord.loading && !teamRecord.data && localDeadline === undefined && <Loading />}
          {teamRecord.error && !teamRecord.data && localDeadline === undefined && (
            <ErrorState message={teamRecord.error} onRetry={teamRecord.reload} />
          )}
          {canResolve && (
            <form className={fieldClass} onSubmit={save} noValidate>
              <div className={`${fieldRowClass} max-md:flex-wrap`}>
                <label htmlFor="deadline" className={srOnlyClass}>Deadline</label>
                <input
                  id="deadline"
                  className={`${inputClass} scheme-dark`}
                  type="date"
                  value={dateValue}
                  aria-describedby="deadline-hint"
                  onChange={e => setDraft(e.target.value || null)}
                />
                <button type="submit" className={secondaryBtnClass} disabled={!!saving || !dateValue || dateValue === baseline}>
                  {saving === 'save' ? 'Saving…' : 'Save'}
                </button>
                {stored && (
                  <button
                    type="button"
                    className={secondaryBtnClass}
                    disabled={!!saving}
                    aria-label="Clear the date and use the milestone date"
                    onClick={() => void persist(null, 'clear')}
                  >
                    {saving === 'clear' ? 'Clearing…' : 'Clear'}
                  </button>
                )}
              </div>
              <p className={fieldHelpClass} id="deadline-hint">{sourceHint(resolved?.source ?? null)}</p>
              {deadlineError && <p className="text-error" role="alert">{deadlineError}</p>}
            </form>
          )}
        </Card>
      </div>
    </Page>
  );
}
