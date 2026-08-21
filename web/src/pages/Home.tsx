import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { CacheMeta, Match } from '../types';
import { DateStrip } from '../components/DateStrip';
import { LeagueSection } from '../components/LeagueSection';
import { CacheBadge } from '../components/CacheBadge';
import { FilterChips, type MatchFilter } from '../components/FilterChips';
import { LeagueSectionSkeleton } from '../components/Skeletons';
import { LiveSidebar } from '../components/LiveSidebar';
import { useFavoriteLeagues } from '../hooks/useFavoriteLeagues';
import { todayISO } from '../lib/format';

const LIVE_POLL_MS = 8000;
const IDLE_POLL_MS = 30000;

export function Home() {
  const [date, setDate] = useState(todayISO());
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [meta, setMeta] = useState<CacheMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<MatchFilter>('all');
  const { isFavorite, toggle } = useFavoriteLeagues();

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    // Only the first fetch for a newly selected date should clear the board back to a
    // skeleton — the recurring polls after it must not, or the list would flicker back
    // to "loading" every 8-30s during normal live polling. Calling setState directly
    // from inside this async function (rather than synchronously in the effect body)
    // also avoids chaining an extra render onto the effect's own commit.
    let isFirstLoadForThisDate = true;

    const load = async () => {
      if (isFirstLoadForThisDate) {
        isFirstLoadForThisDate = false;
        setMatches(null);
      }
      try {
        const { data, meta: m } = await api.fixtures(date);
        if (cancelled) return;
        setMatches(data.matches);
        setMeta(m);
        setError(null);
        // A day with no live matches (a past date, or a future one nothing has kicked
        // off on yet) doesn't need the aggressive poll the live scenario needs.
        const hasLive = data.matches.some((m2) => m2.status.live);
        timer = setTimeout(load, hasLive ? LIVE_POLL_MS : IDLE_POLL_MS);
      } catch (err) {
        if (cancelled) return;
        // A 404 from the gateway here just means the mock provider had no fixtures for
        // this date's seed, not a real failure — treat it as an empty day.
        if (err instanceof ApiError && err.status === 404) {
          setMatches([]);
          setError(null);
        } else {
          setError(err instanceof Error ? err.message : 'Failed to load fixtures');
        }
        timer = setTimeout(load, IDLE_POLL_MS);
      }
    };

    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [date]);

  const liveCount = matches?.filter((m) => m.status.live).length ?? 0;

  const grouped = useMemo(() => {
    const filtered = (matches ?? []).filter((m) => (filter === 'live' ? m.status.live : true));
    const byLeague = new Map<string, { country: string | null; matches: Match[] }>();
    for (const match of filtered) {
      const key = match.league?.name ?? 'Other';
      if (!byLeague.has(key)) byLeague.set(key, { country: match.league?.country ?? null, matches: [] });
      byLeague.get(key)!.matches.push(match);
    }
    // Pinned leagues surface first, mirroring how a real scores app treats followed leagues.
    return [...byLeague.entries()].sort(
      ([a], [b]) => Number(isFavorite(b)) - Number(isFavorite(a)) || a.localeCompare(b),
    );
  }, [matches, filter, isFavorite]);

  return (
    <div className="mx-auto flex max-w-5xl gap-6 px-4 py-6">
      <div className="min-w-0 flex-1 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <DateStrip date={date} onChange={setDate} />
          {meta && <CacheBadge meta={meta} />}
        </div>

        <FilterChips value={filter} onChange={setFilter} liveCount={liveCount} />

        {error && <p className="rounded-lg border border-warn/30 bg-warn/10 px-3 py-2 text-sm text-warn">{error}</p>}

        {matches === null && !error && (
          <div className="space-y-4">
            <LeagueSectionSkeleton />
            <LeagueSectionSkeleton />
          </div>
        )}

        {matches?.length === 0 && !error && <p className="px-3 text-sm text-text-muted">No fixtures for this date.</p>}

        {matches && matches.length > 0 && grouped.length === 0 && (
          <p className="px-3 text-sm text-text-muted">No live matches right now.</p>
        )}

        <div className="space-y-4">
          {grouped.map(([league, { country, matches: leagueMatches }]) => (
            <LeagueSection
              key={league}
              league={league}
              country={country}
              matches={leagueMatches}
              isFavorite={isFavorite(league)}
              onToggleFavorite={() => toggle(league)}
            />
          ))}
        </div>
      </div>

      <LiveSidebar />
    </div>
  );
}
