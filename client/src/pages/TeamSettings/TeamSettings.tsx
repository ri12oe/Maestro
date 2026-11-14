import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.ts';
import { useApi } from '../../hooks/useApi.ts';
import { Page, useTeam } from '../../components/Layout.tsx';
import { Card, ErrorState, Loading, PersonRow } from '../../components/ui.tsx';
import { projectDeadline } from '../Overview/Overview.tsx';
import './TeamSettings.scss';

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

function deadlineText(iso: string): string {
  return dateFmt.format(iso.length === 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso));
}

export default function TeamSettings() {
  const { teamId, summary, version, refresh } = useTeam();
  const members = useApi(() => api.members(teamId), [teamId, version]);
  const tasks = useApi(() => api.tasks(teamId), [teamId, version]);
  const [login, setLogin] = useState('');
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const team = summary?.team;
  const people = (members.data ?? []).filter(m => m.github_login);
  const deadline = tasks.data ? projectDeadline(tasks.data) : null;

  async function add(e: FormEvent) {
    e.preventDefault();
    const value = login.trim().replace(/^@/, '');
    if (!value) { setError('Enter a GitHub username.'); return; }
    setBusy(true);
    setError(null);
    try { await api.addMember(teamId, value); setLogin(''); members.reload(); refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setBusy(false); }
  }

  async function remove(id: number) {
    setRemoving(id);
    setError(null);
    try { await api.removeMember(teamId, id); members.reload(); refresh(); }
    catch (err) { setError(err instanceof Error ? err.message : String(err)); }
    finally { setRemoving(null); }
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
          <div className="field">
            <label htmlFor="deadline" className="visually-hidden">Deadline</label>
            <input id="deadline" className="input" readOnly value={deadline ? deadlineText(deadline) : 'No milestone due date'} />
            <p className="field__help">Taken from the GitHub milestone.</p>
          </div>
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
