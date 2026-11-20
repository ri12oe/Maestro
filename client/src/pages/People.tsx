import { useEffect, useId, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ExternalLink, GitCommitHorizontal, MessageSquareWarning, NotebookPen } from 'lucide-react';
import { api } from '../api/client.ts';
import type { Contribution, MemberSummary, Substance, WorkType } from '../api/types.ts';
import { useApi } from '../hooks/useApi.ts';
import { dayLabel, shortDate } from '../dates.ts';
import { shortCommitSha } from '../sha.ts';
import { WORK_TYPE_LABEL, categoryShares } from '../workTypes.ts';
import { firstName, sortedMembers, useTeam } from '../app/team.tsx';
import { Sheet, useToast } from '../ui/overlays.tsx';
import Bulb from '../components/Bulb.tsx';
import {
  Avatar, Badge, Button, Card, ContributionBar, EmptyState, ErrorState, MaestroNote, Page, PageHeader, Segmented, Skeleton, SubstanceDots, WorkLegend, WorkTypeTag, textareaClass,
} from '../ui/primitives.tsx';

function barLabel(m: MemberSummary): string {
  const mix = categoryShares(m.substanceShares).filter(c => c.share > 0).map(c => `${c.label} ${Math.round(c.share * 100)}%`);
  return `${m.displayName}: ${m.contributionCount} items${mix.length ? ` — ${mix.join(', ')}` : ''}`;
}

export default function People() {
  const { base, summary, loading, error, reload } = useTeam();
  const { memberId } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const disputeRaw = Number(params.get('dispute'));
  const disputeId = Number.isFinite(disputeRaw) && disputeRaw > 0 ? disputeRaw : null;
  const members = sortedMembers(summary?.members);
  const max = Math.max(1, ...members.map(m => m.totalWeight));
  const selected = members.find(m => String(m.memberId) === memberId) ?? null;

  if (error) return <Page><ErrorState message={error} onRetry={reload} /></Page>;

  return (
    <Page>
      <PageHeader title="People" subtitle="What each person has worked on, from commits and logged work" />

      <Card title="Who worked on what" action={<span className="hidden text-caption font-normal text-fg-muted sm:inline">Weighted by how substantial each change was · one scale for everyone</span>}>
        {loading && <div className="flex flex-col gap-3">{[0, 1, 2, 3].map(i => <Skeleton key={i} w="100%" h={24} />)}</div>}
        {!loading && members.length === 0 && <EmptyState heading="No one here yet" line="People appear after the first sync, or add them in Settings." />}
        <ul className="-mx-2 list-none">
          {members.map(m => (
            <li key={m.memberId}>
              <button type="button" onClick={() => navigate(`${base}/people/${m.memberId}`)}
                className="grid h-11 w-full grid-cols-[minmax(96px,140px)_minmax(0,1fr)_72px] items-center gap-4 rounded-md px-2 text-left hover:bg-surface-2">
                <span className="flex min-w-0 items-center gap-2 text-label font-normal"><Avatar name={m.displayName} login={m.login} /><span className="truncate">{firstName(m.displayName)}</span></span>
                <ContributionBar shares={m.substanceShares} length={m.totalWeight / max} label={barLabel(m)} />
                <span className="text-right text-label font-normal text-fg-muted">{m.contributionCount} items</span>
              </button>
            </li>
          ))}
        </ul>
        {members.length > 0 && <WorkLegend className="mt-3" />}
      </Card>

      <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
        {members.map(m => (
          <li key={m.memberId}>
            <button type="button" onClick={() => navigate(`${base}/people/${m.memberId}`)}
              className="flex h-full w-full flex-col gap-3.5 rounded-[10px] border border-line bg-surface-1 p-5 text-left transition-colors hover:bg-surface-2">
              <span className="flex items-center gap-3">
                <Avatar name={m.displayName} login={m.login} size={32} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate font-semibold">{m.displayName}</span>
                  {m.login && <span className="truncate font-mono text-[12px] leading-4 text-fg-muted">@{m.login}</span>}
                </span>
              </span>
              {m.focusSummary && <span className="flex items-start gap-2 text-label font-normal"><span className="pt-0.5"><Bulb height={15} /></span><span>{m.focusSummary}</span></span>}
              <ContributionBar shares={m.substanceShares} length={m.totalWeight / max} height={6} label={barLabel(m)} />
              <span className="text-caption font-normal text-fg-muted">{m.openTasks} open task{m.openTasks === 1 ? '' : 's'} · {m.contributionCount} contribution{m.contributionCount === 1 ? '' : 's'}</span>
            </button>
          </li>
        ))}
      </ul>

      <PersonSheet member={selected} disputeId={disputeId} onClose={() => navigate(`${base}/people`, { replace: true })} />
    </Page>
  );
}

