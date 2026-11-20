import { useId, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { Check, FolderGit2, Plus } from 'lucide-react';
import { ApiError, api } from '../api/client.ts';
import { useApi } from '../hooks/useApi.ts';
import { formatResetAt, timeAgo } from '../dates.ts';
import Bulb, { LogoMark } from '../components/Bulb.tsx';
import { effectiveDeadline } from '../deadline.ts';
import { useTheme } from '../lib/prefs.ts';
import { Button, Skeleton, inputClass } from '../ui/primitives.tsx';

/** Same window the server reads. Stated here so the form can say it before the first request. */
const WINDOW = { commits: 30, pulls: 20, issues: 30 };

const STEP_TEXT = [
  `Reading the latest ${WINDOW.commits} commits and ${WINDOW.issues} issues`,
  'Labeling each change',
  'Matching work to issues',
  'Checking the plan against the deadline',
];

function calendarDay(value: string | null): string | null {
  if (!value) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return match ? match[1] : null;
}

const OWNER_RE = /^[A-Za-z0-9-]{1,39}$/;
const REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;

/** Accepts "owner/repo", "github.com/owner/repo" or a full URL (with or without .git). */
export function parseRepo(input: string): { owner: string; repo: string } | null {
  const cleaned = input.trim().replace(/^https?:\/\//i, '').replace(/^(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const m = /^([^/]+)\/([^/]+)$/.exec(cleaned);
  if (!m) return null;
  const owner = m[1];
  const repo = m[2];
  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo) || repo === '.' || repo === '..') return null;
  return { owner, repo };
}

