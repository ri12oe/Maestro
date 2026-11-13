import { useState, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../../api/client.ts';
import type { ManualKind } from '../../api/types.ts';
import { useApi } from '../../hooks/useApi.ts';
import { Card, Empty, ErrorState, Loading, PageHeader, Pill } from '../../components/ui.tsx';
import { shortDate } from '../../dates.ts';
import './LogWork.scss';

const KINDS: Array<{ value: ManualKind; label: string }> = [
  { value: 'design', label: 'Design' },
  { value: 'research', label: 'Research' },
  { value: 'meeting', label: 'Meeting notes' },
  { value: 'coordination', label: 'Coordination' },
  { value: 'other', label: 'Other' },
];
const KIND_LABEL = Object.fromEntries(KINDS.map(k => [k.value, k.label])) as Record<ManualKind, string>;

export default function LogWork() {
  const teamId = Number(useParams().teamId);
  const members = useApi(() => api.members(teamId), [teamId]);
  const tasks = useApi(() => api.tasks(teamId), [teamId]);
  const entries = useApi(() => api.manualEntries(teamId), [teamId]);

  const [memberId, setMemberId] = useState('');
  const [kind, setKind] = useState<ManualKind>('design');
  const [taskId, setTaskId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);

  const people = (members.data ?? []).filter(m => m.github_login);
  const openTasks = (tasks.data ?? []).filter(t => t.status === 'open');

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!memberId) { setError('Choose who did the work.'); return; }
    if (!title.trim()) { setError('Add a short title.'); return; }
    if (link.trim() && !/^https?:\/\//i.test(link.trim())) { setError('The link should start with http:// or https://'); return; }

    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await api.logWork(teamId, {
        member_id: Number(memberId),
        kind,
        title: title.trim(),
        body: body.trim() || undefined,
        link: link.trim() || undefined,
        task_id: taskId ? Number(taskId) : undefined,
      });
      setSaved(`Logged “${title.trim()}”. It now counts toward the contribution map${taskId ? ' and the task’s progress' : ''}.`);
      setTitle(''); setBody(''); setLink(''); setTaskId('');
      entries.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Log work outside the repo" />
      <p className="lead">
        Design, research, meetings and coordination count too. Logged work is labeled and linked to a
        task just like a commit, so people who don't write code aren't undervalued.
      </p>

      <div className="split">
        <div className="split__main">
          <Card>
            {(members.loading || tasks.loading) && !members.data && <Loading />}
            {members.error && <ErrorState message={members.error} onRetry={members.reload} />}
            <form className="logform" onSubmit={submit} noValidate>
              <div className="logform__row">
                <div className="field">
                  <label htmlFor="who">Who did this?</label>
                  <select id="who" value={memberId} onChange={e => setMemberId(e.target.value)} required>
                    <option value="">Choose a teammate</option>
                    {people.map(m => (
                      <option key={m.id} value={m.id}>{m.display_name ?? m.github_login}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="kind">Type of work</label>
                  <select id="kind" value={kind} onChange={e => setKind(e.target.value as ManualKind)}>
                    {KINDS.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="field">
                <label htmlFor="title">What did you do?</label>
                <input id="title" value={title} onChange={e => setTitle(e.target.value)} required maxLength={120}
                  placeholder="e.g. Usability tests on the onboarding prototype" />
              </div>

              <div className="field">
                <label htmlFor="body">Details <span className="optional">(optional)</span></label>
                <textarea id="body" rows={3} value={body} onChange={e => setBody(e.target.value)}
                  placeholder="What came out of it? Findings, decisions, next steps." />
              </div>

              <div className="logform__row">
                <div className="field">
                  <label htmlFor="task">Related task <span className="optional">(optional)</span></label>
                  <select id="task" value={taskId} onChange={e => setTaskId(e.target.value)}>
                    <option value="">Not tied to a task</option>
                    {openTasks.map(t => (
                      <option key={t.id} value={t.id}>#{t.github_issue_number} {t.title}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="link">Link <span className="optional">(optional)</span></label>
                  <input id="link" type="url" value={link} onChange={e => setLink(e.target.value)}
                    placeholder="Figma, Google Doc, notes…" />
                </div>
              </div>

              {error && <p className="logform__error" role="alert">{error}</p>}
              {saved && <p className="logform__saved" role="status">{saved}</p>}
              <div>
                <button type="submit" className="btn btn--primary" disabled={busy}>
                  {busy ? 'Saving…' : 'Add to contributions'}
                </button>
              </div>
            </form>
          </Card>
        </div>

        <div className="split__side">
          <Card title="Recently logged">
            {entries.loading && !entries.data && <Loading />}
            {entries.error && <ErrorState message={entries.error} onRetry={entries.reload} />}
            {entries.data && entries.data.length === 0 && <Empty>Nothing logged yet.</Empty>}
            {entries.data && entries.data.length > 0 && (
              <ul className="logged">
                {entries.data.slice(0, 8).map(e => (
                  <li key={e.id}>
                    <span className="logged__title">
                      {e.link ? <a href={e.link} target="_blank" rel="noreferrer">{e.title}</a> : e.title}
                    </span>
                    <span className="logged__meta">
                      {e.display_name?.split(' ')[0] ?? e.github_login}
                      {e.kind && <> · <Pill>{KIND_LABEL[e.kind] ?? e.kind}</Pill></>}
                      {' · '}{shortDate(e.authored_at)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
