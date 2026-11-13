import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Connect from './pages/Connect/Connect.tsx';
import Layout from './components/Layout.tsx';
import Overview from './pages/Overview/Overview.tsx';
import MemberEvidence from './pages/MemberEvidence/MemberEvidence.tsx';
import RiskRadar from './pages/RiskRadar/RiskRadar.tsx';
import Rebalance from './pages/Rebalance/Rebalance.tsx';
import LogWork from './pages/LogWork/LogWork.tsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Connect />} />
        <Route path="/teams/:teamId" element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="members/:memberId" element={<MemberEvidence />} />
          <Route path="risks" element={<RiskRadar />} />
          <Route path="rebalance" element={<Rebalance />} />
          <Route path="log" element={<LogWork />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
