import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.ts';
import { useApi } from '../../hooks/useApi.ts';
import { Page, useTeam } from '../../components/Layout.tsx';
import { Card, ErrorState, Loading, PersonRow } from '../../components/ui.tsx';
import { effectiveDeadline, type DeadlineSource } from '../../deadline.ts';
import './TeamSettings.scss';

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
      <div className="settings">
        <Card title="Repository">
          <div className="settings__repo">
            <div>
              <p className="settings__repo-name">{team?.repo ?? '—'}</p>
              <p className="muted">
                {team?.isDemo ? 'Demo data, not connected to GitHub'
                  : team?.lastSyncedAt ? `Last synced ${dateFmt.format(new Date(team.lastSyncedAt))}, ${timeFmt.format(new Date(team.lastSyncedAt))}`
                  : 'Not synced yet'}
              </p>
            </div>
            <Link to="/" className="btn btn--secondary">Change repository</Link>
          </div>
        </Card>

        <Card title="Members">
          {members.loading && !members.data && <Loading />}
          {members.error && <ErrorState message={members.error} onRetry={members.reload} />}
          {people.length > 0 && (
            <ul className="person-list">
              {people.map(m => (
                <PersonRow key={m.id} name={m.display_name ?? m.github_login!} username={m.github_login}
                  onRemove={() => remove(m.id)} removing={removing === m.id} />
              ))}
            </ul>
          )}
          <form className="field__row" onSubmit={add} noValidate>
            <label htmlFor="add-member" className="visually-hidden">GitHub username</label>
            <input id="add-member" className="input" value={login} onChange={e => setLogin(e.target.value)} placeholder="username" autoComplete="off" />
            <button type="submit" className="btn btn--secondary" disabled={busy}>{busy ? 'Adding…' : 'Add'}</button>
          </form>
          {error && <p className="settings__error" role="alert">{error}</p>}
        </Card>

        <Card title="Deadline">
          {teamRecord.loading && !teamRecord.data && localDeadline === undefined && <Loading />}
          {teamRecord.error && !teamRecord.data && localDeadline === undefined && (
            <ErrorState message={teamRecord.error} onRetry={teamRecord.reload} />
          )}
          {canResolve && (
            <form className="field settings__deadline" onSubmit={save} noValidate>
              <div className="field__row">
                <label htmlFor="deadline" className="visually-hidden">Deadline</label>
                <input
                  id="deadline"
                  className="input"
                  type="date"
                  value={dateValue}
                  aria-describedby="deadline-hint"
                  onChange={e => setDraft(e.target.value || null)}
                />
                <button type="submit" className="btn btn--secondary" disabled={!!saving || !dateValue || dateValue === baseline}>
                  {saving === 'save' ? 'Saving…' : 'Save'}
                </button>
                {stored && (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    disabled={!!saving}
                    aria-label="Clear the date and use the milestone date"
                    onClick={() => void persist(null, 'clear')}
                  >
                    {saving === 'clear' ? 'Clearing…' : 'Clear'}
                  </button>
                )}
              </div>
              <p className="field__help" id="deadline-hint">{sourceHint(resolved?.source ?? null)}</p>
              {deadlineError && <p className="settings__error" role="alert">{deadlineError}</p>}
            </form>
          )}
        </Card>

        <DangerZone teamId={teamId} teamName={team?.name ?? ''} />
      </div>
    </Page>
  );
}

function DangerZone({ teamId, teamName }: { teamId: number; teamName: string }) {
  const navigate = useNavigate();
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmed = teamName.length > 0 && typed.trim() === teamName.trim();

  function cancel() {
    setConfirming(false);
    setTyped('');
    setError(null);
  }

  async function disconnect(e: FormEvent) {
    e.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await api.deleteTeam(teamId);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  }

  return (
    <Card title="Danger zone" className="settings__danger">
      <p className="muted">
        Disconnecting removes this team from Maestro, including its members, tasks, and logged work. The GitHub repository is left unchanged.
      </p>
      {!confirming ? (
        <div className="settings__actions">
          <button type="button" className="btn btn--danger" onClick={() => setConfirming(true)} disabled={!teamName}>
            Disconnect team
          </button>
        </div>
      ) : (
        <form className="field" onSubmit={disconnect} noValidate>
          <label htmlFor="confirm-disconnect">Type {teamName} to confirm</label>
          <input
            id="confirm-disconnect"
            className="input"
            value={typed}
            onChange={e => setTyped(e.target.value)}
            autoComplete="off"
            autoFocus
            disabled={busy}
          />
          {error && <p className="settings__error" role="alert">{error}</p>}
          <div className="settings__actions">
            <button type="submit" className="btn btn--danger" disabled={busy || !confirmed}>
              {busy ? 'Disconnecting…' : 'Disconnect'}
            </button>
            <button type="button" className="text-btn" onClick={cancel} disabled={busy}>Cancel</button>
          </div>
        </form>
      )}
    </Card>
  );
}
