import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowRight, Check, FolderGit2, Plus, X } from 'lucide-react';
import { api } from '../api/client.ts';
import type { Member, SyncResult, Task } from '../api/types.ts';
import { useApi } from '../hooks/useApi.ts';
import { timeAgo } from '../dates.ts';
import Bulb, { LogoMark } from '../components/Bulb.tsx';
import { effectiveDeadline } from '../deadline.ts';
import { useTheme } from '../lib/prefs.ts';
import { Avatar, Button, Skeleton, inputClass } from '../ui/primitives.tsx';

/** Accepts "owner/repo", "github.com/owner/repo" or a full URL (with or without .git). */
export function parseRepo(input: string): { owner: string; repo: string } | null {
  const cleaned = input.trim().replace(/^https?:\/\//i, '').replace(/^(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const m = /^([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+)$/.exec(cleaned);
  return m ? { owner: m[1], repo: m[2] } : null;
}

type Phase = 'form' | 'connecting' | 'connected' | 'failed';

export default function Start() {
  useTheme();
  const [params] = useSearchParams();
  const teams = useApi(() => api.teams(), []);
  const wantsNew = params.get('new') === '1';

  if (teams.loading && !teams.data) return <div className="grid min-h-dvh place-items-center"><Bulb state="thinking" height={72} /></div>;
  if (!wantsNew && teams.data && teams.data.length > 0) return <TeamList teams={teams.data} />;
  return <Connect hasTeams={!!teams.data?.length} />;
}

function TeamList({ teams }: { teams: Array<{ id: number; name: string; repo_owner: string; repo_name: string; member_count: number; contribution_count: number; created_at: string }> }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[880px] flex-col gap-8 px-5 py-16 md:px-8">
      <header className="flex items-center gap-3"><LogoMark size={36} /><h1 className="text-title-1">Your teams</h1></header>
      <ul className="grid list-none gap-4 sm:grid-cols-2">
        {teams.map(t => (
          <li key={t.id}>
            <Link to={`/t/${t.id}`} className="flex h-full flex-col gap-3 rounded-[10px] border border-line bg-surface-1 p-5 transition-colors hover:bg-surface-2">
              <span className="text-title-3">{t.name}</span>
              <span className="font-mono text-code text-fg-muted">{t.repo_owner}/{t.repo_name}</span>
              <span className="mt-auto flex items-center justify-between text-caption font-normal text-fg-muted">
                <span>{t.member_count} people · {t.contribution_count} contributions</span>
                <span>since {timeAgo(t.created_at)}</span>
              </span>
            </Link>
          </li>
        ))}
        <li>
          <Link to="/?new=1" className="flex h-full min-h-[132px] flex-col items-center justify-center gap-2 rounded-[10px] border border-dashed border-line-strong p-5 text-fg-muted transition-colors hover:bg-surface-1 hover:text-fg">
            <Plus size={20} aria-hidden="true" /><span className="text-label">Connect a repository</span>
          </Link>
        </li>
      </ul>
    </main>
  );
}

