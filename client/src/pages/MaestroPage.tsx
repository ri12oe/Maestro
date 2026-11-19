import { useState } from 'react';
import { Check } from 'lucide-react';
import { api } from '../api/client.ts';
import { useApi } from '../hooks/useApi.ts';
import { shortDate, timeAgo } from '../dates.ts';
import { shortCommitSha } from '../sha.ts';
import { LogoMark } from '../components/Bulb.tsx';
import { firstName, useTeam } from '../app/team.tsx';
import { useToast } from '../ui/overlays.tsx';
import { Button, Card, EmptyState, ErrorState, Page, Skeleton, WorkTypeTag } from '../ui/primitives.tsx';

const STEPS = [
  ['Labels each change.', 'It reads the commit and its diff, then names the kind of work and how substantial it was.'],
  ['Matches it to a task.', 'Each change is linked to the GitHub Issue it most likely serves.'],
  ['Checks the plan.', 'It compares task activity with the deadline and flags what could slip.'],
  ['Suggests a swap.', 'When one person holds too much, it proposes a move and drafts a neutral check-in.'],
];
const RULES = ['Everyone sees the same view.', 'Only work artifacts, never activity tracking.', 'No scores, grades or rankings of people.', 'Every label links to its evidence and can be disputed.'];

export default function MaestroPage() {
  const { teamId, team, summary, version, reload } = useTeam();
  const toast = useToast();
  const contribs = useApi(() => api.contributions(teamId), [teamId, version]);
  const [classifying, setClassifying] = useState(false);
  const all = contribs.data ?? [];
  const commits = all.filter(c => c.source !== 'manual');
  const labeled = commits.filter(c => c.work_type);
  const unlabeled = commits.filter(c => !c.work_type);
  const disputes = all.filter(c => c.disputed);
  const nameOf = (id: number) => firstName(summary?.members.find(m => m.memberId === id)?.displayName);

  async function classify() {
    setClassifying(true);
    try {
      const r = await api.classify(teamId);
      toast.show(r.failed ? `Labeled ${r.classified}. ${r.failed} couldn’t be labeled; try again later.` : `Labeled ${r.classified} change${r.classified === 1 ? '' : 's'}.`);
      reload();
    } catch (e) { toast.show(e instanceof Error ? e.message : String(e)); }
    finally { setClassifying(false); }
  }

  return (
    <Page>
      <header className="flex items-center gap-3.5">
        <span className="grid size-10 place-items-center rounded-[10px] border border-maestro-line bg-maestro-wash"><LogoMark size={32} /></span>
        <div>
          <h1 className="text-title-2">Maestro</h1>
          <p className="text-fg-muted">How the AI read your project, and where people disagreed.</p>
        </div>
      </header>

      {contribs.error && <ErrorState message={contribs.error} onRetry={contribs.reload} />}

      <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-4">
        <Stat label="Labeled" value={contribs.data ? labeled.length : null} sub={team?.last_synced_at ? `last run ${timeAgo(team.last_synced_at)}` : 'changes from the repo'} />
        <Stat label="Disputed" value={contribs.data ? disputes.length : null} sub="visible to everyone" />
        <Stat label="Not labeled yet" value={contribs.data ? unlabeled.length : null} sub={unlabeled.length ? 'waiting for the AI' : 'all caught up'} />
      </div>

      <Card title="Disputes" action={<span className="hidden text-caption font-normal text-fg-muted sm:inline">Anyone can dispute a label from a person’s page</span>} bodyClassName="pb-2">
        {contribs.loading && !contribs.data && <div className="px-5 pb-4"><Skeleton w="100%" h={40} /></div>}
        {contribs.data && disputes.length === 0 && <EmptyState bulb="happy" heading="No disputes" line="If a label looks wrong, use “Wrong label?” on any contribution." />}
        {disputes.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-label font-normal">
              <thead><tr className="h-9 border-t border-line text-left text-fg-muted">
                <th scope="col" className="pr-2 pl-5 font-medium">Contribution</th>
                <th scope="col" className="w-24 px-2 font-medium">Who</th>
                <th scope="col" className="w-28 px-2 font-medium">Maestro said</th>
                <th scope="col" className="px-2 pr-5 font-medium">Their note</th>
              </tr></thead>
              <tbody>
                {disputes.map(c => (
                  <tr key={c.id} className="h-14 border-t border-line">
                    <td className="pr-2 pl-5"><div>{c.summary ?? c.title}</div><div className="font-mono text-[11.5px] text-fg-muted">{shortCommitSha(c.github_sha)} · {shortDate(c.authored_at)}</div></td>
                    <td className="px-2">{nameOf(c.member_id)}</td>
                    <td className="px-2"><WorkTypeTag type={c.work_type} /></td>
                    <td className="px-2 pr-5 text-fg-muted">{c.dispute_note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="flex flex-wrap items-start gap-4">
        <Card className="flex-[1_1_420px]" title="Not labeled yet" action={unlabeled.length > 0 && <Button size="sm" onClick={() => void classify()} busy={classifying}>Label now</Button>}>
          {contribs.data && unlabeled.length === 0 && <p className="flex items-center gap-2 text-fg-muted"><Check size={14} className="text-ok" aria-hidden="true" />Every change has a label.</p>}
          <ul className="list-none">
            {unlabeled.slice(0, 8).map(c => (
              <li key={c.id} className="flex items-center gap-3 border-t border-line py-2.5 first:border-t-0">
                <div className="min-w-0 flex-1"><div className="truncate text-label font-normal">{c.title}</div><div className="font-mono text-[11.5px] text-fg-muted">{nameOf(c.member_id)} · {shortCommitSha(c.github_sha)}</div></div>
              </li>
            ))}
          </ul>
          {unlabeled.length > 8 && <p className="pt-2 text-caption font-normal text-fg-muted">and {unlabeled.length - 8} more</p>}
        </Card>

        <Card className="flex-[1_1_420px]" title="How Maestro decides">
          <ol className="flex list-none flex-col gap-3">
            {STEPS.map(([h, d], i) => (
              <li key={h} className="grid grid-cols-[24px_minmax(0,1fr)] gap-3">
                <span className="grid size-6 place-items-center rounded-full bg-surface-2 font-mono text-[12px]">{i + 1}</span>
                <span><strong className="font-semibold">{h}</strong> <span className="text-fg-muted">{d}</span></span>
              </li>
            ))}
          </ol>
          <ul className="mt-4 flex list-none flex-col gap-1.5 border-t border-line pt-3 text-label font-normal">
            {RULES.map(r => <li key={r} className="flex items-center gap-2"><Check size={14} className="text-ok" aria-hidden="true" />{r}</li>)}
          </ul>
        </Card>
      </div>
    </Page>
  );
}

function Stat({ label, value, sub }: { label: string; value: number | null; sub: string }) {
  return (
    <div className="rounded-[10px] border border-line bg-surface-1 px-5 py-4">
      <div className="text-caption text-fg-muted">{label}</div>
      {value === null ? <Skeleton w={48} h={28} className="my-1" /> : <div className="text-[28px] leading-9 font-semibold tracking-[-0.02em]">{value}</div>}
      <div className="text-caption font-normal text-fg-muted">{sub}</div>
    </div>
  );
}
