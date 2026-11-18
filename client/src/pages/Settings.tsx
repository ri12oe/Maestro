import { useEffect, useId, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, useNavigate, useParams } from 'react-router';
import { Monitor, Moon, Sun, X } from 'lucide-react';
import { api } from '../api/client.ts';
import { useApi } from '../hooks/useApi.ts';
import { timeAgo } from '../dates.ts';
import { useTheme, type ThemePref } from '../lib/prefs.ts';
import { longDate, teamDeadline, useTeam } from '../app/team.tsx';
import { Dialog, useToast } from '../ui/overlays.tsx';
import { Avatar, Badge, Button, Page, PageHeader, inputClass } from '../ui/primitives.tsx';

const SECTIONS = [
  { id: 'general', label: 'General' }, { id: 'members', label: 'Members' }, { id: 'deadline', label: 'Deadline' },
  { id: 'report', label: 'Report' }, { id: 'appearance', label: 'Appearance' }, { id: 'danger', label: 'Danger zone' },
] as const;
type SectionId = typeof SECTIONS[number]['id'];

function message(e: unknown) { return e instanceof Error ? e.message : String(e); }

export default function Settings() {
  const { base } = useTeam();
  const section = (useParams().section ?? 'general') as SectionId;
  const current = SECTIONS.some(s => s.id === section) ? section : 'general';
  return (
    <Page width="max-w-[960px]">
      <PageHeader title="Settings" subtitle="These settings are shared with the whole team." />
      <div className="grid gap-8 md:grid-cols-[180px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="flex gap-1 overflow-x-auto md:flex-col md:overflow-visible">
          {SECTIONS.map(s => (
            <NavLink key={s.id} to={`${base}/settings/${s.id}`} replace
              className={() => `flex h-8 shrink-0 items-center rounded-md px-2.5 text-label ${current === s.id ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'}`}>
              {s.label}
            </NavLink>
          ))}
        </nav>
        <div className="min-w-0">
          {current === 'general' && <General />}
          {current === 'members' && <Members />}
          {current === 'deadline' && <Deadline />}
          {current === 'report' && <ReportSetting />}
          {current === 'appearance' && <Appearance />}
          {current === 'danger' && <Danger />}
        </div>
      </div>
    </Page>
  );
}

function Section({ title, children, danger }: { title: string; children: ReactNode; danger?: boolean }) {
  return (
    <section className={`rounded-[10px] border bg-surface-1 px-5 ${danger ? 'border-risk-high/30' : 'border-line'}`}>
      <h2 className="pt-5 text-title-3">{title}</h2>
      <div className="divide-y divide-line">{children}</div>
    </section>
  );
}

