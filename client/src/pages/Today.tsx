import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ArrowRight, CalendarClock, Check, ChevronRight, CircleDot, Copy, GitCommitHorizontal, NotebookPen } from 'lucide-react';
import { api } from '../api/client.ts';
import type { Contribution, Risk, Suggestion, Task } from '../api/types.ts';
import { useApi } from '../hooks/useApi.ts';
import { shortDate } from '../dates.ts';
import { WORK_CATEGORIES } from '../workTypes.ts';
import { buildDecisions, type Decision } from '../app/decisions.ts';
import { daysUntil, firstName, longDate, sortedMembers, teamDeadline, useTeam } from '../app/team.tsx';
import { useToast } from '../ui/overlays.tsx';
import { DigestCard, PlanCheckCard } from '../app/AiCards.tsx';
import { LogoMark } from '../components/Bulb.tsx';
import {
  Avatar, Badge, Button, Card, ContributionBar, EmptyState, ErrorState, MaestroNote, Page, PageHeader, RiskBadge, Segmented, Skeleton, riskColor,
} from '../ui/primitives.tsx';

type Filter = 'all' | 'high' | 'swaps';
interface Resolved {
  key: string;
  text: string;
  at: number;
  /** Accepted swap. Stored with the row so Undo can call the respond route after reload. */
  suggestionId?: number;
  /** Decision hidden when this row was resolved, so Undo can show that card again. */
  decisionKey?: string;
}

const RESOLVED_KEY = (teamId: number) => `maestro.resolved.${teamId}`;

function loadResolved(teamId: number): Resolved[] {
  try {
    const all = JSON.parse(localStorage.getItem(RESOLVED_KEY(teamId)) ?? '[]') as Resolved[];
    return all.filter(r => Date.now() - r.at < 7 * 86_400_000).map(r => ({
      key: r.key,
      text: r.text,
      at: r.at,
      suggestionId: typeof r.suggestionId === 'number' ? r.suggestionId : undefined,
      decisionKey: typeof r.decisionKey === 'string' ? r.decisionKey : undefined,
    }));
  } catch { return []; }
}

