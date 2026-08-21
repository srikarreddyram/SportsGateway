import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Match } from '../types';
import { TeamCrest } from './TeamCrest';
import { kickoffTime } from '../lib/format';

function StatusColumn({ match }: { match: Match }) {
  if (match.status.live) {
    return (
      <div className="flex flex-col items-center gap-0.5 text-live">
        <span className="live-dot h-1.5 w-1.5 rounded-full bg-live" />
        <span className="text-xs font-semibold">{match.status.elapsed ?? 0}'</span>
      </div>
    );
  }
  if (match.status.finished) {
    return <span className="text-xs font-medium text-text-muted">FT</span>;
  }
  return <span className="text-xs font-medium text-text-muted">{kickoffTime(match.kickoff)}</span>;
}

/** Halftime score in small text under the current score, the way a real scores app would. */
function haltimeLabel(match: Match): string | null {
  const { home, away } = match.score.halftime;
  if (home === null || away === null) return null;
  if (!match.status.live && !match.status.finished) return null;
  return `HT ${home}-${away}`;
}

export function MatchRow({ match }: { match: Match }) {
  const { home, away } = match.teams;
  const { home: homeGoals, away: awayGoals } = match.score.current;
  const hasScore = homeGoals !== null && awayGoals !== null;
  const ht = haltimeLabel(match);

  // Flash the score briefly when it changes between polls — the visible signal that a
  // live match just updated, not just a timer that a real observer trusts implicitly.
  const prevScore = useRef<string | null>(null);
  const [flash, setFlash] = useState(false);
  const scoreKey = hasScore ? `${homeGoals}-${awayGoals}` : null;

  useEffect(() => {
    if (scoreKey === null) return;
    const changed = prevScore.current !== null && prevScore.current !== scoreKey;
    prevScore.current = scoreKey;
    if (changed) {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1500);
      return () => clearTimeout(t);
    }
  }, [scoreKey]);

  return (
    <Link
      to={`/match/${match.matchId}`}
      className={`flex items-center gap-4 rounded-lg px-3 py-2.5 transition-colors ${
        flash ? 'bg-live/10' : 'hover:bg-surface-raised'
      }`}
    >
      <div className="w-9 shrink-0 text-center">
        <StatusColumn match={match} />
      </div>

      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <TeamCrest name={home?.name ?? null} />
          <span className={`truncate text-sm ${home?.winner ? 'font-semibold text-text' : 'text-text'}`}>
            {home?.name ?? 'TBD'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <TeamCrest name={away?.name ?? null} />
          <span className={`truncate text-sm ${away?.winner ? 'font-semibold text-text' : 'text-text'}`}>
            {away?.name ?? 'TBD'}
          </span>
        </div>
      </div>

      <div className="shrink-0 text-right">
        <div className={`space-y-1.5 text-sm font-semibold tabular-nums transition-colors ${flash ? 'text-live' : ''}`}>
          <div>{hasScore ? homeGoals : '-'}</div>
          <div>{hasScore ? awayGoals : '-'}</div>
        </div>
        {ht && <div className="mt-1 text-[10px] text-text-muted">{ht}</div>}
      </div>
    </Link>
  );
}
