import { useState } from 'react';
import { Link } from 'react-router';
import { Check, CircleCheck, Copy, Gauge, RefreshCw, TriangleAlert } from 'lucide-react';
import { api } from '../api/client.ts';
import type { Digest, PlanCheck, PlanVerdict } from '../api/types.ts';
import { useApi } from '../hooks/useApi.ts';
import { timeAgo } from '../dates.ts';
import Bulb from '../components/Bulb.tsx';
import { Badge, Button, IconButton, Skeleton } from '../ui/primitives.tsx';
import { SourceChips } from './Sources.tsx';
import { useTeam } from './team.tsx';

const VERDICT: Record<PlanVerdict, { label: string; tone: 'ok' | 'med' | 'high' | 'neutral' }> = {
  on_track: { label: 'On track', tone: 'ok' },
  tight: { label: 'Tight', tone: 'med' },
  behind: { label: 'Behind', tone: 'high' },
  too_early: { label: 'Too early to tell', tone: 'neutral' },
  no_deadline: { label: 'No deadline', tone: 'neutral' },
  done: { label: 'All done', tone: 'ok' },
};

function AiHeader({ title, at, onRefresh, refreshing }: { title: string; at?: string; onRefresh: () => void; refreshing: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <Bulb height={16} state={refreshing ? 'thinking' : 'default'} />
      <h2 className="text-title-3">{title}</h2>
      {at && <span className="text-caption font-normal text-fg-muted">· {timeAgo(at)}</span>}
      <IconButton label={`Refresh ${title.toLowerCase()}`} onClick={onRefresh} disabled={refreshing} className="ml-auto size-8">
        <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
      </IconButton>
    </div>
  );
}

/** Will we make the deadline? The verdict is arithmetic from the server; Maestro writes the words. */
export function PlanCheckCard() {
  const { teamId, base, version, tasks } = useTeam();
  const [refresh, setRefresh] = useState(0);
  const plan = useApi<PlanCheck>(() => api.planCheck(teamId, refresh > 0), [teamId, version, refresh]);
  const p = plan.data;
  if (plan.error) {
    return (
      <section className="flex items-center gap-3 rounded-[10px] border border-line bg-surface-1 px-5 py-4 text-label font-normal text-fg-muted">
        <TriangleAlert size={16} aria-hidden="true" />Couldn’t check the plan. <Button size="sm" variant="ghost" onClick={() => setRefresh(r => r + 1)}>Try again</Button>
      </section>
    );
  }
  const v = p ? VERDICT[p.verdict] : null;
  const pct = p?.neededPerWeek ? Math.min(100, (p.pacePerWeek / p.neededPerWeek) * 100) : p?.verdict === 'done' ? 100 : 0;
  const issue = (id: number) => tasks?.find(t => t.id === id);

  return (
    <section aria-labelledby="plan-h" className="flex flex-col gap-3 rounded-[10px] border border-line bg-surface-1 p-5">
      <div id="plan-h" className="contents"><AiHeader title="Deadline check" at={p?.generatedAt} onRefresh={() => setRefresh(r => r + 1)} refreshing={plan.loading} /></div>
      {!p ? <div className="flex flex-col gap-2"><Skeleton w="40%" h={20} /><Skeleton w="90%" h={14} /></div> : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={v!.tone} className="h-6 px-2 text-label">{v!.tone === 'ok' ? <CircleCheck size={13} aria-hidden="true" /> : <Gauge size={13} aria-hidden="true" />}{v!.label}</Badge>
            {p.neededPerWeek !== null && p.verdict !== 'done' && (
              <span className="text-caption font-normal text-fg-muted">
                {p.openTasks} open · {p.daysLeft} days left · closing {p.pacePerWeek}/week, need {p.neededPerWeek}/week
              </span>
            )}
          </div>
          {p.neededPerWeek !== null && p.verdict !== 'done' && p.verdict !== 'too_early' && (
            <div role="img" aria-label={`Recent pace is ${Math.round(pct)}% of the pace needed`} className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full" style={{ width: `${Math.max(pct, 2)}%`, background: v!.tone === 'ok' ? 'var(--ok)' : v!.tone === 'med' ? 'var(--risk-med)' : 'var(--risk-high)' }} />
            </div>
          )}
          <p className="text-pretty">{p.summary}</p>
          {p.recommendations.length > 0 && (
            <ul className="flex list-none flex-col gap-2 border-t border-line pt-3">
              {p.recommendations.map((r, i) => (
                <li key={i} className="flex flex-wrap items-start gap-x-2 gap-y-1 text-label font-normal">
                  <span className="mt-[3px] grid size-4 shrink-0 place-items-center rounded-full bg-surface-3 text-[10px] font-semibold">{i + 1}</span>
                  <span className="min-w-0 flex-1">{r.text}</span>
                  {r.taskIds.map(id => {
                    const t = issue(id);
                    return t ? <Link key={id} to={`${base}/plan/${t.github_issue_number}`} className="font-mono text-[12px] text-fg-muted underline-offset-[3px] hover:text-fg hover:underline">#{t.github_issue_number}</Link> : null;
                  })}
                </li>
              ))}
            </ul>
          )}
          {p.verdict === 'no_deadline' && <Link to={`${base}/settings/deadline`} className="self-start text-label underline underline-offset-[3px]">Set a deadline</Link>}
        </>
      )}
    </section>
  );
}

