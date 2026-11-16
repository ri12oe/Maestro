import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import { api } from '../api/client.ts';
import type { TeamSummary } from '../api/types.ts';
import { useApi } from '../hooks/useApi.ts';
import { timeAgo } from '../dates.ts';
import { LogoMark } from './Bulb.tsx';
import { ArrowLeft, Banner, secondaryBtnClass } from './ui.tsx';

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
      <header className="flex flex-col items-stretch gap-3 px-5 pb-2 pt-5 md:flex-row md:items-center md:gap-6 md:border-b md:border-neutral md:px-8 md:py-5">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {back && (
            <Link to={back.to} className="inline-flex items-center gap-1.5 self-start pb-1 text-muted hover:text-base-content">
              <ArrowLeft size={16} />{back.label}
            </Link>
          )}
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-page">{title}</h1>
            {team?.isDemo && (
              <span className="whitespace-nowrap rounded-full bg-base-300 px-2.5 py-[3px] text-badge text-muted">Demo data</span>
            )}
          </div>
          {subtitle && <p className="text-muted">{subtitle}</p>}
        </div>
        {team && !team.isDemo && (
          <div className="flex items-center gap-4">
            <span className="whitespace-nowrap text-muted" role="status">
              {syncing ? 'Syncing with GitHub…' : team.lastSyncedAt ? `Synced ${timeAgo(team.lastSyncedAt)}` : 'Not synced yet'}
            </span>
            <button type="button" className={secondaryBtnClass} onClick={syncNow} disabled={syncing}>
              {syncing ? 'Syncing…' : 'Sync now'}
            </button>
          </div>
        )}
      </header>
      <div className="flex w-full max-w-[1104px] flex-col gap-4 p-5 md:gap-6 md:p-8">{children}</div>
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
      <div className="grid min-h-screen w-full grid-cols-1 md:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="static flex h-auto min-w-0 flex-col gap-3 border-b border-neutral bg-base-100 px-0 pt-3 md:sticky md:top-0 md:h-screen md:gap-6 md:border-b-0 md:border-r md:px-4 md:py-6">
          <div className="flex flex-row items-center gap-3 px-5 md:flex-col md:items-start md:gap-1 md:px-3">
            <Link to="/" className="inline-flex items-center gap-3 text-wordmark"><LogoMark /><span>Maestro</span></Link>
            {summary.data && <span className="text-muted">{summary.data.team.name}</span>}
          </div>
          <nav className="flex flex-row gap-2 overflow-x-auto px-5 pb-3 [scrollbar-width:none] md:flex-1 md:flex-col md:gap-1 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden" aria-label="Main">
            {links.map(l => (
              <NavLink
                key={l.label}
                to={l.to}
                end={l.end}
                className={({ isActive }) => {
                  const active = isActive || (l.label === 'Overview' && onMemberPage);
                  return [
                    'flex shrink-0 items-center justify-between gap-2 rounded-full border border-neutral px-[14px] text-label min-h-9',
                    'hover:text-base-content',
                    'md:min-h-11 md:rounded-control md:border-0 md:px-3',
                    l.bottom ? 'md:mt-auto' : '',
                    active ? 'bg-base-300 text-base-content' : 'text-muted',
                  ].filter(Boolean).join(' ');
                }}
              >
                <span>{l.label}</span>
                {!!l.count && <span className="min-w-5 rounded-full bg-risk-high-bg px-[7px] py-0.5 text-center text-badge text-error" aria-label={`${l.count} risks`}>{l.count}</span>}
              </NavLink>
            ))}
          </nav>
        </aside>

        <main className="flex min-w-0 flex-col">
          {syncError && (
            <div className="max-w-[1104px] px-5 pt-4 md:px-8 md:pt-6">
              <Banner action={<button type="button" className={secondaryBtnClass} onClick={syncNow} disabled={syncing}>Try again</button>}>
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
