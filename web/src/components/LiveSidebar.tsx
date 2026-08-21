import { Link } from 'react-router-dom';
import { useLiveTicker } from '../context/liveTicker';
import { TeamCrest } from './TeamCrest';

export function LiveSidebar() {
  const { liveMatches, loading } = useLiveTicker();

  return (
    <aside className="hidden w-72 shrink-0 lg:block">
      <div className="sticky top-20 overflow-hidden rounded-xl border border-border bg-surface">
        <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <span className="live-dot h-1.5 w-1.5 rounded-full bg-live" />
          <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">Live right now</span>
        </header>

        {loading && <p className="px-3 py-4 text-xs text-text-muted">Loading…</p>}

        {!loading && liveMatches.length === 0 && (
          <p className="px-3 py-4 text-xs text-text-muted">Nothing live at the moment.</p>
        )}

        <div className="divide-y divide-border/60">
          {liveMatches.map((match) => (
            <Link
              key={match.matchId}
              to={`/match/${match.matchId}`}
              className="flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-surface-raised"
            >
              <span className="w-6 shrink-0 font-semibold text-live">{match.status.elapsed}'</span>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-1.5 truncate">
                  <TeamCrest name={match.teams.home?.name ?? null} size={16} />
                  <span className="truncate">{match.teams.home?.name}</span>
                </div>
                <div className="flex items-center gap-1.5 truncate">
                  <TeamCrest name={match.teams.away?.name ?? null} size={16} />
                  <span className="truncate">{match.teams.away?.name}</span>
                </div>
              </div>
              <div className="shrink-0 text-right font-semibold tabular-nums">
                <div>{match.score.current.home}</div>
                <div>{match.score.current.away}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </aside>
  );
}
