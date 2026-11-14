import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Setup from './pages/Setup/Setup.tsx';
import Layout from './components/Layout.tsx';
import Overview from './pages/Overview/Overview.tsx';
import MemberEvidence from './pages/MemberEvidence/MemberEvidence.tsx';
import RiskRadar from './pages/RiskRadar/RiskRadar.tsx';
import Rebalance from './pages/Rebalance/Rebalance.tsx';
import LogWork from './pages/LogWork/LogWork.tsx';
import TeamSettings from './pages/TeamSettings/TeamSettings.tsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Setup />} />
        <Route path="/teams/:teamId" element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="members/:memberId" element={<MemberEvidence />} />
          <Route path="risks" element={<RiskRadar />} />
          <Route path="rebalance" element={<Rebalance />} />
          <Route path="log" element={<LogWork />} />
          <Route path="settings" element={<TeamSettings />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
