import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../api/client.ts';
import { useApi } from '../../hooks/useApi.ts';
import Bulb, { LogoMark, type BulbState } from '../../components/Bulb.tsx';
import { ArrowLeft, ArrowRight, Check, fieldClass, fieldRowClass, inputClass, IssueIcon, linkClass, ListIcon, OptionCard, PersonRow, primaryBtnClass, secondaryBtnClass, srOnlyClass, textBtnClass } from '../../components/ui.tsx';

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
    <ol className="flex list-none flex-col">
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < step ? 'done' : n === step ? 'current' : 'upcoming';
        return (
          <li
            key={label}
            className={[
              'relative flex items-center gap-3 pb-7 text-label last:pb-0',
              state === 'current' ? 'text-base-content' : 'text-muted',
              '[&:not(:last-child)]:after:absolute [&:not(:last-child)]:after:top-8 [&:not(:last-child)]:after:left-[13px] [&:not(:last-child)]:after:h-5 [&:not(:last-child)]:after:w-0.5 [&:not(:last-child)]:after:rounded-px',
              state === 'done' ? '[&:not(:last-child)]:after:bg-primary' : '[&:not(:last-child)]:after:bg-neutral',
            ].filter(Boolean).join(' ')}
            aria-current={state === 'current' ? 'step' : undefined}
          >
            <span className={[
              'grid size-7 shrink-0 place-items-center rounded-full border-[1.5px] text-label',
              state === 'done'
                ? 'border-primary bg-primary text-primary-content'
                : state === 'current'
                  ? 'border-primary bg-accent-subtle text-primary'
                  : 'border-neutral bg-base-100',
            ].join(' ')}>
              {state === 'done' ? <Check size={14} /> : n}
            </span>
            <span>{label}</span>
            {state === 'done' && <span className={srOnlyClass}>(done)</span>}
          </li>
        );
      })}
    </ol>
  );
}

function Progress({ step, compact }: { step: Step; compact?: boolean }) {
  return (
    <div className={compact
      ? 'flex items-center gap-3 whitespace-nowrap text-muted'
      : 'mt-auto flex flex-col gap-2 text-muted'}>
      <span>Step {step} of 4</span>
      <span
        className={`block h-1 overflow-hidden rounded-sm bg-neutral ${compact ? 'w-24' : ''}`}
        role="progressbar"
        aria-valuemin={1}
        aria-valuemax={4}
        aria-valuenow={step}
        aria-label="Setup progress"
      >
        <span className="block h-full rounded-sm bg-primary motion-reduce:transition-none transition-[width] duration-200" style={{ width: `${step * 25}%` }} />
      </span>
    </div>
  );
}

/** Blurred, content-free sketch of the dashboard behind the setup dialog. */
function Backdrop() {
  return (
    <div className="pointer-events-none fixed inset-0 blur-[3px]" aria-hidden="true">
      <div className="flex h-full">
        <div className="flex w-60 flex-col gap-7 border-r border-neutral px-4 pt-[88px] max-md:hidden">
          {[150, 120, 170, 110, 140].map((w, i) => <span key={i} className="h-2.5 rounded-full bg-base-300" style={{ width: w }} />)}
        </div>
        <div className="flex flex-1 flex-col gap-6 p-8">
          <span className="h-[22px] w-[260px] rounded-full bg-base-300" />
          <div className="flex gap-4">
            {[0, 1, 2].map(i => (
              <div key={i} className="flex flex-1 flex-col gap-3 rounded-xl border border-neutral bg-base-200 p-5">
                <span className="h-2.5 w-20 rounded-full bg-neutral" />
                <span className="h-[26px] w-[120px] rounded-full bg-base-300" />
              </div>
            ))}
          </div>
          <div className="flex flex-1 flex-col gap-9 rounded-xl border border-neutral bg-base-200 p-5">
            {[320, 260, 380, 220, 300].map((w, i) => <span key={i} className="h-2.5 rounded-full bg-neutral" style={{ width: w }} />)}
          </div>
        </div>
      </div>
    </div>
  );
}

const brandClass = 'inline-flex items-center gap-3 text-wordmark';
const bodyClass = 'flex flex-1 flex-col gap-6 p-5 md:gap-8 md:px-12 md:py-10';
const primaryBtn = `${primaryBtnClass} w-full md:w-auto`;

