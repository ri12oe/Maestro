import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { CircleCheck, CircleDashed, CircleDot, ExternalLink, GitCommitHorizontal, NotebookPen, Search } from 'lucide-react';
import { api } from '../api/client.ts';
import type { RiskLevel, Task } from '../api/types.ts';
import { useApi } from '../hooks/useApi.ts';
import { daysAgo, shortDate } from '../dates.ts';
import { firstName, longDate, sortedMembers, teamDeadline, useTeam } from '../app/team.tsx';
import { Sheet, useToast } from '../ui/overlays.tsx';
import {
  Avatar, Button, EmptyState, ErrorState, MaestroNote, Page, PageHeader, RiskBadge, Segmented, Skeleton, SubstanceDots, WorkTypeTag, buttonClass, inputClass, riskColor,
} from '../ui/primitives.tsx';

type Filter = 'all' | 'mine' | 'risk' | 'open' | 'done';
type Group = 'risk' | 'progress' | 'todo' | 'done';
const GROUPS: Array<{ key: Group; label: string }> = [
  { key: 'risk', label: 'At risk' }, { key: 'progress', label: 'In progress' }, { key: 'todo', label: 'Not started' }, { key: 'done', label: 'Done' },
];
const STALE_DAYS = 5;

export default function Plan() {
  const { teamId, base, team, tasks, risks, summary, loading, error, reload, me } = useTeam();
  const { issue } = useParams();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>('all');
  const [owner, setOwner] = useState('');
  const [query, setQuery] = useState('');
  const [showDone, setShowDone] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  const riskByTask = useMemo(() => {
    const m = new Map<number, RiskLevel>();
    for (const r of risks ?? []) if (r.task_id != null && !m.has(r.task_id)) m.set(r.task_id, r.level);
    return m;
  }, [risks]);
  const members = sortedMembers(summary?.members);
  const meLogin = members.find(m => m.memberId === me)?.login;

  const groupOf = (t: Task): Group => t.status === 'closed' ? 'done' : riskByTask.has(t.id) ? 'risk' : t.contribution_count > 0 ? 'progress' : 'todo';
  const q = query.trim().toLowerCase();
  const visible = (tasks ?? []).filter(t => {
    if (filter === 'mine' && (!meLogin || t.assignee_login !== meLogin)) return false;
    if (filter === 'risk' && groupOf(t) !== 'risk') return false;
    if (filter === 'open' && t.status !== 'open') return false;
    if (filter === 'done' && t.status !== 'closed') return false;
    if (owner && t.assignee_login !== owner) return false;
    if (q && !`#${t.github_issue_number ?? ''} ${t.title}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const ordered = [...visible].sort((a, b) => (a.due_date ?? '9999').localeCompare(b.due_date ?? '9999'));
  const selected = (tasks ?? []).find(t => String(t.github_issue_number) === issue) ?? null;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || e.metaKey || e.ctrlKey) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      if ((e.key === '[' || e.key === ']') && selected) {
        const list = ordered.filter(t => t.github_issue_number != null);
        const i = list.findIndex(t => t.id === selected.id);
        const next = list[i + (e.key === ']' ? 1 : -1)];
        if (next) navigate(`${base}/plan/${next.github_issue_number}`, { replace: true });
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ordered, selected, base, navigate]);

  if (error) return <Page><ErrorState message={error} onRetry={reload} /></Page>;
  const repoUrl = team ? `https://github.com/${team.repo_owner}/${team.repo_name}/issues` : undefined;
  const filtersOn = filter !== 'all' || owner || q;

  return (
    <Page>
      <PageHeader title="Plan" subtitle={tasks ? `${tasks.length} task${tasks.length === 1 ? '' : 's'} from GitHub Issues` : ' '}
        actions={repoUrl && !team?.is_demo && <a href={repoUrl} target="_blank" rel="noreferrer" className={buttonClass('ghost')}><ExternalLink size={14} aria-hidden="true" />Open in GitHub</a>} />

      <DeadlineStrip riskByTask={riskByTask} />

      <div className="flex flex-wrap items-center gap-2">
        <Segmented label="Filter tasks" value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All' }, ...(me ? [{ value: 'mine' as const, label: 'Mine' }] : []),
          { value: 'risk', label: 'At risk' }, { value: 'open', label: 'Open' }, { value: 'done', label: 'Done' },
        ]} />
        <label className="sr-only" htmlFor="owner-filter">Owner</label>
        <select id="owner-filter" value={owner} onChange={e => setOwner(e.target.value)} className={`${inputClass} h-8 w-auto pr-8 text-label`}>
          <option value="">Anyone</option>
          {members.filter(m => m.login).map(m => <option key={m.memberId} value={m.login}>{m.displayName}</option>)}
        </select>
        <div className="relative ml-auto w-full sm:w-60">
          <Search size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
          <input ref={searchRef} type="search" aria-label="Search tasks" placeholder="Search tasks" value={query} onChange={e => setQuery(e.target.value)} className={`${inputClass} h-8 pl-8`} />
        </div>
      </div>

      {loading && <div className="flex flex-col gap-2">{[0, 1, 2, 3, 4, 5].map(i => <Skeleton key={i} w="100%" h={40} />)}</div>}
      {!loading && (tasks?.length ?? 0) === 0 && (
        <div className="rounded-[10px] border border-line bg-surface-1">
          <EmptyState heading="No tasks yet" line="Maestro tracks GitHub Issues as tasks. Add some to the repo and sync.">
            {repoUrl && <a href={repoUrl} target="_blank" rel="noreferrer" className={buttonClass('secondary')}>Open Issues in GitHub</a>}
          </EmptyState>
        </div>
      )}
      {!loading && (tasks?.length ?? 0) > 0 && visible.length === 0 && (
        <div className="rounded-[10px] border border-line bg-surface-1">
          <EmptyState bulb="none" heading="No tasks match" line="Try another filter.">
            {filtersOn && <Button onClick={() => { setFilter('all'); setOwner(''); setQuery(''); }}>Clear filters</Button>}
          </EmptyState>
        </div>
      )}

      {!loading && visible.length > 0 && (
        <div className="overflow-x-auto rounded-[10px] border border-line bg-surface-1">
          <table className="w-full min-w-[720px] border-collapse text-label font-normal">
            <thead>
              <tr className="h-9 text-left text-fg-muted">
                <th scope="col" className="w-9 pl-4"><span className="sr-only">Status</span></th>
                <th scope="col" className="w-14 px-2 font-medium">#</th>
                <th scope="col" className="px-2 font-medium">Task</th>
                <th scope="col" className="w-32 px-2 font-medium">Owner</th>
                <th scope="col" className="w-28 px-2 font-medium">Last activity</th>
                <th scope="col" className="w-16 px-2 text-right font-medium">Work</th>
                <th scope="col" className="w-24 pr-4 pl-2 font-medium">Due</th>
              </tr>
            </thead>
            {GROUPS.map(g => {
              const rows = ordered.filter(t => groupOf(t) === g.key);
              if (!rows.length) return null;
              const collapsed = g.key === 'done' && !showDone && filter !== 'done';
              return (
                <tbody key={g.key}>
                  <tr>
                    <th colSpan={7} scope="colgroup" className="h-8 border-y border-line bg-canvas px-4 text-left text-caption tracking-[0.06em] text-fg-muted uppercase">
                      {g.key === 'done' && filter !== 'done'
                        ? <button type="button" aria-expanded={!collapsed} onClick={() => setShowDone(v => !v)} className="uppercase hover:text-fg">{g.label} {rows.length} · {collapsed ? 'show' : 'hide'}</button>
                        : <>{g.label} <span className="ml-1.5">{rows.length}</span></>}
                    </th>
                  </tr>
                  {!collapsed && rows.map(t => <TaskRow key={t.id} t={t} group={g.key} level={riskByTask.get(t.id)} selected={selected?.id === t.id} />)}
                </tbody>
              );
            })}
          </table>
        </div>
      )}

      <TaskPanel task={selected} level={selected ? riskByTask.get(selected.id) : undefined} onClose={() => navigate(`${base}/plan`, { replace: true })} teamId={teamId} />
    </Page>
  );
}

function TaskRow({ t, group, level, selected }: { t: Task; group: Group; level?: RiskLevel; selected: boolean }) {
  const { base, summary } = useTeam();
  const navigate = useNavigate();
  const member = summary?.members.find(m => m.login && m.login === t.assignee_login);
  const ownerName = member?.displayName ?? t.assignee_name ?? t.assignee_login;
  const stale = t.status === 'open' && t.last_activity_at && (Date.now() - new Date(t.last_activity_at).getTime()) / 86_400_000 > STALE_DAYS;
  const overdue = t.status === 'open' && t.due_date && t.due_date < new Date().toISOString().slice(0, 10);
  const href = t.github_issue_number != null ? `${base}/plan/${t.github_issue_number}` : undefined;
  const Icon = group === 'done' ? CircleCheck : group === 'todo' ? CircleDashed : CircleDot;
  return (
    <tr onClick={() => href && navigate(href)} className={`h-12 cursor-pointer border-t border-line hover:bg-surface-2 ${selected ? 'bg-surface-3' : ''}`}>
      <td className="pl-4"><Icon size={16} aria-hidden="true" style={{ color: group === 'done' ? 'var(--ok)' : level ? riskColor(level) : 'var(--fg-muted)' }} /></td>
      <td className="px-2 font-mono text-code text-fg-muted">{t.github_issue_number != null ? `#${t.github_issue_number}` : '—'}</td>
      <td className="px-2">
        <span className="inline-flex flex-wrap items-center gap-2">
          {href ? <Link to={href} onClick={e => e.stopPropagation()} className="font-medium text-fg hover:underline hover:underline-offset-[3px]">{t.title}</Link> : <span className="font-medium">{t.title}</span>}
          {level && <RiskBadge level={level} />}
        </span>
      </td>
      <td className="px-2">{ownerName ? <span className="inline-flex items-center gap-2"><Avatar name={ownerName} login={t.assignee_login} size={20} />{firstName(ownerName)}</span> : <span className="text-fg-subtle">Unassigned</span>}</td>
      <td className={`px-2 ${stale ? 'text-risk-med' : 'text-fg-muted'}`}>{t.last_activity_at ? daysAgo(t.last_activity_at) : '—'}</td>
      <td className="px-2 text-right text-fg-muted">{t.contribution_count}</td>
      <td className={`pr-4 pl-2 font-mono text-code ${overdue ? 'text-risk-high' : 'text-fg-muted'}`}>{t.due_date ? shortDate(t.due_date) : '—'}</td>
    </tr>
  );
}

function DeadlineStrip({ riskByTask }: { riskByTask: Map<number, RiskLevel> }) {
  const { teamId, team, tasks, version } = useTeam();
  const contribs = useApi(() => api.contributions(teamId), [teamId, version]);
  const deadline = teamDeadline(team, tasks);
  const first = (contribs.data ?? []).reduce<string | null>((min, c) => (!min || c.authored_at < min ? c.authored_at : min), null) ?? team?.created_at ?? null;
  if (!deadline.date || !first) return null;
  const start = new Date(first).getTime();
  const end = new Date(`${deadline.date}T23:59:59`).getTime();
  if (end <= start) return null;
  const pos = (ms: number) => `${Math.min(100, Math.max(0, ((ms - start) / (end - start)) * 100))}%`;
  const now = Date.now();
  const marks = (tasks ?? []).filter(t => t.due_date && t.status === 'open');
  return (
    <section aria-label="Schedule" className="rounded-[10px] border border-line bg-surface-1 px-5 pt-4 pb-3.5">
      <div className="flex justify-between text-caption font-normal text-fg-muted">
        <span>First work · {shortDate(first)}</span>
        <span className="font-medium text-fg">Deadline · {longDate(deadline.date)}</span>
      </div>
      <div className="relative mt-2 h-10">
        <div className="absolute inset-x-0 top-[19px] h-0.5 rounded bg-surface-3" />
        <div className="absolute top-[19px] left-0 h-0.5 rounded bg-fg-muted" style={{ width: pos(now) }} />
        {marks.map(t => {
          const lvl = riskByTask.get(t.id);
          return <span key={t.id} title={`#${t.github_issue_number ?? ''} ${t.title} · ${shortDate(t.due_date!)}`}
            className="absolute top-[15px] -ml-[5px] size-2.5 rotate-45 rounded-[2px] shadow-[0_0_0_2px_var(--surface-1)]"
            style={{ left: pos(new Date(`${t.due_date}T12:00:00`).getTime()), background: lvl ? riskColor(lvl) : 'var(--fg-muted)' }} />;
        })}
        <div className="absolute top-1 bottom-1 -ml-px w-0.5 rounded bg-fg" style={{ left: pos(now) }} />
        <span className="absolute -top-0.5 translate-x-1.5 text-[11.5px] font-semibold" style={{ left: pos(now) }}>Today</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-4 text-caption font-normal text-fg-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rotate-45 bg-risk-high" />High risk</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rotate-45 bg-risk-med" />Medium risk</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rotate-45 bg-fg-muted" />On track</span>
      </div>
    </section>
  );
}

function TaskPanel({ task, level, onClose, teamId }: { task: Task | null; level?: RiskLevel; onClose: () => void; teamId: number }) {
  const { team, risks, suggestions, summary, reload, version } = useTeam();
  const toast = useToast();
  const contribs = useApi(() => (task ? api.contributions(teamId, { taskId: task.id }) : Promise.resolve([])), [teamId, task?.id, version]);
  const [busy, setBusy] = useState(false);
  const risk = task ? risks?.find(r => r.task_id === task.id) : undefined;
  const sug = task ? suggestions?.find(s => s.task_id === task.id && s.status === 'pending') : undefined;
  const ownerName = task ? (summary?.members.find(m => m.login && m.login === task.assignee_login)?.displayName ?? task.assignee_name ?? task.assignee_login) : null;

  const statusLabel = !task ? '' : task.status === 'closed' ? 'Done' : level ? `In progress · ${level} risk` : task.contribution_count ? 'In progress' : 'Not started';
  const note = risk ? risk.description.replace(/^#\d+\s[^:]+:\s*/, '')
    : task?.status === 'closed' ? 'Done. Closed on GitHub.'
    : task?.contribution_count ? 'On track. Recent work is matched to this task, and nothing about its schedule worries Maestro.'
    : 'Not started yet. Maestro will flag it if the due date gets close without any work.';

  return (
    <Sheet open={!!task} onClose={onClose} label={task ? `Task #${task.github_issue_number}: ${task.title}` : 'Task'}
      header={task && (
        <div>
          <div className="font-mono text-code text-fg-muted">#{task.github_issue_number}</div>
          <h2 className="mt-0.5 text-title-2">{task.title}</h2>
        </div>
      )}>
      {task && (
        <div className="flex flex-col gap-5">
          <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-y-2.5 text-label font-normal">
            <dt className="text-fg-muted">Owner</dt><dd>{ownerName ?? 'Unassigned'}</dd>
            <dt className="text-fg-muted">Due</dt><dd>{task.due_date ? longDate(task.due_date) : 'No due date'}</dd>
            <dt className="text-fg-muted">Status</dt><dd className="first-letter:uppercase">{statusLabel}</dd>
            <dt className="text-fg-muted">Work</dt><dd>{task.contribution_count} contribution{task.contribution_count === 1 ? '' : 's'}</dd>
            {team && !team.is_demo && (<><dt className="text-fg-muted">GitHub</dt><dd><a className="inline-flex items-center gap-1 underline underline-offset-[3px]" target="_blank" rel="noreferrer" href={`https://github.com/${team.repo_owner}/${team.repo_name}/issues/${task.github_issue_number}`}>Open issue <ExternalLink size={12} aria-hidden="true" /></a></dd></>)}
          </dl>

          <MaestroNote compact at={risk?.generated_at}>{note}</MaestroNote>

          {sug && (
            <div className="flex flex-col gap-2.5 rounded-lg bg-surface-2 p-3">
              <div className="font-medium">Suggested: move to {firstName(sug.to_name, sug.to_login)}</div>
              <div className="text-label font-normal text-fg-muted">{firstName(sug.from_name, sug.from_login)} has {sug.from_open_tasks} open tasks; {firstName(sug.to_name, sug.to_login)} has {sug.to_open_tasks}.</div>
              <div className="flex gap-2">
                <Button variant="primary" size="sm" busy={busy} onClick={async () => {
                  setBusy(true);
                  try {
                    await api.respond(teamId, sug.id, 'accepted');
                    toast.show(`Swap accepted. ${firstName(sug.to_name, sug.to_login)} owns #${sug.task_number}.`, { label: 'Undo', run: () => { void api.respond(teamId, sug.id, 'pending').then(reload); } });
                    reload();
                  } finally { setBusy(false); }
                }}>Accept swap</Button>
                {sug.checkin_message && <Button size="sm" onClick={() => void navigator.clipboard.writeText(sug.checkin_message!).then(() => toast.show('Check-in message copied.'))}>Copy check-in</Button>}
              </div>
            </div>
          )}

          <section className="flex flex-col">
            <h3 className="mb-1.5 text-label">Work on this task</h3>
            {contribs.loading && !contribs.data && <Skeleton w="100%" h={40} />}
            {contribs.data?.length === 0 && <p className="text-fg-muted">No work matched to this task yet.</p>}
            <ul className="list-none">
              {(contribs.data ?? []).map(c => {
                const who = summary?.members.find(m => m.memberId === c.member_id)?.displayName ?? 'Someone';
                const Icon = c.source === 'manual' ? NotebookPen : GitCommitHorizontal;
                return (
                  <li key={c.id} className="grid grid-cols-[20px_minmax(0,1fr)_auto] gap-2.5 border-b border-line py-2.5">
                    <Avatar name={who} size={20} />
                    <div className="min-w-0">
                      <div className="text-label font-normal">{c.summary ?? c.title}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <WorkTypeTag type={c.work_type} /><SubstanceDots value={c.substance} />
                        <span className="inline-flex items-center gap-1 font-mono text-[11.5px] text-fg-muted"><Icon size={12} aria-hidden="true" />{c.github_sha ? c.github_sha.slice(0, 7) : 'logged'}</span>
                      </div>
                    </div>
                    <span className="text-caption font-normal text-fg-muted">{shortDate(c.authored_at)}</span>
                  </li>
                );
              })}
            </ul>
          </section>
          <p className="text-caption font-normal text-fg-muted">Press <kbd className="font-mono">[</kbd> or <kbd className="font-mono">]</kbd> for the previous or next task.</p>
        </div>
      )}
    </Sheet>
  );
}