const KIND_LABEL: Record<Digest['points'][number]['kind'], string> = { moved: 'Moved', shipped: 'Shipped', stuck: 'Stuck', next: 'Next' };

function digestText(d: Digest, team: string): string {
  return [`${team}: week in review`, d.headline, ...d.points.map(p => `• ${KIND_LABEL[p.kind]}: ${p.text}`)].join('\n');
}

/** The week in review, ready to paste into the group chat. */
export function DigestCard() {
  const { teamId, version, team } = useTeam();
  const [refresh, setRefresh] = useState(0);
  const [copied, setCopied] = useState(false);
  const digest = useApi<Digest>(() => api.digest(teamId, 7, refresh > 0), [teamId, version, refresh]);
  const d = digest.data;
  if (digest.error) return null;

  return (
    <section aria-labelledby="digest-h" className="flex flex-col gap-3 rounded-[10px] border border-line bg-surface-1 p-5">
      <div id="digest-h" className="contents"><AiHeader title="Week in review" at={d?.generatedAt} onRefresh={() => setRefresh(r => r + 1)} refreshing={digest.loading} /></div>
      {!d ? <div className="flex flex-col gap-2"><Skeleton w="80%" h={16} /><Skeleton w="95%" h={14} /><Skeleton w="70%" h={14} /></div> : (
        <>
          <p className="text-brief text-pretty">{d.headline}</p>
          {d.points.length > 0 && (
            <ul className="flex list-none flex-col gap-3">
              {d.points.map((p, i) => (
                <li key={i} className="grid grid-cols-[64px_minmax(0,1fr)] gap-3">
                  <span className="pt-0.5 text-caption tracking-[0.04em] text-fg-muted uppercase">{KIND_LABEL[p.kind]}</span>
                  <div className="flex min-w-0 flex-col gap-1.5">
                    <span>{p.text}</span>
                    <SourceChips sources={p.sources.slice(0, 3)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
            <span className="text-caption font-normal text-fg-muted">
              {d.stats.contributions} contribution{d.stats.contributions === 1 ? '' : 's'} · {d.stats.tasksTouched} task{d.stats.tasksTouched === 1 ? '' : 's'} touched · {d.stats.tasksClosed} closed
            </span>
            <Button size="sm" onClick={() => void navigator.clipboard.writeText(digestText(d, team?.name ?? 'Team')).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })}>
              {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}{copied ? 'Copied' : 'Copy for group chat'}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
