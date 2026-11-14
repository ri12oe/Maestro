import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.ts';
import { useApi } from '../../hooks/useApi.ts';
import Bulb, { LogoMark, type BulbState } from '../../components/Bulb.tsx';
import { ArrowLeft, ArrowRight, Check, IssueIcon, ListIcon, OptionCard, PersonRow } from '../../components/ui.tsx';
import './Setup.scss';

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

type Step = 1 | 2 | 3 | 4;
type Phase = 'idle' | 'creating' | 'syncing' | 'failed';
const STEPS = ['Connect repository', 'Choose plan source', 'Invite teammates', 'Create project'];
const BULB: Record<Step, BulbState> = { 1: 'default', 2: 'thinking', 3: 'happy', 4: 'done' };

function Stepper({ step }: { step: Step }) {
  return (
    <ol className="stepper">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? 'done' : n === step ? 'current' : 'upcoming';
        return (
          <li key={label} className={`stepper__item is-${state}`} aria-current={state === 'current' ? 'step' : undefined}>
            <span className="stepper__dot">{state === 'done' ? <Check size={14} /> : n}</span>
            <span>{label}</span>
            {state === 'done' && <span className="visually-hidden">(done)</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Progress({ step, compact }: { step: Step; compact?: boolean }) {
  return (
    <div className={`progress${compact ? ' progress--compact' : ''}`}>
      <span>Step {step} of 4</span>
      <span className="progress__track" role="progressbar" aria-valuemin={1} aria-valuemax={4} aria-valuenow={step} aria-label="Setup progress">
        <span style={{ width: `${step * 25}%` }} />
      </span>
    </div>
  );
}

/** Blurred, content-free sketch of the dashboard behind the setup dialog. */
function Backdrop() {
  return (
    <div className="setup__backdrop" aria-hidden="true">
      <div className="sk-shell">
        <div className="sk-nav">{[150, 120, 170, 110, 140].map((w, i) => <span key={i} style={{ width: w }} />)}</div>
        <div className="sk-main">
          <span className="sk-title" />
          <div className="sk-stats">{[0, 1, 2].map(i => <div key={i} className="sk-card"><span /><span /></div>)}</div>
          <div className="sk-card sk-list">{[320, 260, 380, 220, 300].map((w, i) => <span key={i} style={{ width: w }} />)}</div>
        </div>
      </div>
    </div>
  );
}

function Heading({ state, title, large }: { state: BulbState; title: string; large?: boolean }) {
  return large ? (
    <div className="setup__intro">
      <span className="mascot-tile mascot-tile--large"><Bulb state={state} height={116} /></span>
    </div>
  ) : (
    <div className="setup__title-group">
      <span className="mascot-tile"><Bulb state={state} height={64} /></span>
      <h1 id="setup-title" className="setup__h1">{title}</h1>
    </div>
  );
}

export default function Setup() {
  const navigate = useNavigate();
  const teams = useApi(() => api.teams(), []);
  const [step, setStep] = useState<Step>(1);
  const [repoInput, setRepoInput] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [plan, setPlan] = useState('github');
  const [login, setLogin] = useState('');
  const [memberError, setMemberError] = useState<string | null>(null);
  const [memberBusy, setMemberBusy] = useState(false);

  const members = useApi(() => (teamId ? api.members(teamId) : Promise.resolve([])), [teamId]);
  const tasks = useApi(() => (teamId ? api.tasks(teamId) : Promise.resolve([])), [teamId, phase]);
  const people = (members.data ?? []).filter(m => m.github_login);
  const busy = phase === 'creating' || phase === 'syncing';

  async function sync(id: number) {
    setPhase('syncing');
    setError(null);
    try {
      await api.sync(id);
      setPhase('idle');
      members.reload();
      setStep(2);
    } catch (e) {
      setPhase('failed');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function connect(e: FormEvent) {
    e.preventDefault();
    if (teamId && phase !== 'failed') { setStep(2); return; }
    const parsed = parseRepo(repoInput);
    if (!parsed) { setError('Enter the repository as owner/repo, or paste its GitHub URL.'); return; }
    setPhase('creating');
    setError(null);
    try {
      const team = await api.createTeam({ name: parsed.repo, repo_owner: parsed.owner, repo_name: parsed.repo });
      setTeamId(team.id);
      await sync(team.id);
    } catch (e2) {
      setPhase('failed');
      setError(e2 instanceof Error ? e2.message : String(e2));
    }
  }

  async function addMember(e: FormEvent) {
    e.preventDefault();
    const value = login.trim().replace(/^@/, '');
    if (!teamId || !value) { setMemberError('Enter a GitHub username.'); return; }
    setMemberBusy(true);
    setMemberError(null);
    try { await api.addMember(teamId, value); setLogin(''); members.reload(); }
    catch (err) { setMemberError(err instanceof Error ? err.message : String(err)); }
    finally { setMemberBusy(false); }
  }

  async function removeMember(id: number) {
    if (!teamId) return;
    try { await api.removeMember(teamId, id); members.reload(); }
    catch (err) { setMemberError(err instanceof Error ? err.message : String(err)); }
  }

  const back = step > 1 ? () => setStep((step - 1) as Step) : undefined;
  let body: ReactNode;
  let primary: ReactNode;

  if (step === 1) {
    body = (
      <form id="setup-form" className="setup__body" onSubmit={connect} noValidate>
        <Heading state={busy ? 'thinking' : 'default'} title="" large />
        <div className="setup__welcome">
          <h1 id="setup-title" className="setup__h1 setup__h1--welcome">Welcome to Maestro</h1>
          <p className="setup__lead">Let&rsquo;s get started.</p>
        </div>
        <div className="field">
          <label htmlFor="repo">Connect your GitHub repository</label>
          <input id="repo" className="input" value={repoInput} onChange={e => setRepoInput(e.target.value)}
            placeholder="owner/repo" autoComplete="off" disabled={busy || (!!teamId && phase !== 'failed')} />
        </div>
        {busy && (
          <p className="setup__status" role="status">
            {phase === 'creating' ? 'Creating the team…' : 'Reading commits and Issues from GitHub. This can take a minute for larger repos…'}
          </p>
        )}
        {error && (
          <div className="setup__error" role="alert">
            <p>{error}</p>
            {phase === 'failed' && teamId && (
              <div className="setup__retry">
                <button type="button" className="btn btn--secondary" onClick={() => sync(teamId)}>Retry sync</button>
                <button type="button" className="text-btn" onClick={() => { setPhase('idle'); setError(null); setStep(2); }}>Continue without syncing</button>
              </div>
            )}
          </div>
        )}
        {!teamId && teams.data && teams.data.length > 0 && (
          <div className="setup__existing">
            <p className="muted">Or open an existing team</p>
            <ul>
              {teams.data.slice(0, 4).map(t => (
                <li key={t.id}><Link to={`/teams/${t.id}`} className="link">{t.name}<span className="muted">{t.repo_owner}/{t.repo_name}</span></Link></li>
              ))}
            </ul>
          </div>
        )}
      </form>
    );
    primary = (
      <button type="submit" form="setup-form" className="btn btn--primary" disabled={busy || (phase === 'failed' && !!teamId)}>
        {busy ? 'Connecting…' : teamId ? <>Continue <ArrowRight /></> : 'Connect with GitHub'}
      </button>
    );
  } else if (step === 2) {
    body = (
      <div className="setup__body">
        <Heading state={BULB[2]} title="Where does your plan live?" />
        <fieldset className="setup__options">
          <legend className="visually-hidden">Where does your plan live?</legend>
          <OptionCard name="plan" value="github" checked={plan === 'github'} onChange={setPlan} icon={<IssueIcon />}
            title="GitHub Issues" description="Tasks, owners and due dates come from your repo." />
          <OptionCard name="plan" value="other" checked={plan === 'other'} onChange={setPlan} icon={<ListIcon />}
            title="Somewhere else" description="Trello, a doc or a group chat. Record work by hand from Log work." />
        </fieldset>
      </div>
    );
    primary = <button type="button" className="btn btn--primary" onClick={() => setStep(3)}>Continue <ArrowRight /></button>;
  } else if (step === 3) {
    body = (
      <div className="setup__body">
        <Heading state={BULB[3]} title="Invite your teammates" />
        <form className="field" onSubmit={addMember} noValidate>
          <label htmlFor="invite">GitHub username</label>
          <div className="field__row">
            <input id="invite" className="input" value={login} onChange={e => setLogin(e.target.value)} placeholder="username" autoComplete="off" />
            <button type="submit" className="btn btn--secondary" disabled={memberBusy}>{memberBusy ? 'Adding…' : 'Add'}</button>
          </div>
          {memberError && <p className="setup__inline-error" role="alert">{memberError}</p>}
        </form>
        {people.length > 0 ? (
          <ul className="person-list" aria-label="Teammates">
            {people.map(m => (
              <PersonRow key={m.id} name={m.display_name ?? m.github_login!} username={m.github_login} onRemove={() => removeMember(m.id)} />
            ))}
          </ul>
        ) : <p className="muted">Everyone who commits to the repo is added automatically.</p>}
      </div>
    );
    primary = <button type="button" className="btn btn--primary" onClick={() => setStep(4)}>Continue <ArrowRight /></button>;
  } else {
    const repo = parseRepo(repoInput);
    body = (
      <div className="setup__body">
        <Heading state={BULB[4]} title="Your project awaits" />
        <dl className="summary">
          <div><dt>Repository</dt><dd>{repo ? `${repo.owner}/${repo.repo}` : '—'}</dd></div>
          <div><dt>People</dt><dd>{people.length}</dd></div>
          <div><dt>Tasks</dt><dd>{tasks.data?.length ?? '—'}</dd></div>
        </dl>
      </div>
    );
    primary = <button type="button" className="btn btn--primary" onClick={() => teamId && navigate(`/teams/${teamId}`)} disabled={!teamId}>Create</button>;
  }

  return (
    <div className="setup">
      <Backdrop />
      <div className="setup__scrim" aria-hidden="true" />
      <div className="setup-modal" role="dialog" aria-modal="true" aria-labelledby="setup-title">
        <aside className="setup-modal__rail">
          <span className="setup-modal__brand"><LogoMark /><span>Maestro</span></span>
          <div className="setup-modal__steps">
            <span className="muted">Project setup</span>
            <Stepper step={step} />
          </div>
          <Progress step={step} />
        </aside>

        <div className="setup-modal__pane">
          <div className="setup-modal__sheet-head">
            <span className="handle" aria-hidden="true" />
            <div className="setup-modal__sheet-row">
              <span className="setup-modal__brand"><LogoMark /><span>Maestro</span></span>
              <Progress step={step} compact />
            </div>
          </div>
          {body}
          <div className="setup-modal__footer">
            {back ? <button type="button" className="text-btn" onClick={back}><ArrowLeft />Back</button> : <span />}
            {primary}
          </div>
        </div>
      </div>
    </div>
  );
}
