import { useCallback, useState, type FormEvent } from 'react';
import { api } from '../../api/client.ts';
import type { ManualKind } from '../../api/types.ts';
import { useApi } from '../../hooks/useApi.ts';
import { Page, useTeam } from '../../components/Layout.tsx';
import { Card, Chip, ErrorState, Loading, Toast } from '../../components/ui.tsx';
import { shortDate } from '../../dates.ts';
import './LogWork.scss';

// The kinds the API accepts for work done outside the repo.
const KINDS: Array<{ value: ManualKind; label: string; color: string }> = [
  { value: 'design', label: 'Design', color: 'var(--work-docs)' },
  { value: 'research', label: 'Research', color: 'var(--work-other)' },
  { value: 'meeting', label: 'Meeting', color: 'var(--work-other)' },
  { value: 'coordination', label: 'Coordination', color: 'var(--work-other)' },
  { value: 'other', label: 'Other', color: 'var(--work-other)' },
];
const KIND_LABEL = Object.fromEntries(KINDS.map(k => [k.value, k.label])) as Record<ManualKind, string>;

/** Local calendar day for `<input type="date">`. */
function todayInputValue(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export default function LogWork() {
  const { teamId, version } = useTeam();
  const members = useApi(() => api.members(teamId), [teamId, version]);
  const tasks = useApi(() => api.tasks(teamId), [teamId, version]);
  const entries = useApi(() => api.manualEntries(teamId), [teamId, version]);

  const [memberId, setMemberId] = useState('');
  const [kind, setKind] = useState<ManualKind>('design');
  const [taskId, setTaskId] = useState('');
  const [title, setTitle] = useState('');
  const [link, setLink] = useState('');
  const [date, setDate] = useState(todayInputValue);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const closeToast = useCallback(() => setToast(null), []);

  const people = (members.data ?? []).filter(m => m.github_login);
  const openTasks = (tasks.data ?? []).filter(t => t.status === 'open');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!memberId) { setError('Choose who did the work.'); return; }
    if (!title.trim()) { setError('Say what was done.'); return; }
    if (link.trim() && !/^https?:\/\//i.test(link.trim())) { setError('The link should start with http:// or https://'); return; }

    setBusy(true);
    setError(null);
    try {
      await api.logWork(teamId, {
        member_id: Number(memberId),
        kind,
        title: title.trim(),
        link: link.trim() || undefined,
        task_id: taskId ? Number(taskId) : undefined,
        date: date || undefined,
      });
      setToast('Logged. It’ll appear on the overview after the next refresh.');
      setTitle(''); setLink(''); setTaskId('');
      entries.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page title="Log work" subtitle="Meetings, design, research and writing count too.">
      <div className="logwork">
        {members.error && <ErrorState message={members.error} onRetry={members.reload} />}
        {members.loading && !members.data && <Loading />}

        <form className="logform" onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="who">Who did this?</label>
            <select id="who" className="input" value={memberId} onChange={e => setMemberId(e.target.value)} required>
              <option value="">Choose a teammate</option>
              {people.map(m => <option key={m.id} value={m.id}>{m.display_name ?? m.github_login}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="what">What did you do?</label>
            <textarea id="what" className="input" value={title} onChange={e => setTitle(e.target.value)} required maxLength={120}
              placeholder="e.g. Designed the onboarding screens in Figma" />
          </div>

          <fieldset className="field logform__kinds">
            <legend className="field__label">Type</legend>
            <div className="chips">
              {KINDS.map(k => (
                <Chip key={k.value} selected={kind === k.value} onClick={() => setKind(k.value)} dot={k.color}>{k.label}</Chip>
              ))}
            </div>
          </fieldset>

          <div className="field">
            <label htmlFor="task">Related task (optional)</label>
            <select id="task" className="input" value={taskId} onChange={e => setTaskId(e.target.value)}>
              <option value="">Not tied to a task</option>
              {openTasks.map(t => <option key={t.id} value={t.id}>#{t.github_issue_number} {t.title}</option>)}
            </select>
          </div>

          <div className="field">
            <label htmlFor="link">Link (optional)</label>
            <input id="link" type="url" className="input" value={link} onChange={e => setLink(e.target.value)} placeholder="Figma, Google Doc, notes…" />
          </div>

          <div className="field">
            <label htmlFor="when">Date (optional)</label>
            <input
              id="when"
              type="date"
              className="input"
              value={date}
              max={todayInputValue()}
              aria-describedby="when-hint"
              onChange={e => setDate(e.target.value)}
            />
            <p className="field__help" id="when-hint">Leave this on today, or choose the day the work happened.</p>
          </div>

          {error && <p className="logform__error" role="alert">{error}</p>}
          <div>
            <button type="submit" className="btn btn--primary" disabled={busy}>{busy ? 'Saving…' : 'Log work'}</button>
          </div>
        </form>

        <Card title="Recently logged">
          {entries.loading && !entries.data && <Loading />}
          {entries.error && <ErrorState message={entries.error} onRetry={entries.reload} />}
          {entries.data && entries.data.length === 0 && <p className="muted">Nothing logged yet.</p>}
          {entries.data && entries.data.length > 0 && (
            <ul className="logged">
              {entries.data.slice(0, 8).map(e => (
                <li key={e.id}>
                  {shortDate(e.authored_at)} · {e.display_name ?? e.github_login}
                  {e.kind && <> · {KIND_LABEL[e.kind] ?? e.kind}</>}
                  {' · '}
                  {e.link ? <a href={e.link} target="_blank" rel="noreferrer">{e.title}</a> : e.title}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      {toast && <Toast message={toast} onClose={closeToast} />}
    </Page>
  );
}
