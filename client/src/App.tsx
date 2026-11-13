import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Connect from './pages/Connect/Connect.tsx';
import Layout from './components/Layout.tsx';
import Overview from './pages/Overview/Overview.tsx';
import MemberEvidence from './pages/MemberEvidence/MemberEvidence.tsx';
import ComingSoon from './pages/ComingSoon/ComingSoon.tsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Connect />} />
        <Route path="/teams/:teamId" element={<Layout />}>
          <Route index element={<Overview />} />
          <Route path="members/:memberId" element={<MemberEvidence />} />
          <Route path="risks" element={<ComingSoon title="Risk radar" />} />
          <Route path="rebalance" element={<ComingSoon title="Rebalance suggestions" />} />
          <Route path="log" element={<ComingSoon title="Log work" />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
