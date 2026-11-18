import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { CalendarClock, Check, ChevronsUpDown, FileText, ListChecks, Monitor, Moon, Plus, Search, Settings2, Sun, User, Users } from 'lucide-react';
import { api } from '../api/client.ts';
import { useApi } from '../hooks/useApi.ts';
import { LogoMark } from '../components/Bulb.tsx';
import { timeAgo } from '../dates.ts';
import { useMe, useTheme, wasAsked, markAsked, type ThemePref } from '../lib/prefs.ts';
import { Avatar, Banner, Button, Kbd } from '../ui/primitives.tsx';
import { Dialog } from '../ui/overlays.tsx';
import { TeamContext, useTeam, daysUntil, firstName, sortedMembers, teamDeadline, type TeamContextValue } from './team.tsx';
import { buildDecisions } from './decisions.ts';
import LogWorkSheet from './LogWorkSheet.tsx';
import CommandPalette from './CommandPalette.tsx';
import AskSheet, { type AskTurn } from './AskSheet.tsx';

const AUTO_SYNC_AFTER_MS = 30 * 60_000;

function isTyping(el: EventTarget | null): boolean {
  const t = el as HTMLElement | null;
  return !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
}

export default function Shell() {
  const teamId = Number(useParams().teamId);
  const base = `/t/${teamId}`;
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [theme, setTheme] = useTheme();
  const [me, setMe] = useMe(teamId);

  const [version, setVersion] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [logMember, setLogMember] = useState<number | undefined>();
  const [collapsed, setCollapsed] = useState(false);
  const [ask, setAsk] = useState<{ open: boolean; initial?: string }>({ open: false });
  const [turns, setTurns] = useState<AskTurn[]>([]);

  const team = useApi(() => api.team(teamId), [teamId, version]);
  const summary = useApi(() => api.summary(teamId), [teamId, version]);
  const tasks = useApi(() => api.tasks(teamId), [teamId, version]);
  const risks = useApi(() => api.risks(teamId), [teamId, version]);
  const suggestions = useApi(() => api.suggestions(teamId), [teamId, version]);

  const reload = useCallback(() => setVersion(v => v + 1), []);
  const syncNow = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try { await api.sync(teamId); setVersion(v => v + 1); }
    catch (e) { setSyncError(e instanceof Error ? e.message : String(e)); }
    finally { setSyncing(false); }
  }, [teamId]);

  // Sync on open when the last sync is old, so nobody has to press a button.
  useEffect(() => { setTurns([]); }, [teamId]);

  const autoSynced = useRef<number | null>(null);
  useEffect(() => {
    const t = team.data;
    if (!t || t.is_demo || autoSynced.current === teamId) return;
    autoSynced.current = teamId;
    const age = t.last_synced_at ? Date.now() - new Date(t.last_synced_at).getTime() : Infinity;
    if (age > AUTO_SYNC_AFTER_MS) void syncNow();
  }, [team.data, teamId, syncNow]);

  // Ask "who are you?" once per device per team.
  useEffect(() => {
    if (summary.data && summary.data.members.length && me === null && !wasAsked(teamId)) setIdentityOpen(true);
  }, [summary.data, me, teamId]);

  const logOpen = params.get('log') === '1';
  const openLog = useCallback((memberId?: number) => {
    setLogMember(memberId);
    setParams(p => { const n = new URLSearchParams(p); n.set('log', '1'); return n; });
  }, [setParams]);
  const closeLog = useCallback(() => setParams(p => { const n = new URLSearchParams(p); n.delete('log'); return n; }, { replace: true }), [setParams]);
  const openIdentity = useCallback(() => setIdentityOpen(true), []);
  const openAsk = useCallback((question?: string) => setAsk({ open: true, initial: question }), []);

  // Global shortcuts: ⌘K, L, S, G then a letter, ⌘\.
  useEffect(() => {
    let pendingG = 0;
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPaletteOpen(o => !o); return; }
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); setCollapsed(c => !c); return; }
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target) || document.querySelector('[aria-modal="true"]')) return;
      const k = e.key.toLowerCase();
      if (Date.now() - pendingG < 1200) {
        pendingG = 0;
        const dest: Record<string, string> = { t: '', p: '/plan', e: '/people', r: '/report', m: '/maestro', s: '/settings' };
        if (k in dest) { e.preventDefault(); navigate(`${base}${dest[k]}`); }
        return;
      }
      if (k === 'g') { pendingG = Date.now(); return; }
      if (k === 'l') { e.preventDefault(); openLog(); }
      else if (k === 's' && team.data && !team.data.is_demo) { e.preventDefault(); void syncNow(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [base, navigate, openLog, syncNow, team.data]);

  const loading = [team, summary, tasks, risks, suggestions].some(s => s.loading && !s.data);
  const error = summary.error ?? team.error;

  const ctx: TeamContextValue = {
    teamId, base, team: team.data, summary: summary.data, tasks: tasks.data, risks: risks.data, suggestions: suggestions.data,
    loading, error, version, reload, syncing, syncError, syncNow, me, setMe, openLog, openIdentity, openAsk,
  };

  const decisions = buildDecisions(risks.data, suggestions.data);
  const anyHigh = decisions.some(d => d.risk?.level === 'high');

  if (team.error && /not found/i.test(team.error)) {
    return <NotFound />;
  }

  return (
    <TeamContext.Provider value={ctx}>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[70] focus:rounded-md focus:bg-fg focus:px-3 focus:py-2 focus:text-canvas">Skip to content</a>
      <div className="flex min-h-dvh">
        <Sidebar collapsed={collapsed} decisions={decisions.length} anyHigh={anyHigh} theme={theme} setTheme={setTheme}
          openPalette={() => setPaletteOpen(true)} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileTopBar openPalette={() => setPaletteOpen(true)} theme={theme} setTheme={setTheme} />
          <main id="main" className="min-w-0 flex-1" key={location.pathname.split('/').slice(0, 4).join('/')}>
            {syncError && (
              <div className="mx-auto max-w-[1120px] px-5 pt-6 md:px-8">
                <Banner action={<Button size="sm" onClick={() => void syncNow()} busy={syncing}>Try again</Button>}>
                  {syncMessage(syncError)}
                </Banner>
              </div>
            )}
            <Outlet />
          </main>
        </div>
        <MobileTabs decisions={decisions.length} />
      </div>
      <LogWorkSheet open={logOpen} onClose={closeLog} initialMember={logMember} />
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} theme={theme} setTheme={setTheme} />
      <AskSheet open={ask.open} initial={ask.initial} onClose={() => setAsk({ open: false })} turns={turns} setTurns={setTurns} />
      <IdentityDialog open={identityOpen} onClose={() => { markAsked(teamId); setIdentityOpen(false); }} />
    </TeamContext.Provider>
  );
}