function Connect({ hasTeams }: { hasTeams: boolean }) {
  const navigate = useNavigate();
  const ids = { repo: useId(), add: useId(), deadline: useId() };
  const [repo, setRepo] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [deadline, setDeadline] = useState('');
  const [login, setLogin] = useState('');
  const [memberError, setMemberError] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);
  const parsed = parseRepo(repo);

  async function refreshTeam(id: number) {
    const [m, t] = await Promise.all([api.members(id), api.tasks(id)]);
    setMembers(m); setTasks(t);
    const d = effectiveDeadline(null, t.map(x => x.due_date)).date;
    if (d) setDeadline(cur => cur || d);
  }

  async function connect(e: FormEvent) {
    e.preventDefault();
    if (!parsed) { setError('Enter the repository as owner/repo, or paste its GitHub URL.'); return; }
    setPhase('connecting'); setError(null);
    try {
      let id = teamId;
      if (!id) { id = (await api.createTeam({ name: parsed.repo, repo_owner: parsed.owner, repo_name: parsed.repo })).id; setTeamId(id); }
      setResult(await api.sync(id));
      await refreshTeam(id);
      setPhase('connected');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('failed');
    }
  }

  async function addMember(e: FormEvent) {
    e.preventDefault();
    const v = login.trim().replace(/^@/, '');
    if (!teamId || !v) return;
    setMemberError(null);
    try { await api.addMember(teamId, v); setLogin(''); await refreshTeam(teamId); }
    catch (err) { setMemberError(err instanceof Error ? err.message : String(err)); }
  }

  async function open() {
    if (!teamId) return;
    setOpening(true);
    try { if (deadline) await api.setDeadline(teamId, deadline); await api.classify(teamId).catch(() => null); }
    finally { navigate(`/t/${teamId}`); }
  }

  const people = members.filter(m => m.github_login);
  const busy = phase === 'connecting';

  return (
    <div className="flex min-h-dvh flex-wrap">
      <main className="flex min-w-0 flex-[1_1_520px] justify-center px-6 py-14 md:px-8 lg:py-20">
        <div className="flex w-full max-w-[460px] flex-col gap-7">
          <div className="flex flex-col gap-4">
            <Bulb state={busy ? 'thinking' : phase === 'connected' ? 'happy' : 'default'} height={72} />
            <h1 className="text-[32px] leading-9 font-semibold tracking-[-0.03em] md:text-display">Meet Maestro</h1>
            <p className="text-brief text-pretty text-fg-muted">Maestro reads your team&rsquo;s GitHub repo and shows everyone the same picture of who is working on what.</p>
          </div>

          <form onSubmit={connect} className="flex flex-col gap-2" noValidate>
            <label htmlFor={ids.repo} className="text-label">Repository</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <FolderGit2 size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
                <input id={ids.repo} value={repo} onChange={e => { setRepo(e.target.value); setError(null); }} disabled={phase === 'connected' || busy}
                  placeholder="owner/repo or a GitHub URL" autoComplete="off" spellCheck={false} aria-invalid={!!error} aria-describedby={error ? `${ids.repo}-err` : undefined}
                  className={`${inputClass} h-11 pl-9 text-[14px]`} />
              </div>
              {phase !== 'connected' && <Button type="submit" size="lg" busy={busy} disabled={!repo.trim()}>{phase === 'failed' ? 'Try again' : 'Connect'}</Button>}
            </div>
            {error && <p id={`${ids.repo}-err`} className="text-caption font-normal text-risk-high" role="alert">{error}</p>}
            {phase === 'failed' && teamId && <button type="button" className="self-start text-label text-fg-muted underline underline-offset-[3px]" onClick={() => navigate(`/t/${teamId}`)}>Open without syncing</button>}
          </form>

          {phase === 'connected' && (
            <>
              <fieldset className="flex animate-pop-in flex-col gap-2">
                <legend className="mb-2 text-label">Team <span className="font-normal text-fg-muted">· from the people who committed</span></legend>
                {people.length === 0 && <p className="text-label font-normal text-fg-muted">No commit authors with GitHub accounts yet. Add your teammates below.</p>}
                <ul className="flex list-none flex-wrap gap-2">
                  {people.map(m => (
                    <li key={m.id} className="inline-flex h-9 items-center gap-2 rounded-full border border-line-strong bg-surface-2 pr-1 pl-1.5">
                      <Avatar name={m.display_name ?? m.github_login!} login={m.github_login} size={20} />
                      <span className="font-mono text-[12.5px]">@{m.github_login}</span>
                      <button type="button" aria-label={`Remove ${m.github_login}`} className="grid size-7 place-items-center rounded-full text-fg-muted hover:bg-surface-3 hover:text-fg"
                        onClick={async () => { setMemberError(null); try { await api.removeMember(teamId!, m.id); await refreshTeam(teamId!); } catch (err) { setMemberError(err instanceof Error ? err.message : String(err)); } }}><X size={13} /></button>
                    </li>
                  ))}
                </ul>
                <form onSubmit={addMember} className="mt-1 flex gap-2" noValidate>
                  <label htmlFor={ids.add} className="sr-only">Add by GitHub username</label>
                  <input id={ids.add} value={login} onChange={e => setLogin(e.target.value)} placeholder="Add by GitHub username" className={inputClass} />
                  <Button type="submit" disabled={!login.trim()}>Add</Button>
                </form>
                {memberError && <p className="text-caption font-normal text-risk-high" role="alert">{memberError}</p>}
              </fieldset>

              <div className="flex animate-pop-in flex-col gap-1.5">
                <label htmlFor={ids.deadline} className="text-label">Deadline <span className="font-normal text-fg-muted">· optional</span></label>
                <input id={ids.deadline} type="date" value={deadline} onChange={e => setDeadline(e.target.value)} className={`${inputClass} h-11`} />
                <p className="text-caption font-normal text-fg-muted">{tasks.some(t => t.due_date) ? 'From your GitHub milestones · you can change this later' : 'You can change this later in Settings.'}</p>
              </div>
            </>
          )}

          <ul className="flex list-none flex-col gap-1.5 text-label font-normal text-fg-muted">
            {['Everyone sees the same view.', 'Only work artifacts, never activity tracking.', 'Every AI label can be disputed.'].map(x => (
              <li key={x} className="flex items-center gap-2"><Check size={14} className="text-ok" aria-hidden="true" />{x}</li>
            ))}
          </ul>

          <div className="flex flex-col items-center gap-3">
            {phase === 'connected' && <Button variant="primary" size="lg" className="w-full" onClick={() => void open()} busy={opening}>Open Maestro <ArrowRight size={16} aria-hidden="true" /></Button>}
            {hasTeams && <Link to="/" className="text-label text-fg-muted hover:text-fg">Back to your teams</Link>}
          </div>
        </div>
      </main>

      <aside aria-label="Preview" className="hidden min-w-0 flex-[1_1_520px] items-center justify-center border-l border-line bg-surface-1 p-12 lg:flex">
        {busy || phase === 'connected' ? <SyncSteps done={phase === 'connected'} result={result} people={people.length} /> : <Preview name={parsed?.repo} />}
      </aside>
    </div>
  );
}

