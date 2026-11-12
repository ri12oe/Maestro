import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Connect from './pages/Connect/Connect.tsx';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Connect />} />
      </Routes>
    </BrowserRouter>
  );
}