function Row({ label, help, children }: { label: ReactNode; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-3 py-5 md:grid-cols-[minmax(0,1fr)_minmax(0,320px)] md:gap-6">
      <div><div className="text-label">{label}</div>{help && <p className="mt-0.5 text-label font-normal text-fg-muted">{help}</p>}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function General() {
  const { team, syncNow, syncing, syncError } = useTeam();
  return (
    <Section title="General">
      <Row label="Team name"><span className="text-fg">{team?.name}</span></Row>
      <Row label="Repository" help="Maestro reads commits and Issues from this repository.">
        <a className="font-mono text-code underline underline-offset-[3px]" href={team ? `https://github.com/${team.repo_owner}/${team.repo_name}` : '#'} target="_blank" rel="noreferrer">
          {team ? `${team.repo_owner}/${team.repo_name}` : '—'}
        </a>
      </Row>
      {team && !team.is_demo && (
        <Row label="GitHub sync" help={syncError ? <span className="text-risk-high">{syncError}</span> : team.last_synced_at ? `Last synced ${timeAgo(team.last_synced_at)}.` : 'Not synced yet.'}>
          <Button onClick={() => void syncNow()} busy={syncing}>Sync now</Button>
        </Row>
      )}
    </Section>
  );
}

function Members() {
  const { teamId, version, reload } = useTeam();
  const members = useApi(() => api.members(teamId), [teamId, version]);
  const [login, setLogin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);
  const inputId = useId();

  async function add(e: FormEvent) {
    e.preventDefault();
    const value = login.trim().replace(/^@/, '');
    if (!value) { setError('Enter a GitHub username.'); return; }
    setBusy(true); setError(null);
    try { await api.addMember(teamId, value); setLogin(''); members.reload(); reload(); }
    catch (err) { setError(message(err)); }
    finally { setBusy(false); }
  }

  return (
    <Section title="Members">
      <div className="py-4">
        <ul className="flex list-none flex-col">
          {(members.data ?? []).slice().sort((a, b) => (a.display_name ?? a.github_login ?? '').localeCompare(b.display_name ?? b.github_login ?? '')).map(m => {
            const name = m.display_name ?? m.github_login ?? 'Unknown';
            return (
              <li key={m.id} className="flex h-12 items-center gap-3 border-b border-line last:border-b-0">
                <Avatar name={name} login={m.github_login} />
                <span className="min-w-0 flex-1 truncate">{name}{m.github_login && <span className="ml-2 font-mono text-[12px] text-fg-muted">@{m.github_login}</span>}</span>
                <Button variant="ghost" size="sm" aria-label={`Remove ${name}`} busy={removing === m.id}
                  onClick={async () => { setRemoving(m.id); try { await api.removeMember(teamId, m.id); members.reload(); reload(); } catch (err) { setError(message(err)); } finally { setRemoving(null); } }}>
                  <X size={14} aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ul>
      </div>
      <form onSubmit={add} className="flex flex-col gap-1.5 py-5" noValidate>
        <label htmlFor={inputId} className="text-label">Add by GitHub username</label>
        <div className="flex gap-2">
          <input id={inputId} className={inputClass} value={login} onChange={e => setLogin(e.target.value)} placeholder="octocat" aria-invalid={!!error} />
          <Button type="submit" busy={busy}>Add</Button>
        </div>
        {error && <p className="text-caption font-normal text-risk-high" role="alert">{error}</p>}
        <p className="text-caption font-normal text-fg-muted">People who commit to the repo are added automatically on sync.</p>
      </form>
    </Section>
  );
}

function Deadline() {
  const { teamId, team, tasks, reload } = useTeam();
  const toast = useToast();
  const [draft, setDraft] = useState(team?.deadline ?? '');
  const [busy, setBusy] = useState<'save' | 'clear' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  useEffect(() => { setDraft(team?.deadline ?? ''); }, [team?.deadline]);
  const milestone = teamDeadline(team ? { ...team, deadline: null } : null, tasks);
  const dirty = (draft || null) !== (team?.deadline ?? null);

  async function persist(value: string | null, kind: 'save' | 'clear') {
    setBusy(kind); setError(null);
    try {
      await api.setDeadline(teamId, value);
      try { await api.classify(teamId); } catch { /* risk refresh is best effort */ }
      reload();
      toast.show(value ? `Deadline set to ${longDate(value)}.` : 'Deadline cleared. Maestro uses milestone dates.');
    } catch (err) { setError(message(err)); }
    finally { setBusy(null); }
  }

  return (
    <Section title="Deadline">
      <Row label="Team deadline" help="Risk uses this date. Without it, Maestro uses each task’s GitHub milestone due date.">
        <form className="flex flex-col gap-2" onSubmit={e => { e.preventDefault(); if (draft && dirty) void persist(draft, 'save'); }}
          onKeyDown={e => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') { e.preventDefault(); if (draft && dirty) void persist(draft, 'save'); } }}>
          <label htmlFor={id} className="sr-only">Team deadline</label>
          <input id={id} type="date" className={inputClass} value={draft} onChange={e => setDraft(e.target.value)} />
          {error && <p className="text-caption font-normal text-risk-high" role="alert">{error}</p>}
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={!draft || !dirty} busy={busy === 'save'}>Save</Button>
            {team?.deadline && <Button variant="ghost" onClick={() => void persist(null, 'clear')} busy={busy === 'clear'}>Use milestone dates</Button>}
          </div>
          {!team?.deadline && <p className="text-caption font-normal text-fg-muted">{milestone.date ? `Now using the latest milestone: ${longDate(milestone.date)}.` : 'No milestone due dates on GitHub yet.'}</p>}
        </form>
      </Row>
    </Section>
  );
}

function ReportSetting() {
  const { teamId, team, reload } = useTeam();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const on = !!team?.report_enabled;
  return (
    <Section title="Report">
      <Row label="Allow project report" help="A record of everyone’s work for peer evaluations. Anyone on the team can turn it on or off; everyone sees the same report.">
        <div className="flex items-center gap-3">
          <button type="button" role="switch" aria-checked={on} disabled={busy || !team}
            onClick={async () => { setBusy(true); try { await api.setReportEnabled(teamId, !on); reload(); toast.show(on ? 'Project report turned off.' : 'Project report turned on.'); } catch (e) { toast.show(message(e)); } finally { setBusy(false); } }}
            className={`relative h-6 w-10 rounded-full transition-colors ${on ? 'bg-fg' : 'bg-surface-3 ring-1 ring-line-strong ring-inset'}`}>
            <span className={`absolute top-0.5 size-5 rounded-full transition-transform duration-200 ${on ? 'translate-x-[18px] bg-canvas' : 'translate-x-0.5 bg-fg-muted'}`} />
            <span className="sr-only">Allow project report</span>
          </button>
          <Badge tone={on ? 'ok' : 'neutral'}>{on ? 'On' : 'Off'}</Badge>
        </div>
      </Row>
    </Section>
  );
}

const THEMES: Array<{ value: ThemePref; label: string; Icon: typeof Sun }> = [
  { value: 'dark', label: 'Dark', Icon: Moon }, { value: 'light', label: 'Light', Icon: Sun }, { value: 'system', label: 'System', Icon: Monitor },
];

function Appearance() {
  const [theme, setTheme] = useTheme();
  return (
    <Section title="Appearance">
      <Row label="Theme" help="Saved on this device only.">
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Theme">
          {THEMES.map(t => (
            <button key={t.value} type="button" role="radio" aria-checked={theme === t.value} onClick={() => setTheme(t.value)}
              className="flex flex-col items-center gap-2 rounded-lg border border-line p-3 text-label hover:bg-surface-2 aria-checked:border-fg">
              <span className={`grid h-12 w-full place-items-center rounded-md ${t.value === 'light' ? 'bg-[#FAF9F7] text-[#1A1917]' : t.value === 'dark' ? 'bg-[#0F0E0D] text-[#EDEBE7]' : 'bg-[linear-gradient(90deg,#0F0E0D_50%,#FAF9F7_50%)] text-fg-muted'}`}>
                <t.Icon size={16} aria-hidden="true" />
              </span>
              {t.label}
            </button>
          ))}
        </div>
      </Row>
    </Section>
  );
}

function Danger() {
  const { teamId, team } = useTeam();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  return (
    <Section title="Danger zone" danger>
      <Row label="Delete team" help="Removes this team and everything Maestro recorded about it. The GitHub repository is not touched.">
        <Button variant="danger" onClick={() => { setTyped(''); setOpen(true); }}>Delete team</Button>
      </Row>
      <Dialog open={open} onClose={() => setOpen(false)} label="Delete team">
        <h2 className="text-title-2">Delete {team?.name}?</h2>
        <p className="mt-1 text-fg-muted">This can&rsquo;t be undone. Type the team name to confirm.</p>
        <label htmlFor={id} className="sr-only">Team name</label>
        <input id={id} className={`${inputClass} mt-4`} value={typed} onChange={e => setTyped(e.target.value)} placeholder={team?.name} data-autofocus />
        {error && <p className="mt-2 text-caption font-normal text-risk-high" role="alert">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="danger" disabled={typed !== team?.name} busy={busy}
            onClick={async () => { setBusy(true); try { await api.deleteTeam(teamId); navigate('/', { replace: true }); } catch (e) { setError(message(e)); setBusy(false); } }}>Delete team</Button>
        </div>
      </Dialog>
    </Section>
  );
}
