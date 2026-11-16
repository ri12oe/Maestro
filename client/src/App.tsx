import { BrowserRouter, Navigate, Route, Routes, useParams } from 'react-router-dom';
import Shell from './app/Shell.tsx';
import Start from './pages/Start.tsx';
import Today from './pages/Today.tsx';
import Plan from './pages/Plan.tsx';
import People from './pages/People.tsx';
import Report from './pages/Report.tsx';
import MaestroPage from './pages/MaestroPage.tsx';
import Settings from './pages/Settings.tsx';
import { ToastProvider } from './ui/overlays.tsx';

/** Old /teams/:id/... links keep working. */
function LegacyRedirect() {
  const { teamId, '*': rest = '' } = useParams();
  const map: Record<string, string> = { '': '', risks: '', rebalance: '', log: '?log=1', settings: '/settings' };
  const member = /^members\/(\d+)/.exec(rest);
  const to = member ? `/people/${member[1]}` : (map[rest] ?? '');
  return <Navigate to={`/t/${teamId}${to}`} replace />;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <Routes>
          <Route path="/" element={<Start />} />
          <Route path="/t/:teamId" element={<Shell />}>
            <Route index element={<Today />} />
            <Route path="plan" element={<Plan />} />
            <Route path="plan/:issue" element={<Plan />} />
            <Route path="people" element={<People />} />
            <Route path="people/:memberId" element={<People />} />
            <Route path="report" element={<Report />} />
            <Route path="maestro" element={<MaestroPage />} />
            <Route path="settings" element={<Settings />} />
            <Route path="settings/:section" element={<Settings />} />
          </Route>
          <Route path="/teams/:teamId/*" element={<LegacyRedirect />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ToastProvider>
    </BrowserRouter>
  );
}
