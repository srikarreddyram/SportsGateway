import type { Match } from '../types';
import { MatchRow } from './MatchRow';
import { countryFlag } from '../lib/countryFlag';

export function LeagueSection({
  league,
  country,
  matches,
  isFavorite,
  onToggleFavorite,
}: {
  league: string;
  country: string | null;
  matches: Match[];
  isFavorite: boolean;
  onToggleFavorite: () => void;
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-surface">
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <span className="text-sm">{countryFlag(country)}</span>
        <span className="text-xs font-semibold uppercase tracking-wide text-text-muted">{league}</span>
        <button
          onClick={onToggleFavorite}
          aria-label={isFavorite ? 'Unpin league' : 'Pin league'}
          className={`ml-auto text-sm transition-colors ${isFavorite ? 'text-warn' : 'text-text-muted hover:text-text'}`}
        >
          {isFavorite ? '★' : '☆'}
        </button>
      </header>
      <div className="divide-y divide-border/60">
        {matches.map((match) => (
          <MatchRow key={match.matchId} match={match} />
        ))}
      </div>
    </section>
  );
}
