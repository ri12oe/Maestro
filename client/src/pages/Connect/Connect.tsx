import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.ts';
import { useApi } from '../../hooks/useApi.ts';
import { ErrorState, Loading } from '../../components/ui.tsx';
import '../../components/ui.scss';
import './Connect.scss';

/** Accepts "owner/repo", "github.com/owner/repo" or a full URL (with or without .git). */
export function parseRepo(input: string): { owner: string; repo: string } | null {
  const cleaned = input.trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\/+$/, '');
  const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(cleaned);
  return m ? { owner: m[1], repo: m[2] } : null;
}

type Phase = 'idle' | 'creating' | 'syncing' | 'failed';

function Logo() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M9 16h14M16 9v14" stroke="#1F5FBF" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export default function Connect() {
  const navigate = useNavigate();
  const teams = useApi(() => api.teams(), []);
  const [repoInput, setRepoInput] = useState('');
  const [teamName, setTeamName] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pendingTeamId, setPendingTeamId] = useState<number | null>(null);

  async function sync(teamId: number) {
    setPhase('syncing');
    setError(null);
    try {
      await api.sync(teamId);
      navigate(`/teams/${teamId}`);
    } catch (e) {
      setPhase('failed');
      setError(e instanceof Error ? e.message : String(e));
      teams.reload(); // the team exists even if its first sync failed
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = parseRepo(repoInput);
    if (!parsed) { setError('Enter the repository as owner/repo, e.g. ri12oe/Maestro, or paste its GitHub URL.'); return; }

    setPhase('creating');
    setError(null);
    try {
      const team = await api.createTeam({
        name: teamName.trim() || parsed.repo,
        repo_owner: parsed.owner,
        repo_name: parsed.repo,
      });
      setPendingTeamId(team.id);
      await sync(team.id);
    } catch (e2) {
      setPhase('failed');
      setError(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  const busy = phase === 'creating' || phase === 'syncing';

  return (
    <div className="connect">
      <div className="connect__inner">
        <div className="connect__brand"><Logo /><span>Referee</span></div>

        <div className="connect__intro">
          <h1>Set up your team</h1>
          <p>Connect your repo once. Everyone on the team sees the same live picture of who is carrying what.</p>
        </div>

        <div className="split">
          <div className="split__main connect__steps">
            <form className="card connect__step" onSubmit={submit} noValidate>
              <div className="connect__num"><span>1</span><h2>Connect your GitHub repo</h2></div>
              <div className="field">
                <label htmlFor="repo">Repository</label>
                <input id="repo" value={repoInput} onChange={e => setRepoInput(e.target.value)}
                  placeholder="owner/repo or https://github.com/owner/repo" autoComplete="off" disabled={busy} />
              </div>
              <div className="field">
                <label htmlFor="team">Team name <span className="optional">(optional)</span></label>
                <input id="team" value={teamName} onChange={e => setTeamName(e.target.value)}
                  placeholder="Defaults to the repo name" disabled={busy} />
              </div>
              <p className="connect__note">Read-only access to commits and Issues. Referee never writes to GitHub.</p>

              {busy && (
                <p className="connect__progress" role="status">
                  {phase === 'creating' ? 'Creating the team…' : 'Reading commits and Issues from GitHub and labeling the work. This can take a minute for larger repos…'}
                </p>
              )}
              {error && (
                <div className="connect__error" role="alert">
                  <p>{error}</p>
                  {phase === 'failed' && pendingTeamId && (
                    <div className="connect__retry">
                      <button type="button" className="btn btn--secondary btn--small" onClick={() => sync(pendingTeamId)}>Retry sync</button>
                      <Link to={`/teams/${pendingTeamId}`}>Open the team anyway</Link>
                    </div>
                  )}
                </div>
              )}

              <div>
                <button type="submit" className="btn btn--primary" disabled={busy || (phase === 'failed' && !!pendingTeamId)}>
                  {busy ? 'Connecting…' : 'Connect and sync'}
                </button>
              </div>
            </form>

            <section className="card connect__step">
              <div className="connect__num"><span>2</span><h2>Your plan comes from GitHub Issues</h2></div>
              <p className="connect__text">
                Referee reads the repo's Issues as the task list and uses milestone due dates as deadlines.
                Assign each Issue to the person working on it.
              </p>
            </section>

            <section className="card connect__step">
              <div className="connect__num"><span>3</span><h2>Teammates are found automatically</h2></div>
              <p className="connect__text">
                Everyone who commits to the repo appears on the team. Work that isn't code — design, research,
                meetings — can be added from <strong>Log work</strong>.
              </p>
            </section>
          </div>

          <aside className="split__side connect__promise">
            <h2>Our fairness promise</h2>
            <p className="connect__promise-lead">A mirror for the team, not a camera for the instructor.</p>
            <ul>
              <li>Everyone sees the same view. No hidden admin.</li>
              <li>Only work you already share: commits, Issues and what you log. No keystroke or screen tracking.</li>
              <li>Every AI label links to its evidence, and anyone can dispute it.</li>
              <li>The AI never grades or ranks anyone.</li>
              <li>Design, research and coordination count too.</li>
            </ul>
          </aside>
        </div>

        <section className="card connect__existing">
          <h2 className="card__title">Open an existing team</h2>
          {teams.loading && !teams.data && <Loading />}
          {teams.error && <ErrorState message={teams.error} onRetry={teams.reload} />}
          {teams.data && teams.data.length === 0 && <p className="connect__text">No teams yet.</p>}
          {teams.data && teams.data.length > 0 && (
            <ul>
              {teams.data.map(t => (
                <li key={t.id}>
                  <Link to={`/teams/${t.id}`}>{t.name}</Link>
                  <span>{t.repo_owner}/{t.repo_name} · {t.member_count} member{t.member_count === 1 ? '' : 's'} · {t.contribution_count} contribution{t.contribution_count === 1 ? '' : 's'}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
