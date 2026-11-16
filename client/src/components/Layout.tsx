import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { api } from '../api/client.ts';
import type { TeamSummary } from '../api/types.ts';
import { useApi } from '../hooks/useApi.ts';
import { timeAgo } from '../dates.ts';
import { LogoMark } from './Bulb.tsx';
import { ArrowLeft, Banner } from './ui.tsx';
import './Layout.scss';

interface TeamContextValue {
  teamId: number;
  summary: TeamSummary | null;
  /** Bumped after every successful sync; pages add it to their data dependencies. */
  version: number;
  syncing: boolean;
  syncNow: () => Promise<void>;
  /** Re-read the sidebar data (risk count, team name) after a change. */
  refresh: () => void;
  /** Re-read every page, the same way a finished sync does. */
  reload: () => void;
}

const TeamContext = createContext<TeamContextValue | null>(null);

export function useTeam(): TeamContextValue {
  const ctx = useContext(TeamContext);
  if (!ctx) throw new Error('useTeam must be used inside <Layout>');
  return ctx;
}

/** Page frame: top bar (title, optional back link/subtitle, sync status) and the content column. */
export function Page({ title, subtitle, back, children }: {
  title: string; subtitle?: string; back?: { to: string; label: string }; children: ReactNode;
}) {
  const { summary, syncing, syncNow } = useTeam();
  const team = summary?.team;

  return (
    <>
      <header className="topbar">
        <div className="topbar__heading">
          {back && <Link to={back.to} className="topbar__back"><ArrowLeft size={16} />{back.label}</Link>}
          <div className="topbar__title-row">
            <h1 className="topbar__title">{title}</h1>
            {team?.isDemo && <span className="pill-muted">Demo data</span>}
          </div>
          {subtitle && <p className="topbar__subtitle">{subtitle}</p>}
        </div>
        {team && !team.isDemo && (
          <div className="topbar__sync">
            <span className="topbar__synced" role="status">
              {syncing ? 'Syncing with GitHub…' : team.lastSyncedAt ? `Synced ${timeAgo(team.lastSyncedAt)}` : 'Not synced yet'}
            </span>
            <button type="button" className="btn btn--secondary" onClick={syncNow} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        )}
      </header>
      <div className="page">{children}</div>
    </>
  );
}

export default function Layout() {
  const teamId = Number(useParams().teamId);
  const { pathname } = useLocation();
  const [version, setVersion] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const summary = useApi(() => api.summary(teamId), [teamId, version]);
  const risks = useApi(() => api.risks(teamId), [teamId, version]);

  const syncNow = useCallback(async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      await api.sync(teamId);
      setVersion(v => v + 1);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncing(false);
    }
  }, [teamId]);

  const refresh = useCallback(() => { summary.reload(); risks.reload(); }, [summary, risks]);
  const reload = useCallback(() => setVersion(v => v + 1), []);

  const base = `/teams/${teamId}`;
  // Member pages are reached from the overview, so keep "Overview" highlighted there.
  const onMemberPage = pathname.startsWith(`${base}/members/`);
  const riskCount = risks.data?.length ?? 0;
  const links = [
    { to: base, label: 'Overview', end: true },
    { to: `${base}/risks`, label: 'Risk radar', count: riskCount },
    { to: `${base}/rebalance`, label: 'Rebalance' },
    { to: `${base}/log`, label: 'Log work' },
    { to: `${base}/settings`, label: 'Team settings', bottom: true },
  ];

  return (
    <TeamContext.Provider value={{ teamId, summary: summary.data, version, syncing, syncNow, refresh, reload }}>
      <div className="shell">
        <aside className="sidebar">
          <div className="sidebar__brand">
            <Link to="/" className="sidebar__wordmark"><LogoMark /><span>Maestro</span></Link>
            {summary.data && <span className="sidebar__team">{summary.data.team.name}</span>}
          </div>
          <nav className="sidebar__nav" aria-label="Main">
            {links.map(l => (
              <NavLink
                key={l.label}
                to={l.to}
                end={l.end}
                className={({ isActive }) =>
                  `nav-item${l.bottom ? ' nav-item--bottom' : ''}${isActive || (l.label === 'Overview' && onMemberPage) ? ' is-active' : ''}`}
              >
                <span>{l.label}</span>
                {!!l.count && <span className="nav-item__count" aria-label={`${l.count} risks`}>{l.count}</span>}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="shell__main">
          {syncError && (
            <div className="shell__banner">
              <Banner action={<button type="button" className="btn btn--secondary" onClick={syncNow} disabled={syncing}>Try again</button>}>
                {syncError}
              </Banner>
            </div>
          )}
          <Outlet />
        </main>
      </div>
    </TeamContext.Provider>
  );
}
