import { useEffect, useId, useState, type FormEvent } from 'react';
import { CalendarCheck, Lightbulb, MessagesSquare, Palette, Search, Waypoints } from 'lucide-react';
import { api } from '../api/client.ts';
import type { ManualKind } from '../api/types.ts';
import { Button, Field, inputClass, textareaClass } from '../ui/primitives.tsx';
import { Sheet, useToast } from '../ui/overlays.tsx';
import { sortedMembers, useTeam } from './team.tsx';

const KINDS: Array<{ value: ManualKind; label: string; Icon: typeof Palette }> = [
  { value: 'design', label: 'Design', Icon: Palette },
  { value: 'research', label: 'Research', Icon: Search },
  { value: 'meeting', label: 'Meeting', Icon: MessagesSquare },
  { value: 'coordination', label: 'Coordination', Icon: Waypoints },
  { value: 'other', label: 'Other', Icon: Lightbulb },
];

function isoDay(offset = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export default function LogWorkSheet({ open, onClose, initialMember }: { open: boolean; onClose: () => void; initialMember?: number }) {
  const { teamId, summary, tasks, me, reload } = useTeam();
  const toast = useToast();
  const ids = { who: useId(), what: useId(), task: useId(), link: useId(), date: useId() };
  const people = sortedMembers(summary?.members);
  const openTasks = (tasks ?? []).filter(t => t.status === 'open');

  const [memberId, setMemberId] = useState('');
  const [kind, setKind] = useState<ManualKind>('meeting');
  const [title, setTitle] = useState('');
  const [taskId, setTaskId] = useState('');
  const [link, setLink] = useState('');
  const [date, setDate] = useState(isoDay());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: string; message: string } | null>(null);

  useEffect(() => {
    if (!open) return;
    setMemberId(String(initialMember ?? me ?? ''));
    setDate(isoDay());
    setError(null);
  }, [open, initialMember, me]);

  async function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!memberId) { setError({ field: 'who', message: 'Choose who did the work.' }); return; }
    if (!title.trim()) { setError({ field: 'what', message: 'Say what was done.' }); return; }
    if (link.trim() && !/^https?:\/\//i.test(link.trim())) { setError({ field: 'link', message: 'Links start with http:// or https://' }); return; }
    setBusy(true);
    setError(null);
    try {
      await api.logWork(teamId, {
        member_id: Number(memberId), kind, title: title.trim(),
        link: link.trim() || undefined, task_id: taskId ? Number(taskId) : undefined, date: date || undefined,
      });
      const who = people.find(p => p.memberId === Number(memberId));
      toast.show(`Logged for ${who?.displayName.split(' ')[0] ?? 'the team'}.`);
      setTitle(''); setLink(''); setTaskId('');
      reload();
      onClose();
    } catch (err) {
      setError({ field: 'form', message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} label="Log work" width="md:w-[min(480px,100vw)]"
      header={<><h2 className="text-title-2">Log work</h2><p className="text-fg-muted">Meetings, design, research and writing count too.</p></>}>
      <form className="flex flex-col gap-5" noValidate onSubmit={submit}
        onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-label">Kind of work</legend>
          <div className="flex flex-wrap gap-2" role="radiogroup">
            {KINDS.map(k => (
              <button key={k.value} type="button" role="radio" aria-checked={kind === k.value} onClick={() => setKind(k.value)}
                className="inline-flex h-9 items-center gap-2 rounded-full border border-line-strong px-3.5 text-label text-fg transition-colors hover:bg-surface-2 aria-checked:border-fg aria-checked:bg-fg aria-checked:text-canvas coarse:h-11">
                <k.Icon size={14} aria-hidden="true" />{k.label}
              </button>
            ))}
          </div>
        </fieldset>

        <Field label="Who" htmlFor={ids.who} error={error?.field === 'who' ? error.message : null}>
          <select id={ids.who} className={inputClass} value={memberId} onChange={e => setMemberId(e.target.value)} aria-invalid={error?.field === 'who'}>
            <option value="">Choose a teammate</option>
            {people.map(p => <option key={p.memberId} value={p.memberId}>{p.displayName}{p.memberId === me ? ' (you)' : ''}</option>)}
          </select>
        </Field>

        <Field label="What you did" htmlFor={ids.what} error={error?.field === 'what' ? error.message : null}
          help={`${title.length}/280`}>
          <textarea id={ids.what} data-autofocus rows={3} maxLength={280} className={textareaClass} value={title}
            onChange={e => setTitle(e.target.value)} placeholder="Ran the user interviews for the timer feature" aria-invalid={error?.field === 'what'} />
        </Field>

        <Field label={<>Related task <span className="font-normal text-fg-muted">· optional</span></>} htmlFor={ids.task}>
          <select id={ids.task} className={inputClass} value={taskId} onChange={e => setTaskId(e.target.value)}>
            <option value="">None</option>
            {openTasks.map(t => <option key={t.id} value={t.id}>{t.github_issue_number ? `#${t.github_issue_number} ` : ''}{t.title}</option>)}
          </select>
        </Field>

        <Field label={<>Link <span className="font-normal text-fg-muted">· optional</span></>} htmlFor={ids.link} error={error?.field === 'link' ? error.message : null}>
          <input id={ids.link} type="url" className={inputClass} value={link} onChange={e => setLink(e.target.value)} placeholder="https://" aria-invalid={error?.field === 'link'} />
        </Field>

        <Field label="When" htmlFor={ids.date}>
          <div className="flex flex-wrap items-center gap-2">
            <input id={ids.date} type="date" max={isoDay()} className={`${inputClass} w-auto`} value={date} onChange={e => setDate(e.target.value)} />
            <Button size="sm" variant="ghost" onClick={() => setDate(isoDay(1))}>Yesterday</Button>
            <Button size="sm" variant="ghost" onClick={() => setDate(isoDay(2))}>2 days ago</Button>
          </div>
        </Field>

        {error?.field === 'form' && <p className="text-risk-high" role="alert">{error.message}</p>}

        <div className="flex items-center justify-end gap-2 pt-1">
          <span className="mr-auto hidden items-center gap-1 text-caption font-normal text-fg-muted md:inline-flex"><CalendarCheck size={13} aria-hidden="true" />⌘ Enter to log</span>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" busy={busy}>Log it</Button>
        </div>
      </form>
    </Sheet>
  );
}
