import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, RotateCcw } from 'lucide-react';
import { api } from '../api/client.ts';
import type { AskResult } from '../api/types.ts';
import Bulb from '../components/Bulb.tsx';
import { Button, MaestroNote } from '../ui/primitives.tsx';
import { Sheet } from '../ui/overlays.tsx';
import { SourceChips } from './Sources.tsx';
import { buildDecisions } from './decisions.ts';
import { firstName, sortedMembers, useTeam } from './team.tsx';

export interface AskTurn { id: number; question: string; result?: AskResult; error?: string }

const MAX = 300;

export default function AskSheet({ open, onClose, initial, turns, setTurns }: {
  open: boolean; onClose: () => void; initial?: string;
  turns: AskTurn[]; setTurns: (fn: (t: AskTurn[]) => AskTurn[]) => void;
}) {
  const { teamId, summary, me, risks, suggestions, tasks } = useTeam();
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const inputId = useId();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const asked = useRef<string | null>(null);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    const id = Date.now();
    setTurns(t => [...t, { id, question: q }]);
    setDraft('');
    setBusy(true);
    try {
      const result = await api.ask(teamId, q);
      setTurns(t => t.map(x => (x.id === id ? { ...x, result } : x)));
    } catch (e) {
      setTurns(t => t.map(x => (x.id === id ? { ...x, error: e instanceof Error ? e.message : String(e) } : x)));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  // A question typed into ⌘K arrives here already asked.
  useEffect(() => {
    if (open && initial && asked.current !== initial) { asked.current = initial; void send(initial); }
    if (!open) asked.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }); }, [turns]);

  const meName = sortedMembers(summary?.members).find(m => m.memberId === me)?.displayName;
  const urgent = buildDecisions(risks, suggestions)[0];
  const urgentNumber = urgent?.risk?.task_number ?? urgent?.suggestion?.task_number;
  const nextDue = (tasks ?? []).filter(t => t.status === 'open' && t.due_date).sort((a, b) => a.due_date!.localeCompare(b.due_date!))[0];
  const ideas = [
    urgentNumber != null ? `What’s blocking #${urgentNumber}?` : 'What needs attention this week?',
    meName ? `What has ${firstName(meName)} worked on this week?` : 'What did the team do this week?',
    nextDue ? `Who has worked on anything related to #${nextDue.github_issue_number}?` : 'What’s due next?',
    'Who could take on another task?',
  ];

  function submit(e: FormEvent) { e.preventDefault(); void send(draft); }

  return (
    <Sheet open={open} onClose={onClose} label="Ask Maestro" width="md:w-[min(560px,100vw)]"
      header={(
        <div className="flex items-center gap-3">
          <span className="grid size-9 place-items-center rounded-[10px] border border-maestro-line bg-maestro-wash"><Bulb height={26} state={busy ? 'thinking' : 'default'} /></span>
          <div>
            <h2 className="text-title-2">Ask Maestro</h2>
            <p className="text-label font-normal text-fg-muted">Answers come only from your repo, Issues and logged work.</p>
          </div>
        </div>
      )}>
      <div className="flex min-h-full flex-col gap-5">
        {turns.length === 0 && (
          <div className="flex flex-col gap-2">
            <p className="text-label text-fg-muted">Try asking</p>
            <ul className="flex list-none flex-col gap-1.5">
              {ideas.map(q => (
                <li key={q}>
                  <button type="button" onClick={() => void send(q)} className="w-full rounded-md border border-line px-3 py-2.5 text-left text-label font-normal hover:bg-surface-2">{q}</button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-caption font-normal text-fg-muted">Maestro won’t rank or compare people. Ask what someone worked on, not who did more.</p>
          </div>
        )}

        <ol className="flex list-none flex-col gap-4" aria-live="polite">
          {turns.map(t => (
            <li key={t.id} className="flex flex-col gap-2.5">
              <p className="self-end rounded-[14px] rounded-br-[4px] bg-surface-3 px-3.5 py-2 text-body">{t.question}</p>
              {!t.result && !t.error && (
                <div className="flex items-center gap-2 text-label font-normal text-fg-muted" role="status"><Bulb height={18} state="thinking" />Reading the team’s work…</div>
              )}
              {t.error && (
                <div className="flex flex-wrap items-center gap-2 text-label font-normal text-risk-high" role="alert">
                  {t.error}
                  <Button size="sm" variant="ghost" onClick={() => { setTurns(x => x.filter(y => y.id !== t.id)); void send(t.question); }}><RotateCcw size={13} aria-hidden="true" />Retry</Button>
                </div>
              )}
              {t.result && (
                t.result.refused
                  ? <p className="rounded-[10px] border border-line bg-surface-2 p-4 text-body">{t.result.answer}</p>
                  : (
                    <MaestroNote compact>
                      <p className="text-pretty">{t.result.answer}</p>
                      {t.result.sources.length > 0 && <div className="mt-3"><SourceChips sources={t.result.sources} onNavigate={onClose} /></div>}
                    </MaestroNote>
                  )
              )}
            </li>
          ))}
        </ol>
        <div ref={endRef} />

        <form onSubmit={submit} className="sticky bottom-0 mt-auto -mx-1 flex items-end gap-2 bg-surface-1 px-1 pt-2 pb-1">
          <label htmlFor={inputId} className="sr-only">Your question</label>
          <textarea
            id={inputId} ref={inputRef} data-autofocus rows={1} maxLength={MAX} value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(draft); } }}
            placeholder="Ask about tasks, work or the deadline"
            className="max-h-32 min-h-11 flex-1 resize-none rounded-[10px] border border-line-strong bg-surface-2 px-3.5 py-2.5 text-body placeholder:text-fg-subtle focus:border-fg/40 focus:ring-2 focus:ring-fg/15 focus:outline-none"
          />
          <Button type="submit" variant="primary" className="size-11 !px-0" disabled={!draft.trim()} busy={busy} aria-label="Ask"><ArrowUp size={18} aria-hidden="true" /></Button>
        </form>
        {turns.length > 0 && (
          <button type="button" onClick={() => setTurns(() => [])} className="-mt-3 self-start text-caption font-normal text-fg-muted hover:text-fg">Clear conversation</button>
        )}
      </div>
    </Sheet>
  );
}
