import { NavLink, Outlet, useLocation, useParams } from 'react-router-dom';
import './Layout.scss';

function Logo() {
  return (
    <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true">
      <circle cx="16" cy="16" r="14" fill="none" stroke="currentColor" strokeWidth="2" />
      <path d="M9 16h14M16 9v14" stroke="#8FB4EE" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  );
}

export default function Layout() {
  const { teamId } = useParams();
  const { pathname } = useLocation();
  const base = `/teams/${teamId}`;
  // Member pages are reached from the overview, so keep "Overview" highlighted there.
  const onMemberPage = pathname.startsWith(`${base}/members/`);
  const links = [
    { to: base, label: 'Overview', end: true },
    { to: `${base}/risks`, label: 'Risk radar' },
    { to: `${base}/rebalance`, label: 'Rebalance' },
    { to: `${base}/log`, label: 'Log work' },
    { to: '/', label: 'Team settings', end: true },
  ];

  return (
    <div className="layout">
      <nav className="layout__nav" aria-label="Main">
        <div className="layout__brand">
          <Logo />
          <span>Referee</span>
        </div>
        {links.map(l => (
          <NavLink
            key={l.label}
            to={l.to}
            end={l.end}
            className={({ isActive }) =>
              `layout__link${isActive || (l.label === 'Overview' && onMemberPage) ? ' is-active' : ''}`}
          >
            {l.label}
          </NavLink>
        ))}
      </nav>
      <main className="layout__main">
        <div className="layout__content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