function syncMessage(err: string): string {
  if (/GITHUB_TOKEN|token/i.test(err)) return 'GitHub sync is off because no access token is set on the server.';
  if (/rate limit/i.test(err)) return 'GitHub asked us to wait before syncing again. Try again in a few minutes.';
  return `Sync failed: ${err}`;
}

/* ── Sidebar (lg: full, md: icon rail) ─────────────────────────────────── */

const NAV = [
  { to: '', label: 'Today', Icon: Sun, end: true },
  { to: '/plan', label: 'Plan', Icon: ListChecks },
  { to: '/people', label: 'People', Icon: Users },
  { to: '/report', label: 'Report', Icon: FileText },
];

function Sidebar({ collapsed, decisions, anyHigh, theme, setTheme, openPalette }: {
  collapsed: boolean; decisions: number; anyHigh: boolean; theme: ThemePref; setTheme: (t: ThemePref) => void; openPalette: () => void;
}) {
  const { base, team, summary, tasks, me, openLog, openAsk, syncing, syncNow } = useTeam();
  const wide = collapsed ? 'hidden' : 'hidden lg:inline';
  const width = collapsed ? 'md:w-14' : 'md:w-14 lg:w-[232px]';
  const deadline = teamDeadline(team, tasks);
  const days = deadline.date ? daysUntil(deadline.date) : null;
  const people = sortedMembers(summary?.members);

  return (
    <aside data-shell className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-line bg-surface-1 px-2.5 py-3 md:flex ${width} ${collapsed ? '' : 'lg:px-3'}`}>
      <TeamMenu theme={theme} setTheme={setTheme} compact={collapsed} />

      <button type="button" onClick={() => openLog()} title="Log work (L)"
        className="mt-3 flex h-9 w-full items-center justify-center gap-2 rounded-md border border-line-strong bg-surface-2 px-2.5 text-label hover:bg-surface-3 lg:justify-between">
        <span className="flex items-center gap-2"><Plus size={16} aria-hidden="true" /><span className={wide}>Log work</span></span>
        <Kbd className={wide}>L</Kbd>
      </button>

      <button type="button" onClick={() => openAsk()} title="Ask Maestro"
        className="mt-1.5 flex h-9 w-full items-center justify-center gap-2 rounded-md px-2.5 text-label text-fg-muted hover:bg-surface-2 hover:text-fg lg:justify-start">
        <LogoMark size={16} /><span className={wide}>Ask Maestro</span>
      </button>

      <nav aria-label="Main" className="mt-3 flex flex-col gap-0.5">
        {NAV.map(n => (
          <NavLink key={n.label} to={`${base}${n.to}`} end={n.end} title={n.label}
            className={({ isActive }) => `flex h-8 items-center justify-center gap-2.5 rounded-md px-2 text-label lg:justify-start ${collapsed ? '!justify-center' : ''} ${isActive ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'}`}>
            <n.Icon size={16} aria-hidden="true" />
            <span className={`${wide} flex-1`}>{n.label}</span>
            {n.label === 'Today' && decisions > 0 && (
              <span className={`${wide} rounded-[4px] px-1.5 text-caption ${anyHigh ? 'bg-risk-high-wash text-risk-high' : 'bg-surface-3 text-fg-muted'}`} aria-label={`${decisions} open decisions`}>{decisions}</span>
            )}
          </NavLink>
        ))}
      </nav>

      {people.length > 0 && (
        <div className="mt-6 flex min-h-0 flex-col">
          <div className={`${wide} px-2 pb-1.5 text-caption tracking-[0.06em] text-fg-subtle uppercase`}>Team</div>
          <div className="flex flex-col gap-0.5 overflow-y-auto">
            {people.map(p => (
              <NavLink key={p.memberId} to={`${base}/people/${p.memberId}`} title={p.displayName}
                className={({ isActive }) => `flex h-8 items-center justify-center gap-2.5 rounded-md px-2 text-label font-normal lg:justify-start ${collapsed ? '!justify-center' : ''} ${isActive ? 'bg-surface-3 text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg'}`}>
                <Avatar name={p.displayName} login={p.login} size={20} />
                <span className={`${wide} min-w-0 flex-1 truncate`}>{firstName(p.displayName)}</span>
                {p.memberId === me && <span className={`${wide} text-caption font-normal text-fg-subtle`}>you</span>}
              </NavLink>
            ))}
          </div>
        </div>
      )}

      <div className="mt-auto flex flex-col gap-1 border-t border-line pt-3">
        {deadline.date && (
          <div title="Team deadline" className={`flex h-7 items-center justify-center gap-2 px-2 text-caption font-normal lg:justify-start ${days !== null && days <= 7 ? 'text-risk-med' : 'text-fg-muted'}`}>
            <CalendarClock size={14} aria-hidden="true" />
            <span className={wide}>Due {new Date(`${deadline.date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · {days} day{days === 1 ? '' : 's'}</span>
          </div>
        )}
        {team && !team.is_demo && (
          <button type="button" onClick={() => void syncNow()} disabled={syncing} title="Sync now (S)"
            className="flex h-7 items-center justify-center gap-2 rounded-md px-2 text-caption font-normal text-fg-muted hover:bg-surface-2 hover:text-fg lg:justify-start" role="status">
            <span className={`mx-1 size-1.5 rounded-full ${syncing ? 'animate-pulse bg-maestro' : 'bg-ok'}`} aria-hidden="true" />
            <span className={wide}>{syncing ? 'Syncing with GitHub…' : team.last_synced_at ? `Synced ${timeAgo(team.last_synced_at)}` : 'Not synced yet'}</span>
          </button>
        )}
        <button type="button" onClick={openPalette} title="Search and commands (⌘K)"
          className="flex h-7 items-center justify-center gap-2 rounded-md px-2 text-caption font-normal text-fg-muted hover:bg-surface-2 hover:text-fg lg:justify-between">
          <span className="flex items-center gap-2"><Search size={14} aria-hidden="true" /><span className={wide}>Search and commands</span></span>
          <span className={`${wide} font-mono text-[11px]`}>⌘K</span>
        </button>
      </div>
    </aside>
  );
}

/* ── Team switcher menu ────────────────────────────────────────────────── */

const THEMES: Array<{ value: ThemePref; label: string; Icon: typeof Sun }> = [
  { value: 'dark', label: 'Dark', Icon: Moon }, { value: 'light', label: 'Light', Icon: Sun }, { value: 'system', label: 'System', Icon: Monitor },
];

function TeamMenu({ theme, setTheme, compact, mobile }: { theme: ThemePref; setTheme: (t: ThemePref) => void; compact?: boolean; mobile?: boolean }) {
  const { base, team, openIdentity, teamId } = useTeam();
  const teams = useApi(() => api.teams(), []);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const wide = compact ? 'hidden' : mobile ? 'inline' : 'hidden lg:inline';
  const item = 'flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-label font-normal text-fg-muted hover:bg-surface-2 hover:text-fg';
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(o => !o)}
        className={`flex h-11 w-full items-center justify-center gap-2.5 rounded-md px-1 text-left hover:bg-surface-2 ${mobile ? 'justify-start' : 'lg:justify-start lg:px-2'}`}>
        <LogoMark size={28} />
        <span className={`${wide} min-w-0 flex-1`}>
          <span className="block truncate text-label">{team?.name ?? 'Maestro'}</span>
          {team && !mobile && <span className="block truncate font-mono text-[11.5px] leading-4 text-fg-muted">{team.repo_owner}/{team.repo_name}</span>}
        </span>
        <ChevronsUpDown size={14} className={`${wide} text-fg-muted`} aria-hidden="true" />
      </button>
      {open && (
        <div role="menu" className="absolute top-12 left-0 z-50 w-64 animate-pop-in rounded-[10px] border border-line-strong bg-surface-1 p-1.5 shadow-[var(--shadow-float)]">
          <div className="px-2 pt-1 pb-1 text-caption text-fg-subtle">Teams</div>
          {(teams.data ?? []).map(t => (
            <Link role="menuitem" key={t.id} to={`/t/${t.id}`} onClick={() => setOpen(false)} className={item}>
              <span className="min-w-0 flex-1 truncate">{t.name}</span>{t.id === teamId && <Check size={14} aria-hidden="true" />}
            </Link>
          ))}
          <Link role="menuitem" to="/?new=1" onClick={() => setOpen(false)} className={item}><Plus size={14} aria-hidden="true" />Connect another repo</Link>
          <div className="my-1.5 h-px bg-line" />
          <Link role="menuitem" to={`${base}/maestro`} onClick={() => setOpen(false)} className={item}><LogoMark size={16} />Maestro</Link>
          <Link role="menuitem" to={`${base}/settings`} onClick={() => setOpen(false)} className={item}><Settings2 size={14} aria-hidden="true" />Settings</Link>
          <button role="menuitem" type="button" onClick={() => { setOpen(false); openIdentity(); }} className={item}><User size={14} aria-hidden="true" />Who am I on this device</button>
          <div className="my-1.5 h-px bg-line" />
          <div className="flex gap-1 px-1 pb-0.5" role="group" aria-label="Theme">
            {THEMES.map(t => (
              <button key={t.value} type="button" aria-pressed={theme === t.value} onClick={() => setTheme(t.value)}
                className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-md text-caption font-normal text-fg-muted hover:bg-surface-2 aria-pressed:bg-surface-3 aria-pressed:text-fg">
                <t.Icon size={13} aria-hidden="true" />{t.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Mobile ────────────────────────────────────────────────────────────── */

function MobileTopBar({ openPalette, theme, setTheme }: { openPalette: () => void; theme: ThemePref; setTheme: (t: ThemePref) => void }) {
  return (
    <div data-shell className="sticky top-0 z-30 flex h-14 items-center justify-between gap-2 border-b border-line bg-canvas/80 px-3 backdrop-blur md:hidden">
      <div className="min-w-0 flex-1"><TeamMenu theme={theme} setTheme={setTheme} mobile /></div>
      <button type="button" onClick={openPalette} aria-label="Search and commands" className="grid size-11 place-items-center rounded-md text-fg-muted hover:bg-surface-2"><Search size={20} /></button>
    </div>
  );
}

function MobileTabs({ decisions }: { decisions: number }) {
  const { base, openLog } = useTeam();
  const tab = ({ isActive }: { isActive: boolean }) => `relative flex h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-medium ${isActive ? 'text-fg' : 'text-fg-muted'}`;
  return (
    <nav data-shell aria-label="Main" className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 items-center border-t border-line bg-surface-1/90 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      <NavLink to={base} end className={tab}><Sun size={20} aria-hidden="true" />Today
        {decisions > 0 && <span className="absolute top-2 left-[calc(50%+6px)] size-2 rounded-full bg-risk-high" aria-label={`${decisions} open decisions`} />}
      </NavLink>
      <NavLink to={`${base}/plan`} className={tab}><ListChecks size={20} aria-hidden="true" />Plan</NavLink>
      <button type="button" onClick={() => openLog()} aria-label="Log work" className="mx-auto grid size-11 place-items-center rounded-full bg-fg text-canvas"><Plus size={20} /></button>
      <NavLink to={`${base}/people`} className={tab}><Users size={20} aria-hidden="true" />People</NavLink>
      <NavLink to={`${base}/report`} className={tab}><FileText size={20} aria-hidden="true" />Report</NavLink>
    </nav>
  );
}

/* ── Identity ──────────────────────────────────────────────────────────── */

function IdentityDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { summary, me, setMe } = useTeam();
  const people = useMemo(() => sortedMembers(summary?.members), [summary]);
  return (
    <Dialog open={open} onClose={onClose} label="Who are you?">
      <h2 className="text-title-2">Which one is you?</h2>
      <p className="mt-1 text-fg-muted">This stays on this device. It fills in &ldquo;Who&rdquo; when you log work and adds a &ldquo;Mine&rdquo; filter. Everyone still sees the same team data.</p>
      <div className="mt-5 grid grid-cols-2 gap-2">
        {people.map(p => (
          <button key={p.memberId} type="button" aria-pressed={me === p.memberId} onClick={() => { setMe(p.memberId); onClose(); }}
            className="flex h-12 items-center gap-2.5 rounded-md border border-line px-3 text-left hover:bg-surface-2 aria-pressed:border-fg">
            <Avatar name={p.displayName} login={p.login} size={24} /><span className="min-w-0 truncate">{p.displayName}</span>
          </button>
        ))}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        {me !== null && <Button variant="ghost" onClick={() => { setMe(null); onClose(); }}>Forget me</Button>}
        <Button variant="ghost" onClick={onClose}>Skip</Button>
      </div>
    </Dialog>
  );
}

function NotFound(): ReactNode {
  return (
    <div className="grid min-h-dvh place-items-center p-6 text-center">
      <div className="flex flex-col items-center gap-3">
        <LogoMark size={48} />
        <h1 className="text-title-2">This team doesn&rsquo;t exist</h1>
        <p className="text-fg-muted">It may have been deleted, or the link is wrong.</p>
        <Link to="/" className="mt-2 inline-flex h-9 items-center rounded-md bg-fg px-3.5 text-label font-semibold text-canvas">Back to your teams</Link>
      </div>
    </div>
  );
}