function Preview({ name }: { name?: string }) {
  return (
    <div aria-hidden="true" className="flex h-[420px] w-full max-w-[560px] overflow-hidden rounded-xl border border-line-strong bg-canvas shadow-[var(--shadow-glass)]">
      <div className="flex w-[132px] flex-col gap-2 border-r border-line bg-surface-1 p-3">
        <div className="flex items-center gap-1.5"><LogoMark size={18} /><span className={`truncate text-[10px] font-semibold ${name ? 'text-fg' : 'text-fg-subtle'}`}>{name ?? 'Your team'}</span></div>
        <Skeleton w="100%" h={20} /><Skeleton w="70%" h={10} className="mt-1.5" /><Skeleton w="50%" h={10} /><Skeleton w="60%" h={10} />
      </div>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-center justify-between"><Skeleton w={64} h={12} /><Skeleton w={56} h={14} /></div>
        <div className="flex h-16 flex-col gap-1.5 rounded-lg border border-maestro-line bg-maestro-wash p-2.5">
          <span className="h-2 w-2/5 rounded bg-maestro-line" /><span className="h-2 w-5/6 rounded bg-maestro-line" /><span className="h-2 w-3/5 rounded bg-maestro-line" />
        </div>
        <span className="h-20 rounded-lg border border-line bg-surface-1" /><span className="h-20 rounded-lg border border-line bg-surface-1" /><span className="h-10 rounded-lg border border-line bg-surface-1" />
      </div>
    </div>
  );
}

function SyncSteps({ done, result, people }: { done: boolean; result: SyncResult | null; people: number }) {
  const [tick, setTick] = useState(0);
  useEffect(() => { if (done) return; const t = window.setInterval(() => setTick(x => Math.min(x + 1, 2)), 1400); return () => window.clearInterval(t); }, [done]);
  const steps = [
    done && result ? `Read ${result.newContributions} commits` : 'Reading commits and Issues',
    done && result ? `Labeled ${result.classified} change${result.classified === 1 ? '' : 's'}` : 'Labeling each change',
    done ? `Found ${people} ${people === 1 ? 'person' : 'people'}` : 'Checking the plan against the deadline',
  ];
  return (
    <div role="status" aria-live="polite" className="flex w-full max-w-[380px] flex-col items-center gap-6 text-center">
      <Bulb state={done ? 'done' : 'thinking'} height={120} />
      <div>
        <div className="text-title-2">{done ? 'Maestro is ready' : 'Setting up your team'}</div>
        <div className="text-fg-muted">{done ? 'Confirm the team and deadline, then open it.' : 'This takes about a minute.'}</div>
      </div>
      <ul className="flex w-full list-none flex-col gap-2 text-left">
        {steps.map((s, i) => {
          const complete = done; const active = !done && i <= tick;
          return (
            <li key={i} className="flex h-11 items-center gap-3 rounded-lg border border-line bg-canvas px-3.5">
              <span className={`size-2 shrink-0 rounded-full ${complete ? 'bg-ok' : active ? 'animate-pulse bg-maestro' : 'bg-line-strong'}`} aria-hidden="true" />
              <span className={`text-label font-normal ${complete || active ? 'text-fg' : 'text-fg-muted'}`}>{s}</span>
              <span className="ml-auto text-caption font-normal text-fg-muted">{complete ? 'Done' : active ? 'Working…' : ''}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
