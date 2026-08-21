import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveTicker } from '../context/liveTicker';

/**
 * The gateway has no text-search endpoint (players/matches are looked up by id), so
 * this jumps straight to a match or player id rather than pretending to search.
 */
type JumpKind = 'match' | 'player';

export function Header() {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<JumpKind>('match');
  const navigate = useNavigate();
  const { liveMatches } = useLiveTicker();

  const jump = (e: FormEvent) => {
    e.preventDefault();
    const id = query.trim();
    if (!/^\d+$/.test(id)) return;
    navigate(kind === 'match' ? `/match/${id}` : `/player/${id}`);
    setQuery('');
  };

  return (
    <header className="sticky top-0 z-10 border-b border-border bg-bg/95 backdrop-blur">
      <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
        <Link to="/" className="flex items-center gap-2 text-lg font-bold tracking-tight">
          <span className="live-dot inline-block h-2 w-2 rounded-full bg-live" />
          SportsGateway
        </Link>
        {liveMatches.length > 0 && (
          <span className="hidden items-center gap-1 rounded-full bg-live/15 px-2 py-0.5 text-[11px] font-semibold text-live sm:inline-flex">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-live" />
            {liveMatches.length} LIVE
          </span>
        )}
        <form onSubmit={jump} className="ml-auto flex items-center gap-1.5">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as JumpKind)}
            className="rounded-full border border-border bg-surface px-2 py-1.5 text-xs text-text-muted focus:outline-none"
          >
            <option value="match">Match</option>
            <option value="player">Player</option>
          </select>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Jump to id…"
            inputMode="numeric"
            className="w-28 rounded-full border border-border bg-surface px-3 py-1.5 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none sm:w-40"
          />
        </form>
      </div>
    </header>
  );
}
