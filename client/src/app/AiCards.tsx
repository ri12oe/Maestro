import { useState } from 'react';
import { Link } from 'react-router';
import { CircleCheck, Copy, Gauge, RefreshCw, TriangleAlert } from 'lucide-react';
import { api } from '../api/client.ts';
import type { Contribution, Digest, DigestClaim, DigestEvidence, PlanCheck, PlanVerdict } from '../api/types.ts';
import { useApi } from '../hooks/useApi.ts';
import { shortDate, timeAgo } from '../dates.ts';
import Bulb from '../components/Bulb.tsx';
import { Badge, Button, ErrorState, IconButton, Skeleton } from '../ui/primitives.tsx';
import { useToast } from '../ui/overlays.tsx';
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

function CopyCheckIn({ text }: { text: string }) {
  const toast = useToast();
  return (
    <Button size="sm" onClick={() => void navigator.clipboard.writeText(text).then(() => toast.show('Check-in message copied.'))}>
      <Copy size={14} aria-hidden="true" />Copy check-in
    </Button>
  );
}

/** Contribution dispute when the sentence cites one; otherwise the task it is about. */
function DisputeLink({ evidence, contributions }: { evidence: DigestEvidence[]; contributions: Contribution[] | null }) {
  const { base, tasks } = useTeam();
  const contrib = evidence.find(e => e.type === 'contribution');
  const taskEv = evidence.find(e => e.type === 'task');
  let to: string | null = null;
  if (contrib) {
    const row = contributions?.find(c => c.id === contrib.id);
    if (row) to = `${base}/people/${row.member_id}?dispute=${row.id}`;
  } else if (taskEv) {
    const t = tasks?.find(x => x.id === taskEv.id);
    if (t?.github_issue_number != null) to = `${base}/plan/${t.github_issue_number}`;
  }
  if (!to) return null;
  return <Link to={to} className="self-start text-label text-fg-muted underline underline-offset-[3px] hover:text-fg">Dispute</Link>;
}

function ClaimList({ label, items, contributions }: { label: string; items: DigestClaim[]; contributions: Contribution[] | null }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-caption tracking-[0.04em] text-fg-muted uppercase">{label}</h3>
      <ul className="flex list-none flex-col gap-3">
        {items.map((item, i) => (
          <li key={i} className="flex min-w-0 flex-col gap-1.5">
            <span>{item.text}</span>
            <SourceChips sources={item.evidence.slice(0, 3)} />
            <DisputeLink evidence={item.evidence} contributions={contributions} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Last 7 days, plus a neutral check-in the team can copy. */
export function DigestCard() {
  const { teamId, version } = useTeam();
  const [refresh, setRefresh] = useState(0);
  const digest = useApi<Digest>(() => api.digest(teamId, 7, refresh > 0), [teamId, version, refresh]);
  const d = digest.data;
  const needsContribs = !!d && [...d.summary, ...d.highlights, ...d.risks, ...d.checkInClaims].some(c => c.evidence.some(e => e.type === 'contribution'));
  const contribs = useApi(() => (needsContribs ? api.contributions(teamId) : Promise.resolve([])), [teamId, version, needsContribs]);
  return (
    <section aria-labelledby="digest-h" className="flex flex-col gap-3 rounded-[10px] border border-line bg-surface-1 p-5">
      <div id="digest-h" className="contents"><AiHeader title="Weekly digest" at={d?.generatedAt} onRefresh={() => setRefresh(r => r + 1)} refreshing={digest.loading && !!d} /></div>
      {digest.error ? <ErrorState message={digest.error} onRetry={() => setRefresh(r => r + 1)} /> : null}
      {!digest.error && !d ? <div className="flex flex-col gap-2"><Skeleton w="40%" h={14} /><Skeleton w="95%" h={16} /><Skeleton w="80%" h={14} /><Skeleton w="70%" h={14} /></div> : null}
      {d && !digest.error && (
        <>
          <p className="text-caption font-normal text-fg-muted">Last {d.days} day{d.days === 1 ? '' : 's'} ({shortDate(d.windowStart)} to {shortDate(d.windowEnd)})</p>
          <ClaimList label="Summary" items={d.summary} contributions={contribs.data} />
          <ClaimList label="Highlights" items={d.highlights} contributions={contribs.data} />
          <ClaimList label="Risks" items={d.risks} contributions={contribs.data} />
          <div className="flex flex-col gap-3 border-t border-line pt-3">
            <ClaimList label="Check-in" items={d.checkInClaims} contributions={contribs.data} />
            {d.checkIn && <div className="flex justify-end"><CopyCheckIn text={d.checkIn} /></div>}
          </div>
        </>
      )}
    </section>
  );
}