type Phase = 'form' | 'connecting' | 'failed';

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
  const repoId = useId();
  const [repo, setRepo] = useState('');
  const [phase, setPhase] = useState<Phase>('form');
  const [error, setError] = useState<string | null>(null);
  const [teamId, setTeamId] = useState<number | null>(null);
  const [step, setStep] = useState(0);
  const [lines, setLines] = useState(STEP_TEXT);
  const parsed = parseRepo(repo);

  function finishStep(index: number, line: string) {
    setLines(current => current.map((item, i) => (i === index ? line : item)));
    setStep(index + 1);
  }

  async function connect(e: FormEvent) {
    e.preventDefault();
    if (!parsed) { setError('Enter the repository as owner/repo, or paste its GitHub URL.'); return; }
    setPhase('connecting');
    setError(null);
    setLines(STEP_TEXT);
    setStep(0);
    try {
      let id = teamId;
      if (!id) {
        const created = await api.createTeam({ name: parsed.repo, repo_owner: parsed.owner, repo_name: parsed.repo });
        id = created.id;
        setTeamId(id);
        // An existing team is opened as it is. Sync and the deadline stay on Settings and Sync now.
        if (created.reused) {
          navigate(`/t/${id}`);
          return;
        }
      }

      const ingested = await api.sync(id, 'ingest');
      const commits = ingested.newContributions;
      finishStep(0, `Read ${commits} commit${commits === 1 ? '' : 's'} in the latest ${ingested.window.commits}`);

      const labeled = await api.sync(id, 'classify');
      finishStep(1, `Labeled ${labeled.classified} change${labeled.classified === 1 ? '' : 's'}`);

      await api.sync(id, 'match');
      finishStep(2, ingested.notice ? 'No issues to match' : 'Matched work to issues');

      const [team, tasks] = await Promise.all([api.team(id), api.tasks(id)]);
      const day = calendarDay(effectiveDeadline(team.deadline, tasks.map(task => task.due_date)).date);
      if (!team.deadline && day) await api.setDeadline(id, day);

      const reasoned = await api.sync(id, 'reason');
      const risks = reasoned.risksDetected;
      finishStep(3, `Checked the plan · ${risks} risk${risks === 1 ? '' : 's'}`);

      navigate(`/t/${id}`, ingested.notice ? { state: { connectNotice: ingested.notice } } : undefined);
    } catch (err) {
      const localReset = err instanceof ApiError && err.resetAt ? formatResetAt(err.resetAt) : null;
      setError(localReset
        ? `GitHub is rate-limiting requests right now. Try again after ${localReset}.`
        : (err instanceof Error ? err.message : String(err)));
      setPhase('failed');
    }
  }

  const busy = phase === 'connecting';

  return (
    <div className="flex min-h-dvh flex-wrap">
      <main className="flex min-w-0 flex-[1_1_520px] justify-center px-6 py-14 md:px-8 lg:py-20">
        <div className="flex w-full max-w-[460px] flex-col gap-7">
          <div className="flex flex-col gap-4">
            <Bulb state={busy ? 'thinking' : 'default'} height={72} />
            <h1 className="text-[32px] leading-9 font-semibold tracking-[-0.03em] md:text-display">Meet Maestro</h1>
            <p className="text-brief text-pretty text-fg-muted">Maestro reads your team&rsquo;s GitHub repo and shows everyone the same picture of who is working on what.</p>
          </div>

          <form onSubmit={connect} className="flex flex-col gap-2" noValidate>
            <label htmlFor={repoId} className="text-label">Repository</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <FolderGit2 size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
                <input id={repoId} value={repo} onChange={e => { setRepo(e.target.value); setError(null); }} disabled={busy}
                  placeholder="owner/repo or a GitHub URL" autoComplete="off" spellCheck={false} aria-invalid={!!error} aria-describedby={error ? `${repoId}-err` : undefined}
                  className={`${inputClass} h-11 pl-9 text-[14px]`} />
              </div>
              <Button type="submit" size="lg" busy={busy} disabled={!repo.trim()}>{phase === 'failed' ? 'Try again' : 'Connect'}</Button>
            </div>
            <p className="text-caption font-normal text-fg-muted">Reads the latest {WINDOW.commits} commits, {WINDOW.pulls} pull requests, and {WINDOW.issues} issues, so this finishes in about a minute. People who committed are added as members. You can change the team and the deadline in Settings.</p>
            {error && <p id={`${repoId}-err`} className="text-caption font-normal text-risk-high" role="alert">{error}</p>}
            {phase === 'failed' && teamId && <button type="button" className="self-start text-label text-fg-muted underline underline-offset-[3px]" onClick={() => navigate(`/t/${teamId}`)}>Open the team anyway</button>}
          </form>

          <ul className="flex list-none flex-col gap-1.5 text-label font-normal text-fg-muted">
            {['Everyone sees the same view.', 'Only work artifacts, never activity tracking.', 'Every AI label can be disputed.'].map(x => (
              <li key={x} className="flex items-center gap-2"><Check size={14} className="text-ok" aria-hidden="true" />{x}</li>
            ))}
          </ul>

          <div className="flex flex-col items-center gap-3">
            {hasTeams && <Link to="/" className="text-label text-fg-muted hover:text-fg">Back to your teams</Link>}
          </div>
        </div>
      </main>

      <aside aria-label="Preview" className="hidden min-w-0 flex-[1_1_520px] items-center justify-center border-l border-line bg-surface-1 p-12 lg:flex">
        {busy ? <SyncSteps step={step} lines={lines} /> : <Preview name={parsed?.repo} />}
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

function SyncSteps({ step, lines }: { step: number; lines: string[] }) {
  return (
    <div role="status" aria-live="polite" className="flex w-full max-w-[380px] flex-col items-center gap-6 text-center">
      <Bulb state="thinking" height={120} />
      <div>
        <div className="text-title-2">Setting up your team</div>
        <div className="text-fg-muted">This takes about a minute. Then the team page opens.</div>
      </div>
      <ul className="flex w-full list-none flex-col gap-2 text-left">
        {lines.map((s, i) => {
          const complete = i < step;
          const active = i === step;
          return (
            <li key={STEP_TEXT[i]} className="flex h-11 items-center gap-3 rounded-lg border border-line bg-canvas px-3.5">
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