export default function Today() {
  const { teamId, base, team, summary, tasks, risks, suggestions, loading, error, reload, me, openAsk } = useTeam();
  const toast = useToast();
  const [filter, setFilter] = useState<Filter>('all');
  const [resolvedOpen, setResolvedOpen] = useState(false);
  const [resolved, setResolved] = useState<Resolved[]>(() => loadResolved(teamId));
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [undoingKey, setUndoingKey] = useState<string | null>(null);
  const undoingIds = useRef(new Set<number>());

  useEffect(() => {
    try {
      localStorage.setItem(RESOLVED_KEY(teamId), JSON.stringify(resolved.map(r => ({
        key: r.key, text: r.text, at: r.at, suggestionId: r.suggestionId, decisionKey: r.decisionKey,
      }))));
    } catch { /* ignore */ }
  }, [resolved, teamId]);

  const decisions = useMemo(() => buildDecisions(risks, suggestions).filter(d => !hidden.has(d.key)), [risks, suggestions, hidden]);
  const shown = decisions.filter(d => filter === 'all' || (filter === 'high' ? d.risk?.level === 'high' : !!d.suggestion));
  const deadline = teamDeadline(team, tasks);
  const people = sortedMembers(summary?.members);

  async function undoResolved(item: Resolved) {
    const suggestionId = item.suggestionId;
    if (typeof suggestionId !== 'number' || undoingIds.current.has(suggestionId)) return;
    undoingIds.current.add(suggestionId);
    setUndoingKey(item.key);
    try {
      await api.respond(teamId, suggestionId, 'pending');
      setResolved(list => list.filter(x => x.key !== item.key));
      const decisionKey = item.decisionKey;
      if (decisionKey) {
        setHidden(h => {
          const next = new Set(h);
          next.delete(decisionKey);
          return next;
        });
      }
      reload();
    } catch (e) {
      toast.show(e instanceof Error ? e.message : String(e));
    } finally {
      undoingIds.current.delete(suggestionId);
      setUndoingKey(key => (key === item.key ? null : key));
    }
  }

  function resolve(d: Decision, text: string, suggestionId?: number) {
    setHidden(h => new Set(h).add(d.key));
    const item: Resolved = { key: `${d.key}-${Date.now()}`, text, at: Date.now(), suggestionId, decisionKey: d.key };
    setResolved(r => [item, ...r]);
    if (typeof suggestionId === 'number') setResolvedOpen(true);
    toast.show(text, typeof suggestionId === 'number' ? { label: 'Undo', run: () => { void undoResolved(item); } } : undefined);
    window.setTimeout(reload, 400);
  }

  if (error) return <Page><ErrorState message={error} onRetry={reload} /></Page>;

  const meName = people.find(p => p.memberId === me)?.displayName;
  return (
    <Page>
      <PageHeader
        title="Today"
        badge={team?.is_demo ? <Badge>Demo data</Badge> : undefined}
        subtitle={new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}
        actions={<>
          {deadline.date && (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-line px-2.5 text-caption">
              <CalendarClock size={14} aria-hidden="true" />Due {longDate(deadline.date)} · {daysUntil(deadline.date)} days
            </span>
          )}
          <Button size="sm" onClick={() => openAsk()}><LogoMark size={16} />Ask Maestro</Button>
        </>}
      />

      <div className="flex flex-wrap items-start gap-8">
        <div className="flex min-w-0 flex-[999_1_480px] flex-col gap-8">
          {loading ? <BriefSkeleton /> : <Brief decisions={decisions} />}

          {!loading && <PlanCheckCard />}

          <section aria-labelledby="queue-h" className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <h2 id="queue-h" className="text-title-3">Needs the team</h2>
                <Badge aria-live="polite">{decisions.length}</Badge>
              </div>
              {decisions.length > 1 && (
                <Segmented label="Filter decisions" value={filter} onChange={setFilter}
                  options={[{ value: 'all', label: 'All' }, { value: 'high', label: 'High' }, { value: 'swaps', label: 'Swaps' }]} />
              )}
            </div>

            {loading && [0, 1].map(i => <div key={i} className="h-[132px] animate-pulse rounded-[10px] border border-line bg-surface-1" />)}
            {!loading && decisions.length === 0 && (
              <div className="rounded-[10px] border border-line bg-surface-1">
                <EmptyState bulb="happy" heading="Nothing needs the team"
                  line={team?.last_synced_at || team?.is_demo ? 'If anything slips, you’ll see it here first.' : 'Maestro hasn’t read the repo yet. It will after the first sync.'} />
              </div>
            )}
            {!loading && decisions.length > 0 && shown.length === 0 && (
              <p className="rounded-[10px] border border-line px-4 py-6 text-center text-fg-muted">No decisions match this filter.</p>
            )}
            <ul className="flex list-none flex-col gap-3">
              {shown.map(d => (
                <li key={d.key}>
                  <DecisionCard d={d} meName={meName}
                    onAccept={async s => {
                      await api.respond(teamId, s.id, 'accepted');
                      resolve(d, `Swap accepted. #${s.task_number} moves from ${firstName(s.from_name, s.from_login)} to ${firstName(s.to_name, s.to_login)}.`, s.id);
                    }}
                    onNotAProblem={async () => {
                      if (d.risk) await api.dismissRisk(teamId, d.risk.id);
                      if (d.suggestion) await api.respond(teamId, d.suggestion.id, 'dismissed');
                      const label = d.risk?.task_number != null ? `#${d.risk.task_number} ${d.risk.task_title}` : d.suggestion ? `#${d.suggestion.task_number} ${d.suggestion.task_title}` : 'This item';
                      resolve(d, `${meName ? firstName(meName) : 'Someone'} marked ${label} as not a problem.`);
                    }}
                  />
                </li>
              ))}
            </ul>

            {resolved.length > 0 && (
              <div className="flex flex-col gap-2">
                <button type="button" aria-expanded={resolvedOpen} onClick={() => setResolvedOpen(o => !o)}
                  className="-ml-2 inline-flex h-8 items-center gap-1.5 self-start rounded-md px-2 text-label text-fg-muted hover:bg-surface-2 hover:text-fg">
                  <ChevronRight size={14} className={`transition-transform duration-200 ${resolvedOpen ? 'rotate-90' : ''}`} aria-hidden="true" />
                  {resolved.length} resolved this week
                </button>
                {resolvedOpen && (
                  <ul className="list-none divide-y divide-line rounded-[10px] border border-line bg-surface-1">
                    {resolved.map(r => (
                      <li key={r.key} className="flex items-center gap-2.5 px-4 py-2.5 text-label font-normal">
                        <Check size={14} className="shrink-0 text-ok" aria-hidden="true" />
                        <span className="min-w-0 flex-1">{r.text}</span>
                        {typeof r.suggestionId === 'number' && (
                          <button
                            type="button"
                            className="shrink-0 font-semibold underline underline-offset-[3px] hover:text-fg disabled:opacity-50"
                            disabled={undoingKey === r.key}
                            aria-busy={undoingKey === r.key || undefined}
                            onClick={() => { void undoResolved(r); }}
                          >
                            Undo
                          </button>
                        )}
                        <span className="shrink-0 text-fg-muted">{new Date(r.at).toLocaleDateString(undefined, { weekday: 'short' })}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </section>

          {!loading && <DigestCard />}
        </div>

        <aside className="flex w-full min-w-0 flex-[1_1_300px] flex-col gap-4 xl:sticky xl:top-8 xl:max-w-[320px]">
          <Card title="Team" action={<span className="text-caption font-normal text-fg-muted">Open tasks</span>} bodyClassName="px-3 pb-2">
            {loading && <div className="flex flex-col gap-3 px-2 pb-3">{[0, 1, 2, 3].map(i => <Skeleton key={i} w="100%" h={20} />)}</div>}
            {!loading && people.length === 0 && <p className="px-2 pb-3 text-fg-muted">No one yet. Sync the repo or add people in Settings.</p>}
            <ul className="list-none">
              {people.map(m => {
                const max = Math.max(1, ...people.map(p => p.totalWeight));
                return (
                  <li key={m.memberId}>
                    <Link to={`${base}/people/${m.memberId}`} className="grid h-10 grid-cols-[24px_64px_minmax(0,1fr)_24px] items-center gap-2.5 rounded-md px-2 hover:bg-surface-2">
                      <Avatar name={m.displayName} login={m.login} />
                      <span className="truncate text-label font-normal">{firstName(m.displayName)}</span>
                      <ContributionBar shares={m.substanceShares} length={m.totalWeight / max} height={6} label={`${m.displayName}: ${m.contributionCount} items`} />
                      <span className="text-right text-label font-normal text-fg-muted">{m.openTasks}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="-mx-3 mt-1 border-t border-line px-5 py-2.5">
              <Link to={`${base}/people`} className="inline-flex items-center gap-1.5 text-label text-fg-muted hover:text-fg">Open People <ArrowRight size={14} aria-hidden="true" /></Link>
            </div>
          </Card>

          <ThisWeek />

          <DueSoon />
        </aside>
      </div>
    </Page>
  );
}

/* ── Brief ─────────────────────────────────────────────────────────────── */

function Brief({ decisions }: { decisions: Decision[] }) {
  const { summary, tasks, team, risks, base } = useTeam();
  const done = (tasks ?? []).filter(t => t.status === 'closed').length;
  const total = tasks?.length ?? 0;
  const atRisk = new Set((risks ?? []).map(r => r.task_id).filter(Boolean)).size;
  const inProgress = Math.max(0, total - done - atRisk);
  const deadline = teamDeadline(team, tasks);
  const top = decisions[0];

  let lead: string; let body = '';
  if (decisions.length === 0) {
    lead = 'Nothing needs the team right now.';
    body = total ? `${done} of ${total} tasks are done${deadline.date ? `, and the deadline is ${daysUntil(deadline.date)} days away` : ''}.` : 'Add GitHub Issues to the repo and Maestro will track them as tasks.';
  } else {
    lead = `${decisions.length} thing${decisions.length === 1 ? ' needs' : 's need'} the team.`;
    const r = top.risk;
    if (r) body = r.task_number != null && !r.description.includes(`#${r.task_number}`) ? `#${r.task_number} ${r.task_title}: ${r.description}` : r.description;
    else if (top.suggestion) body = `Maestro suggests moving #${top.suggestion.task_number} ${top.suggestion.task_title} from ${firstName(top.suggestion.from_name, top.suggestion.from_login)} to ${firstName(top.suggestion.to_name, top.suggestion.to_login)}.`;
    const busiest = [...(summary?.members ?? [])].sort((a, b) => b.openTasks - a.openTasks);
    if (busiest.length > 1 && busiest[0].openTasks - busiest[busiest.length - 1].openTasks >= 3) {
      const lo = busiest[busiest.length - 1];
      body += ` ${firstName(busiest[0].displayName)} has ${busiest[0].openTasks} open tasks; ${firstName(lo.displayName)} has ${lo.openTasks}.`;
    }
  }

  const pct = (n: number) => `${total ? (n / total) * 100 : 0}%`;
  return (
    <MaestroNote at={team?.last_synced_at} why={<Link to={`${base}/maestro`} className="text-caption text-fg-muted hover:text-fg">Why?</Link>}>
      <p className="text-pretty"><strong className="font-semibold">{lead}</strong> {body}</p>
      {total > 0 && (
        <div className="mt-3.5 flex flex-col gap-2">
          <div role="img" aria-label={`${done} of ${total} tasks done, ${inProgress} in progress, ${atRisk} at risk`} className="flex h-1.5 gap-0.5 overflow-hidden rounded-full bg-surface-3">
            <span className="bg-ok" style={{ width: pct(done) }} />
            <span className="bg-fg-muted/55" style={{ width: pct(inProgress) }} />
            <span className="bg-risk-med" style={{ width: pct(atRisk) }} />
          </div>
          <div className="flex flex-wrap gap-4 text-caption font-normal text-fg-muted">
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-ok" />{done} done</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-fg-muted/55" />{inProgress} in progress</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-risk-med" />{atRisk} at risk</span>
          </div>
        </div>
      )}
    </MaestroNote>
  );
}

function BriefSkeleton() {
  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-maestro-line bg-maestro-wash p-5" aria-busy="true">
      <span className="sr-only" role="status">Loading the brief…</span>
      <Skeleton w={120} /><Skeleton w="90%" h={16} /><Skeleton w="70%" h={16} /><Skeleton w="100%" h={6} />
    </div>
  );
}

/* ── Decision card ─────────────────────────────────────────────────────── */

function DecisionCard({ d, onAccept, onNotAProblem }: {
  d: Decision; onAccept: (s: Suggestion) => Promise<void>; onNotAProblem: () => Promise<void>; meName?: string;
}) {
  const { teamId, base, tasks } = useTeam();
  const [busy, setBusy] = useState<'accept' | 'dismiss' | null>(null);
  const [copied, setCopied] = useState(false);
  const [why, setWhy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLElement>(null);
  const r: Risk | null = d.risk;
  const s: Suggestion | null = d.suggestion;
  const taskNumber = r?.task_number ?? s?.task_number;
  const taskTitle = r?.task_title ?? s?.task_title;
  const due = r?.task_due_date ?? s?.task_due_date;
  const level = r?.level ?? 'low';
  const task = tasks?.find(t => t.id === (r?.task_id ?? s?.task_id));
  const evidenceIds = (r?.evidence ?? []).filter(e => e.type === 'contribution').map(e => e.id);
  const contribs = useApi<Contribution[]>(
    () => {
      if (evidenceIds.length === 0) return Promise.resolve([]);
      // Task risks stay scoped to that task. A risk with no task can still cite
      // commits, such as a directory only one person has changed.
      return task ? api.contributions(teamId, { taskId: task.id }) : api.contributions(teamId);
    },
    [teamId, task?.id, evidenceIds.join(',')],
  );
  const chips = (contribs.data ?? []).filter(c => evidenceIds.includes(c.id));
  // Next to its commits, a task risk already links that task. Other task evidence
  // (an overload has no task of its own) still needs a #issue chip.
  const coveredTaskId = chips.length > 0 ? task?.id : undefined;
  const evidenceTasks = (r?.evidence ?? [])
    .filter(e => e.type === 'task' && e.id !== coveredTaskId)
    .map(e => (tasks ?? []).find(t => t.id === e.id))
    .filter((t): t is Task => t != null);

  async function act(kind: 'accept' | 'dismiss') {
    setBusy(kind); setErr(null);
    try { if (kind === 'accept' && s) await onAccept(s); else await onNotAProblem(); }
    catch (e) { setErr(e instanceof Error ? e.message : String(e)); setBusy(null); }
  }
  async function copy() {
    if (!s?.checkin_message) return;
    try { await navigator.clipboard.writeText(s.checkin_message); setCopied(true); window.setTimeout(() => setCopied(false), 1500); }
    catch { setErr('Couldn’t copy. Select the message and copy it yourself.'); setWhy(true); }
  }

  return (
    <article ref={ref} tabIndex={-1}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        const k = e.key.toLowerCase();
        if (k === 'a' && s) { e.preventDefault(); void act('accept'); }
        if (k === 'x') { e.preventDefault(); void act('dismiss'); }
        if (k === 'c' && s) { e.preventDefault(); void copy(); }
        if (k === 'j' || k === 'k') {
          e.preventDefault();
          const li = ref.current?.parentElement;
          const next = (k === 'j' ? li?.nextElementSibling : li?.previousElementSibling)?.querySelector<HTMLElement>('article');
          next?.focus();
        }
      }}
      className="relative flex animate-pop-in flex-col gap-3 overflow-hidden rounded-[10px] border border-line bg-surface-1 py-4 pr-5 pl-[23px] focus-visible:outline-offset-0">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: r ? riskColor(level) : 'var(--line-strong)' }} />
      <div className="flex flex-wrap items-center gap-2.5">
        {r ? <RiskBadge level={level} /> : <Badge tone="maestro">Suggestion</Badge>}
        {taskNumber != null && (
          <Link to={`${base}/plan/${taskNumber}`} className="flex items-baseline gap-1.5 font-semibold hover:underline hover:underline-offset-[3px]">
            <span className="font-mono text-code font-normal text-fg-muted">#{taskNumber}</span>{taskTitle}
          </Link>
        )}
        {due && <span className="ml-auto text-caption font-normal text-fg-muted">Due {longDate(due)}</span>}
      </div>

      {r && <p className="text-pretty">{r.description.replace(/^#\d+\s[^:]+:\s*/, '')}</p>}

      {(chips.length > 0 || evidenceTasks.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {chips.slice(0, 3).map(c => {
            const Icon = c.source === 'manual' ? NotebookPen : GitCommitHorizontal;
            const href = c.url ?? c.link ?? undefined;
            const label = `${c.github_sha ? c.github_sha.slice(0, 7) : shortDate(c.authored_at)} · ${(c.summary ?? c.title).slice(0, 32)}`;
            const cls = 'inline-flex h-6 max-w-full items-center gap-1.5 overflow-hidden rounded-full bg-surface-2 px-2 font-mono text-[11.5px] whitespace-nowrap text-fg-muted hover:text-fg';
            return href
              ? <a key={c.id} href={href} target="_blank" rel="noreferrer" className={cls} title={c.title}><Icon size={12} className="shrink-0" aria-hidden="true" /><span className="truncate">{label}</span></a>
              : <span key={c.id} className={cls} title={c.title}><Icon size={12} className="shrink-0" aria-hidden="true" /><span className="truncate">{label}</span></span>;
          })}
          {chips.length > 3 && <span className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2 text-[11.5px] text-fg-muted">+{chips.length - 3} more</span>}
          {chips.length > 0 && task && <Link to={`${base}/plan/${taskNumber}`} className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-2 px-2 font-mono text-[11.5px] text-fg-muted hover:text-fg"><CircleDot size={12} aria-hidden="true" />#{taskNumber}</Link>}
          {evidenceTasks.map(t => {
            const n = t.github_issue_number;
            return (
              <Link key={t.id} to={n != null ? `${base}/plan/${n}` : `${base}/plan`} title={t.title} className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-2 px-2 font-mono text-[11.5px] text-fg-muted hover:text-fg">
                <CircleDot size={12} aria-hidden="true" />{n != null ? `#${n}` : t.title.slice(0, 32)}
              </Link>
            );
          })}
        </div>
      )}

      {s && (
        <div className="flex flex-col gap-2 rounded-md bg-surface-2 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5" aria-hidden="true">
              <Avatar name={s.from_name ?? s.from_login} login={s.from_login} />
              <ArrowRight size={14} className="text-fg-muted" />
              <Avatar name={s.to_name ?? s.to_login} login={s.to_login} />
            </span>
            <div className="min-w-0 flex-[1_1_220px]">
              <div className="font-medium">Suggested: move #{s.task_number} from {firstName(s.from_name, s.from_login)} to {firstName(s.to_name, s.to_login)}</div>
              <div className="text-label font-normal text-fg-muted">{firstName(s.from_name, s.from_login)} has {s.from_open_tasks} open; {firstName(s.to_name, s.to_login)} has {s.to_open_tasks}.</div>
            </div>
            {(s.rationale.length > 0 || s.checkin_message) && (
              <button type="button" aria-expanded={why} onClick={() => setWhy(w => !w)} className="text-label text-fg-muted hover:text-fg">{why ? 'Less' : 'Why and message'}</button>
            )}
          </div>
          {why && (
            <div className="flex flex-col gap-3 border-t border-line pt-3 text-label font-normal">
              {s.rationale.length > 0 && <ul className="ml-4 list-disc text-fg-muted">{s.rationale.map((x, i) => <li key={i}>{x}</li>)}</ul>}
              {s.checkin_message && <blockquote className="rounded-md border border-line bg-surface-1 p-3 text-body select-text">{s.checkin_message}</blockquote>}
            </div>
          )}
        </div>
      )}

      {err && <p className="text-label font-normal text-risk-high" role="alert">{err}</p>}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" onClick={() => void act('dismiss')} busy={busy === 'dismiss'} disabled={!!busy}>Not a problem</Button>
        {s?.checkin_message && (
          <Button onClick={() => void copy()}>{copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? 'Copied' : 'Copy check-in'}</Button>
        )}
        {s && <Button variant="primary" onClick={() => void act('accept')} busy={busy === 'accept'} disabled={!!busy}>Accept swap</Button>}
      </div>
    </article>
  );
}

/* ── Side cards ────────────────────────────────────────────────────────── */

function ThisWeek() {
  const { teamId, version } = useTeam();
  const contribs = useApi(() => api.contributions(teamId), [teamId, version]);
  const days = useMemo(() => {
    const out: Array<{ date: Date; label: string; counts: number[]; total: number }> = [];
    const today = new Date(); today.setHours(0, 0, 0, 0);
    for (let i = 6; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      out.push({ date: d, label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), counts: WORK_CATEGORIES.map(() => 0), total: 0 });
    }
    let manual = 0;
    for (const c of contribs.data ?? []) {
      const t = new Date(c.authored_at); t.setHours(0, 0, 0, 0);
      const day = out.find(x => x.date.getTime() === t.getTime());
      if (!day) continue;
      const idx = Math.max(0, WORK_CATEGORIES.findIndex(cat => c.work_type && cat.types.includes(c.work_type)));
      const catIdx = c.work_type ? idx : WORK_CATEGORIES.length - 1;
      day.counts[catIdx]++; day.total++;
      if (c.source === 'manual') manual++;
    }
    return { out, manual };
  }, [contribs.data]);
  const max = Math.max(1, ...days.out.map(d => d.total));
  const total = days.out.reduce((a, d) => a + d.total, 0);

  return (
    <Card title="This week">
      {contribs.loading && !contribs.data ? <Skeleton w="100%" h={72} /> : (
        <>
          <div role="img" aria-label={`Team contributions per day, last 7 days: ${days.out.map(d => d.total).join(', ')}`} className="grid h-[72px] grid-cols-7 items-end gap-2">
            {days.out.map((d, i) => (
              <div key={i} className="flex h-full flex-col justify-end">
                <div className={`flex flex-col-reverse gap-px overflow-hidden rounded-[3px] ${i === 6 ? 'outline-[1.5px] outline-offset-2 outline-fg outline-solid' : ''}`} style={{ height: `${(d.total / max) * 100}%` }}>
                  {d.counts.map((n, j) => n > 0 && <span key={j} style={{ flexGrow: n, background: WORK_CATEGORIES[j].color }} />)}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-2" aria-hidden="true">
            {days.out.map((d, i) => <span key={i} className={`text-center text-[11.5px] ${i === 6 ? 'font-semibold text-fg' : 'text-fg-muted'}`}>{d.label}</span>)}
          </div>
          <p className="mt-3 text-caption font-normal text-fg-muted">{total} contribution{total === 1 ? '' : 's'}{days.manual ? ` · ${days.manual} logged off-repo` : ''}</p>
        </>
      )}
    </Card>
  );
}

function DueSoon() {
  const { base, tasks, risks } = useTeam();
  const riskByTask = new Map((risks ?? []).map(r => [r.task_id, r.level]));
  const soon = (tasks ?? []).filter(t => t.status === 'open' && t.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!)).slice(0, 3);
  if (!soon.length) return null;
  return (
    <Card title="Due soon" bodyClassName="px-3 pb-3">
      <ul className="list-none">
        {soon.map(t => {
          const lvl = riskByTask.get(t.id);
          return (
            <li key={t.id}>
              <Link to={`${base}/plan/${t.github_issue_number ?? ''}`} className="flex h-9 items-center gap-2.5 rounded-md px-2 text-label font-normal hover:bg-surface-2">
                <span className="w-8 font-mono text-[12px] text-fg-muted">{t.github_issue_number != null ? `#${t.github_issue_number}` : ''}</span>
                <span className="min-w-0 flex-1 truncate">{t.title}</span>
                <span className="text-caption" style={{ color: lvl ? riskColor(lvl) : 'var(--fg-muted)' }}>{shortDate(t.due_date!)}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