type Tab = 'contributions' | 'tasks' | 'logged';

function PersonSheet({ member, disputeId, onClose }: { member: MemberSummary | null; disputeId: number | null; onClose: () => void }) {
  const { teamId, base, tasks, version, me, openLog } = useTeam();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('contributions');
  const contribs = useApi(() => (member ? api.contributions(teamId, { memberId: member.memberId }) : Promise.resolve([])), [teamId, member?.memberId, version]);
  const all = contribs.data ?? [];

  useEffect(() => {
    if (!disputeId || !contribs.data) return;
    const row = contribs.data.find(c => c.id === disputeId);
    if (!row) return;
    setTab(row.source === 'manual' ? 'logged' : 'contributions');
  }, [disputeId, contribs.data]);

  useEffect(() => {
    if (!disputeId) return;
    document.getElementById(`contribution-${disputeId}`)?.scrollIntoView({ block: 'center' });
  }, [disputeId, contribs.data, tab]);
  const list = tab === 'logged' ? all.filter(c => c.source === 'manual') : all.filter(c => c.source !== 'manual');
  const theirTasks = (tasks ?? []).filter(t => member?.login && t.assignee_login === member.login);
  const mix = member ? categoryShares(member.substanceShares) : [];

  let lastDay = '';
  return (
    <Sheet open={!!member} onClose={onClose} label={member?.displayName ?? 'Person'}
      header={member && (
        <div className="flex items-center gap-3.5">
          <Avatar name={member.displayName} login={member.login} size={48} />
          <div className="min-w-0">
            <h2 className="truncate text-title-2">{member.displayName}{member.memberId === me && <span className="ml-2 text-label font-normal text-fg-muted">you</span>}</h2>
            {member.login && <a href={`https://github.com/${member.login}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono text-code text-fg-muted hover:text-fg">github.com/{member.login}<ExternalLink size={11} aria-hidden="true" /></a>}
          </div>
        </div>
      )}>
      {member && (
        <div className="flex flex-col gap-5">
          {member.focusSummary && <MaestroNote compact>{member.focusSummary}</MaestroNote>}

          <section className="flex flex-col gap-2.5">
            <h3 className="text-label">Work mix</h3>
            <ContributionBar shares={member.substanceShares} length={member.totalWeight ? 1 : 0} label={barLabel(member)} />
            <ul className="grid list-none grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-x-4 gap-y-1 text-[12.5px] leading-[18px]">
              {mix.map(c => (
                <li key={c.key} className="flex items-center gap-2"><span className="size-2 rounded-[2px]" style={{ background: c.color }} aria-hidden="true" /><span className="flex-1">{c.label}</span><span className="text-fg-muted">{Math.round(c.share * 100)}%</span></li>
              ))}
            </ul>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented label="Details" value={tab} onChange={setTab} options={[
              { value: 'contributions', label: 'Contributions' }, { value: 'tasks', label: `Tasks ${theirTasks.length}` }, { value: 'logged', label: 'Logged work' },
            ]} />
            {tab === 'logged' && <Button size="sm" onClick={() => openLog(member.memberId)}>Log work for {firstName(member.displayName)}</Button>}
          </div>

          {tab === 'tasks' ? (
            theirTasks.length === 0 ? <p className="text-fg-muted">No tasks assigned to {firstName(member.displayName)}.</p> : (
              <ul className="list-none divide-y divide-line">
                {theirTasks.map(t => (
                  <li key={t.id}>
                    <button type="button" onClick={() => navigate(`${base}/plan/${t.github_issue_number}`)} className="flex h-11 w-full items-center gap-3 text-left text-label font-normal hover:text-fg">
                      <span className="w-10 font-mono text-[12px] text-fg-muted">#{t.github_issue_number}</span>
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <span className="text-fg-muted">{t.status === 'closed' ? 'Done' : t.due_date ? shortDate(t.due_date) : ''}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : (
            <>
              {contribs.loading && !contribs.data && <div className="flex flex-col gap-3">{[0, 1, 2].map(i => <Skeleton key={i} w="100%" h={48} />)}</div>}
              {contribs.data && list.length === 0 && (
                <EmptyState heading={tab === 'logged' ? 'Nothing logged yet' : `No commits from ${firstName(member.displayName)} yet`}
                  line={tab === 'logged' ? 'Meetings, design and research count too.' : `Commits by ${member.login ? `@${member.login}` : 'this person'} will show up here.`}>
                  <Button onClick={() => openLog(member.memberId)}>Log work for {firstName(member.displayName)}</Button>
                </EmptyState>
              )}
              <ul className="list-none">
                {list.map(c => {
                  const day = new Date(c.authored_at).toDateString();
                  const header = day !== lastDay ? day : null;
                  lastDay = day;
                  return (
                    <li key={c.id}>
                      {header && <div className="pt-3 pb-1.5 text-caption tracking-[0.06em] text-fg-muted uppercase">{dayLabel(c.authored_at)}</div>}
                      <ContributionItem c={c} teamId={teamId} disputeOpen={c.id === disputeId} />
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </Sheet>
  );
}

const REASONS = ['Wrong kind of work', 'Wrong substance', 'Wrong task', 'This wasn’t mine'];
const WORK_TYPE_OPTIONS = Object.keys(WORK_TYPE_LABEL) as WorkType[];
const SUBSTANCE_OPTIONS: Array<{ value: Substance; label: string }> = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
];

function originalLabel(c: Contribution): string | null {
  if (!c.corrected_at || !c.original_work_type) return null;
  const type = WORK_TYPE_LABEL[c.original_work_type];
  const substance = c.original_substance ? `, ${c.original_substance}` : '';
  return `AI label: ${type}${substance}`;
}

function ContributionItem({ c, teamId, disputeOpen = false }: { c: Contribution; teamId: number; disputeOpen?: boolean }) {
  const { reload } = useTeam();
  const toast = useToast();
  const corrected = Boolean(c.corrected_at);
  const disputed = Boolean(c.disputed);
  const [open, setOpen] = useState(disputeOpen && !disputed);

  useEffect(() => {
    if (disputeOpen && !c.disputed && !c.corrected_at) setOpen(true);
  }, [disputeOpen, c.disputed, c.corrected_at]);
  const [reason, setReason] = useState(REASONS[0]);
  const [workType, setWorkType] = useState<WorkType | null>(null);
  const [substance, setSubstance] = useState<Substance | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const noteId = useId();
  const Icon = c.source === 'manual' ? NotebookPen : GitCommitHorizontal;
  const href = c.url ?? c.link ?? undefined;
  const correcting = workType != null || substance != null;
  const aiLabel = originalLabel(c);

  async function send() {
    setBusy(true); setErr(null);
    const parts = [reason, note.trim()].filter(Boolean);
    try {
      const saved = await api.dispute(teamId, c.id, {
        note: parts.join(': ') || null,
        ...(workType ? { work_type: workType } : {}),
        ...(substance ? { substance } : {}),
      });
      setOpen(false);
      toast.show(saved.warning ?? (correcting
        ? 'Label corrected. Everyone sees the same label.'
        : 'Dispute sent. The team can see it on the Maestro page.'));
      reload();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  async function undo() {
    setBusy(true); setErr(null);
    try {
      const saved = await api.dispute(teamId, c.id, { undo: true });
      toast.show(saved.warning ?? 'Restored the original AI label.');
      reload();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div id={`contribution-${c.id}`} className="group grid grid-cols-[16px_minmax(0,1fr)] gap-3 border-t border-line py-2.5">
      <Icon size={16} className="mt-0.5 text-fg-muted" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <div>
          <div className="text-[13.5px] leading-5">{c.summary ?? c.title}</div>
          <div className="truncate font-mono text-[11.5px] leading-4 text-fg-muted">
            {href ? <a href={href} target="_blank" rel="noreferrer" className="hover:text-fg">{c.github_sha ? shortCommitSha(c.github_sha) : 'link'}</a> : shortCommitSha(c.github_sha) ?? 'logged'}
            {c.summary && c.title !== c.summary ? ` · ${c.title}` : ''}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {c.source === 'manual' ? <Badge>{c.kind ?? 'Logged'}</Badge> : <WorkTypeTag type={c.work_type} />}
          <SubstanceDots value={c.substance} />
          {c.task_number != null && <span className="rounded-full bg-surface-2 px-1.5 font-mono text-[11.5px] text-fg-muted">#{c.task_number}</span>}
          {corrected && (
            <>
              <Badge tone="maestro"><MessageSquareWarning size={12} aria-hidden="true" />Corrected by team</Badge>
              {aiLabel && <span className="text-caption font-normal text-fg-muted">{aiLabel}</span>}
              <Button size="sm" variant="ghost" className="h-6" onClick={() => void undo()} busy={busy} disabled={busy}>Undo</Button>
            </>
          )}
          {!corrected && disputed && <Badge tone="maestro"><MessageSquareWarning size={12} aria-hidden="true" />Disputed</Badge>}
          {!corrected && !disputed && c.work_type && c.source !== 'manual' && !open && (
            <Button size="sm" variant="ghost" className="ml-auto h-6 opacity-100 md:opacity-0 md:group-focus-within:opacity-100 md:group-hover:opacity-100 coarse:opacity-100"
              onClick={() => setOpen(true)} aria-label={`Dispute the label on “${c.summary ?? c.title}”`}>Wrong label?</Button>
          )}
        </div>
        {err && !open && <p className="text-label font-normal text-risk-high" role="alert">{err}</p>}
        {open && (
          <div className="mt-1 flex animate-pop-in flex-col gap-3 rounded-lg border border-line-strong bg-surface-2 p-3">
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-label">What&rsquo;s wrong?</legend>
              <div className="flex flex-wrap gap-1.5">
                {REASONS.map(r => (
                  <button key={r} type="button" aria-pressed={reason === r} onClick={() => setReason(r)}
                    className="h-7 rounded-full border border-line-strong bg-surface-1 px-2.5 text-[12.5px] text-fg-muted aria-pressed:border-fg aria-pressed:text-fg">{r}</button>
                ))}
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-label">Work type (optional)</legend>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Corrected work type">
                {WORK_TYPE_OPTIONS.map(t => (
                  <button key={t} type="button" aria-pressed={workType === t} onClick={() => setWorkType(current => current === t ? null : t)}
                    className="h-7 rounded-full border border-line-strong bg-surface-1 px-2.5 text-[12.5px] text-fg-muted aria-pressed:border-fg aria-pressed:text-fg">{WORK_TYPE_LABEL[t]}</button>
                ))}
              </div>
            </fieldset>
            <fieldset className="flex flex-col gap-1.5">
              <legend className="mb-1 text-label">Substance (optional)</legend>
              <div className="flex flex-wrap gap-1.5" role="group" aria-label="Corrected substance">
                {SUBSTANCE_OPTIONS.map(s => (
                  <button key={s.value} type="button" aria-pressed={substance === s.value} onClick={() => setSubstance(current => current === s.value ? null : s.value)}
                    className="h-7 rounded-full border border-line-strong bg-surface-1 px-2.5 text-[12.5px] text-fg-muted aria-pressed:border-fg aria-pressed:text-fg">{s.label}</button>
                ))}
              </div>
              <p className="text-caption font-normal text-fg-muted">Corrects the label on this change. It does not score anyone.</p>
            </fieldset>
            <label htmlFor={noteId} className="sr-only">Note (optional)</label>
            <textarea id={noteId} rows={2} className={textareaClass} value={note} onChange={e => setNote(e.target.value)} placeholder="Add a note (optional)" />
            {err && <p className="text-label font-normal text-risk-high" role="alert">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button size="sm" variant="primary" onClick={() => void send()} busy={busy}>{correcting ? 'Save correction' : 'Send dispute'}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
