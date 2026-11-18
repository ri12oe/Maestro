import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Link2, Printer } from 'lucide-react';
import { api } from '../api/client.ts';
import type { Contribution } from '../api/types.ts';
import { useApi } from '../hooks/useApi.ts';
import { shortDate } from '../dates.ts';
import { WORK_CATEGORIES } from '../workTypes.ts';
import { sortedMembers, teamDeadline, useTeam } from '../app/team.tsx';
import { useToast } from '../ui/overlays.tsx';
import { Avatar, Button, ContributionBar, EmptyState, ErrorState, MaestroNote, Page, PageHeader, Segmented, Skeleton, WorkLegend, buttonClass } from '../ui/primitives.tsx';

type Range = 'all' | '14';

function weekStart(d: Date): Date {
  const x = new Date(d); x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

export default function Report() {
  const { teamId, base, team, summary, tasks, version, loading, error, reload } = useTeam();
  const toast = useToast();
  const [range, setRange] = useState<Range>('all');
  const contribs = useApi(() => api.contributions(teamId), [teamId, version]);

  const since = range === '14' ? Date.now() - 14 * 86_400_000 : 0;
  const inRange = useMemo(() => (contribs.data ?? []).filter(c => new Date(c.authored_at).getTime() >= since), [contribs.data, since]);
  const members = sortedMembers(summary?.members);
  const deadline = teamDeadline(team, tasks);

  if (error) return <Page><ErrorState message={error} onRetry={reload} /></Page>;
  if (!loading && team && !team.report_enabled) {
    return (
      <Page>
        <PageHeader title="Project report" />
        <div className="rounded-[10px] border border-line bg-surface-1">
          <EmptyState heading="The project report is off" line="Anyone on the team can turn it on in Settings. Everyone will see the same report.">
            <Link to={`${base}/settings/report`} className={buttonClass('secondary')}>Open settings</Link>
          </EmptyState>
        </div>
      </Page>
    );
  }

  const first = inRange.reduce<string | null>((m, c) => (!m || c.authored_at < m ? c.authored_at : m), null);
  const done = (tasks ?? []).filter(t => t.status === 'closed').length;
  const manual = inRange.filter(c => c.source === 'manual').length;
  const disputed = inRange.filter(c => c.disputed).length;
  const days = first ? Math.max(1, Math.ceil((Date.now() - new Date(first).getTime()) / 86_400_000)) : 0;

  return (
    <Page width="max-w-[1120px]">
      <PageHeader title="Project report"
        subtitle={`${team?.name ?? ''}${first ? ` · ${shortDate(first)} to ${shortDate(new Date().toISOString())}` : ''} · for peer evaluations`}
        actions={<>
          <Segmented label="Date range" value={range} onChange={setRange} options={[{ value: 'all', label: 'Whole project' }, { value: '14', label: 'Last 14 days' }]} />
          <Button onClick={() => void navigator.clipboard.writeText(window.location.href).then(() => toast.show('Link copied.'))}><Link2 size={14} aria-hidden="true" />Copy link</Button>
          <Button variant="primary" onClick={() => window.print()}><Printer size={14} aria-hidden="true" />Export PDF</Button>
        </>} />

      <article className="mx-auto flex w-full max-w-[760px] flex-col gap-12 pt-4">
        {contribs.loading && !contribs.data ? <Skeleton w="100%" h={120} /> : (
          <MaestroNote>
            <p className="text-pretty">
              {team?.name} has {tasks?.length ?? 0} tasks, and {done} {done === 1 ? 'is' : 'are'} done. {members.length} {members.length === 1 ? 'person has' : 'people have'} worked on it
              {days ? ` over ${days} day${days === 1 ? '' : 's'}` : ''}, with {inRange.length} contribution{inRange.length === 1 ? '' : 's'}{manual ? `, including ${manual} logged off-repo` : ''}.
              {disputed ? ` ${disputed} label${disputed === 1 ? ' was' : 's were'} disputed.` : ''}
            </p>
          </MaestroNote>
        )}

        <WeeklyChart contribs={inRange} deadline={deadline.date} />

        <section className="flex flex-col">
          <h2 className="mb-2 text-title-3">Each person&rsquo;s work</h2>
          {members.map(m => {
            const mine = inRange.filter(c => c.member_id === m.memberId);
            const notable = mine.filter(c => c.source !== 'manual' && c.substance === 'high').slice(0, 5);
            const offRepo = mine.filter(c => c.source === 'manual');
            const completed = (tasks ?? []).filter(t => t.status === 'closed' && m.login && t.assignee_login === m.login);
            return (
              <div key={m.memberId} className="flex break-inside-avoid flex-col gap-3 border-t border-line py-5">
                <div className="flex items-center gap-3">
                  <Avatar name={m.displayName} login={m.login} size={32} />
                  <h3 className="text-[15px] font-semibold">{m.displayName}</h3>
                  {m.login && <span className="font-mono text-[12px] text-fg-muted">@{m.login}</span>}
                </div>
                <ContributionBar shares={m.substanceShares} length={m.totalWeight ? 1 : 0} height={8} label={`${m.displayName}'s work mix`} />
                <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4 text-label leading-5 font-normal">
                  <Block title="Tasks completed" items={completed.map(t => `#${t.github_issue_number} ${t.title}`)} empty="None yet" />
                  <Block title="Notable work" items={notable.map(c => c.summary ?? c.title)} empty={`${mine.length} contribution${mine.length === 1 ? '' : 's'}, none marked substantial`} />
                  <Block title="Off-repo work" items={offRepo.map(c => c.title)} empty="None logged" />
                </div>
              </div>
            );
          })}
        </section>
        <p className="text-caption font-normal text-fg-muted">Maestro describes work; it never scores, grades or ranks people. People are listed alphabetically.</p>
      </article>
    </Page>
  );
}

function Block({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <div>
      <div className="mb-1 text-caption text-fg-muted">{title}</div>
      {items.length ? <ul className="flex list-none flex-col gap-0.5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul> : <span className="text-fg-muted">{empty}</span>}
    </div>
  );
}

function WeeklyChart({ contribs, deadline }: { contribs: Contribution[]; deadline: string | null }) {
  const weeks = useMemo(() => {
    if (!contribs.length) return [];
    const times = contribs.map(c => new Date(c.authored_at).getTime());
    const start = weekStart(new Date(Math.min(...times)));
    const lastData = weekStart(new Date());
    const end = deadline ? weekStart(new Date(`${deadline}T12:00:00`)) : lastData;
    const out: Array<{ start: Date; counts: number[]; total: number; future: boolean }> = [];
    for (let d = new Date(start); d <= (end > lastData ? end : lastData) && out.length < 26; d.setDate(d.getDate() + 7)) {
      out.push({ start: new Date(d), counts: WORK_CATEGORIES.map(() => 0), total: 0, future: d > lastData });
    }
    for (const c of contribs) {
      const w = out.find(x => x.start.getTime() === weekStart(new Date(c.authored_at)).getTime());
      if (!w) continue;
      const i = WORK_CATEGORIES.findIndex(cat => c.work_type && cat.types.includes(c.work_type));
      w.counts[i < 0 ? WORK_CATEGORIES.length - 1 : i]++; w.total++;
    }
    return out;
  }, [contribs, deadline]);
  if (!weeks.length) return null;
  const max = Math.max(4, ...weeks.map(w => w.total));
  const ceil = Math.ceil(max / 4) * 4;

  return (
    <section className="flex flex-col gap-4 break-inside-avoid">
      <div>
        <h2 className="text-title-3">Team activity by week</h2>
        <p className="text-label font-normal text-fg-muted">All contributions, stacked by kind of work. The team as a whole, not per person.</p>
      </div>
      <div role="img" aria-label={`Weekly team contributions: ${weeks.filter(w => !w.future).map(w => `week of ${shortDate(w.start.toISOString())}, ${w.total}`).join('; ')}`}
        className="relative grid h-[200px] items-end gap-3 border-b border-line-strong px-1" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
        <div className="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line" />
        <div className="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-line" />
        <span className="absolute -top-[18px] left-0 text-[11.5px] text-fg-muted">{ceil}</span>
        <span className="absolute top-[calc(50%-18px)] left-0 text-[11.5px] text-fg-muted">{ceil / 2}</span>
        {weeks.map((w, i) => (
          <div key={i} className="relative flex h-full flex-col items-center justify-end">
            {w.future
              ? <div className="h-full w-full max-w-14 rounded-t border border-b-0 border-dashed border-line" />
              : <>
                <span className="mb-1 text-caption">{w.total}</span>
                <div className="flex w-full max-w-14 flex-col-reverse gap-px overflow-hidden rounded-t" style={{ height: `${(w.total / ceil) * 86}%` }}>
                  {w.counts.map((n, j) => n > 0 && <span key={j} style={{ flexGrow: n, background: WORK_CATEGORIES[j].color }} />)}
                </div>
              </>}
          </div>
        ))}
      </div>
      <div className="-mt-2 grid gap-3 px-1" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }} aria-hidden="true">
        {weeks.map((w, i) => <span key={i} className="text-center text-[11.5px] text-fg-muted">{shortDate(w.start.toISOString())}</span>)}
      </div>
      <WorkLegend />
      {deadline && <p className="text-caption font-normal text-fg-muted">Dashed weeks are still ahead. Deadline {shortDate(deadline)}.</p>}
    </section>
  );
}
