import { Route, Routes } from 'react-router-dom';
import { Header } from './components/Header';
import { Home } from './pages/Home';
import { MatchDetail } from './pages/MatchDetail';
import { PlayerDetail } from './pages/PlayerDetail';
import { NotFound } from './pages/NotFound';
import { LiveTickerProvider } from './context/LiveTickerContext';

export function App() {
  return (
    <LiveTickerProvider>
      <div className="min-h-full">
        <Header />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/match/:matchId" element={<MatchDetail />} />
          <Route path="/player/:playerId" element={<PlayerDetail />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </LiveTickerProvider>
  );
}