function Mascot({ state, large }: { state: BulbState; large?: boolean }) {
  return large ? (
    <span className="grid size-24 shrink-0 place-items-center rounded-panel border border-neutral bg-accent-subtle md:size-[132px]">
      <Bulb state={state} height={116} className="max-md:h-[84px]! max-md:w-auto!" />
    </span>
  ) : (
    <span className="grid size-14 shrink-0 place-items-center rounded-card border border-neutral bg-accent-subtle md:size-[72px]">
      <Bulb state={state} height={64} className="max-md:h-[50px]! max-md:w-auto!" />
    </span>
  );
}

function Heading({ state, title, large }: { state: BulbState; title: string; large?: boolean }) {
  return large ? (
    <div className="flex">
      <Mascot state={state} large />
    </div>
  ) : (
    <div className="flex items-center gap-4 md:gap-5">
      <Mascot state={state} />
      <h1 id="setup-title" className="text-page md:text-step">{title}</h1>
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
      <form id="setup-form" className={bodyClass} onSubmit={connect} noValidate>
        <Heading state={busy ? 'thinking' : 'default'} title="" large />
        <div className="-mt-2 flex flex-col gap-2">
          <h1 id="setup-title" className="text-step md:text-welcome">Welcome to Maestro</h1>
          <p className="text-[18px] leading-7 tracking-[-0.005em] text-muted">Let&rsquo;s get started.</p>
        </div>
        <div className={fieldClass}>
          <label htmlFor="repo">Connect your GitHub repository</label>
          <input id="repo" className={inputClass} value={repoInput} onChange={e => setRepoInput(e.target.value)}
            placeholder="owner/repo" autoComplete="off" disabled={busy || (!!teamId && phase !== 'failed')} />
        </div>
        {busy && (
          <p className="text-muted" role="status">
            {phase === 'creating' ? 'Creating the team…' : 'Reading commits and Issues from GitHub. This can take a minute for larger repos…'}
          </p>
        )}
        {error && (
          <div className="flex flex-col gap-3 text-error" role="alert">
            <p>{error}</p>
            {phase === 'failed' && teamId && (
              <div className="flex flex-wrap items-center gap-3">
                <button type="button" className={secondaryBtnClass} onClick={() => sync(teamId)}>Retry sync</button>
                <button type="button" className={textBtnClass} onClick={() => { setPhase('idle'); setError(null); setStep(2); }}>Continue without syncing</button>
              </div>
            )}
          </div>
        )}
        {!teamId && teams.data && teams.data.length > 0 && (
          <div className="flex flex-col gap-2 border-t border-neutral pt-6">
            <p className="text-muted">Or open an existing team</p>
            <ul className="flex list-none flex-col gap-1">
              {teams.data.slice(0, 4).map(t => (
                <li key={t.id}><Link to={`/teams/${t.id}`} className={`${linkClass} gap-3!`}>{t.name}<span className="text-muted">{t.repo_owner}/{t.repo_name}</span></Link></li>
              ))}
            </ul>
          </div>
        )}
      </form>
    );
    primary = (
      <button type="submit" form="setup-form" className={primaryBtn} disabled={busy || (phase === 'failed' && !!teamId)}>
        {busy ? 'Connecting…' : teamId ? <>Continue <ArrowRight /></> : 'Connect with GitHub'}
      </button>
    );
  } else if (step === 2) {
    body = (
      <div className={bodyClass}>
        <Heading state={BULB[2]} title="Where does your plan live?" />
        <fieldset className="flex flex-col gap-3 border-0">
          <legend className={srOnlyClass}>Where does your plan live?</legend>
          <OptionCard name="plan" value="github" checked={plan === 'github'} onChange={setPlan} icon={<IssueIcon />}
            title="GitHub Issues" description="Tasks, owners and due dates come from your repo." />
          <OptionCard name="plan" value="other" checked={plan === 'other'} onChange={setPlan} icon={<ListIcon />}
            title="Somewhere else" description="Trello, a doc or a group chat. Record work by hand from Log work." />
        </fieldset>
      </div>
    );
    primary = <button type="button" className={primaryBtn} onClick={() => setStep(3)}>Continue <ArrowRight /></button>;
  } else if (step === 3) {
    body = (
      <div className={bodyClass}>
        <Heading state={BULB[3]} title="Invite your teammates" />
        <form className={fieldClass} onSubmit={addMember} noValidate>
          <label htmlFor="invite">GitHub username</label>
          <div className={fieldRowClass}>
            <input id="invite" className={inputClass} value={login} onChange={e => setLogin(e.target.value)} placeholder="username" autoComplete="off" />
            <button type="submit" className={secondaryBtnClass} disabled={memberBusy}>{memberBusy ? 'Adding…' : 'Add'}</button>
          </div>
          {memberError && <p className="text-error" role="alert">{memberError}</p>}
        </form>
        {people.length > 0 ? (
          <ul className="flex list-none flex-col gap-2" aria-label="Teammates">
            {people.map(m => (
              <PersonRow key={m.id} name={m.display_name ?? m.github_login!} username={m.github_login} onRemove={() => removeMember(m.id)} />
            ))}
          </ul>
        ) : <p className="text-muted">Everyone who commits to the repo is added automatically.</p>}
      </div>
    );
    primary = <button type="button" className={primaryBtn} onClick={() => setStep(4)}>Continue <ArrowRight /></button>;
  } else {
    const repo = parseRepo(repoInput);
    body = (
      <div className={bodyClass}>
        <Heading state={BULB[4]} title="Your project awaits" />
        <dl className="m-0 rounded-card border border-neutral bg-base-100 px-5">
          {([
            ['Repository', repo ? `${repo.owner}/${repo.repo}` : '—'],
            ['People', String(people.length)],
            ['Tasks', tasks.data ? String(tasks.data.length) : '—'],
          ] as const).map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 border-b border-neutral py-4 last:border-b-0 md:flex-row md:items-baseline md:justify-between md:gap-4">
              <dt className="text-muted">{label}</dt>
              <dd className="text-left text-label wrap-anywhere md:text-right">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
    );
    primary = <button type="button" className={primaryBtn} onClick={() => teamId && navigate(`/teams/${teamId}`)} disabled={!teamId}>Create</button>;
  }

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden p-8 max-md:items-end max-md:justify-items-stretch max-md:p-0">
      <Backdrop />
      <div className="fixed inset-0 bg-base-100/40" aria-hidden="true" />
      <div
        className="relative z-[1] flex min-h-[560px] w-full max-w-[960px] overflow-hidden border border-neutral bg-base-200 shadow-[0_24px_64px_rgba(0,0,0,0.5)] max-md:max-h-[92vh] max-md:min-h-0 max-md:overflow-y-auto max-md:rounded-t-panel max-md:rounded-b-none max-md:border-x-0 max-md:border-b-0 max-md:shadow-none md:rounded-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="setup-title"
      >
        <aside className="hidden w-[280px] shrink-0 flex-col gap-10 border-r border-neutral bg-base-100 p-8 min-[901px]:flex">
          <span className={brandClass}><LogoMark /><span>Maestro</span></span>
          <div className="flex flex-col gap-4">
            <span className="text-muted">Project setup</span>
            <Stepper step={step} />
          </div>
          <Progress step={step} />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="block px-5 pt-2.5 pb-1 min-[901px]:hidden md:px-12 md:pt-6 md:pb-0">
            <span className="mx-auto mb-3 block h-1 w-9 rounded-[2px] bg-neutral" aria-hidden="true" />
            <div className="flex items-center justify-between gap-3">
              <span className={brandClass}><LogoMark /><span>Maestro</span></span>
              <Progress step={step} compact />
            </div>
          </div>
          {body}
          <div className="flex flex-col-reverse items-stretch gap-1 px-5 pt-1 pb-8 max-md:border-t-0 md:flex-row md:items-center md:justify-between md:gap-4 md:border-t md:border-neutral md:px-12 md:py-5">
            {back ? <button type="button" className={`${textBtnClass} mx-auto md:mx-0 md:-ml-2`} onClick={back}><ArrowLeft />Back</button> : <span />}
            {primary}
          </div>
        </div>
      </div>
    </div>
  );
}
