import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { CacheMeta, Match } from '../types';
import { CacheBadge } from '../components/CacheBadge';
import { TeamCrest } from '../components/TeamCrest';
import { countryFlag } from '../lib/countryFlag';
import { fullKickoff } from '../lib/format';

const LIVE_REFRESH_MS = 5000;

function InfoRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex items-center justify-between border-b border-border/60 px-4 py-2.5 text-sm last:border-b-0">
      <span className="text-text-muted">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div className="h-4 w-20 animate-pulse rounded bg-surface-raised" />
      <div className="h-56 animate-pulse rounded-2xl bg-surface" />
      <div className="h-32 animate-pulse rounded-xl bg-surface" />
    </div>
  );
}

export function MatchDetail() {
  const { matchId } = useParams<{ matchId: string }>();
  const [match, setMatch] = useState<Match | null>(null);
  const [meta, setMeta] = useState<CacheMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!matchId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const load = async () => {
      try {
        const { data, meta: m } = await api.match(matchId);
        if (cancelled) return;
        setMatch(data.match);
        setMeta(m);
        setError(null);
        // Only re-poll while the match is actually live — a finished match's cache TTL
        // is measured in hours, so hammering it here would be pointless.
        if (data.match.status.live) timer = setTimeout(load, LIVE_REFRESH_MS);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load match');
      }
    };

    load();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [matchId]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-10 text-center">
        <p className="text-sm text-warn">{error}</p>
        <Link to="/" className="mt-4 inline-block text-sm text-accent hover:underline">
          Back to fixtures
        </Link>
      </div>
    );
  }

  if (!match) return <DetailSkeleton />;

  const { home, away } = match.teams;
  const { home: homeGoals, away: awayGoals } = match.score.current;
  const ht = match.score.halftime;
  const hasHt = ht.home !== null && ht.away !== null && (match.status.live || match.status.finished);

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-8">
      <Link to="/" className="text-sm text-text-muted hover:text-text">
        ← Fixtures
      </Link>

      <div className="rounded-2xl border border-border bg-surface p-8">
        <div className="mb-6 flex items-center justify-center gap-2 text-sm text-text-muted">
          {match.status.live ? (
            <span className="flex items-center gap-1.5 text-live">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-live" />
              {match.status.elapsed}' · {match.status.description}
            </span>
          ) : (
            <span>
              {match.status.finished ? 'Full time' : fullKickoff(match.kickoff)} · {match.status.description}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 items-center gap-4">
          <div className="flex flex-col items-center gap-3 text-center">
            <TeamCrest name={home?.name ?? null} size={56} />
            <span className={`text-sm ${home?.winner ? 'font-semibold' : ''}`}>{home?.name ?? 'TBD'}</span>
          </div>
          <div className="text-center">
            <div className="text-4xl font-bold tabular-nums">
              {homeGoals ?? '-'} : {awayGoals ?? '-'}
            </div>
            {hasHt && (
              <div className="mt-1 text-xs text-text-muted">
                HT {ht.home}-{ht.away}
              </div>
            )}
          </div>
          <div className="flex flex-col items-center gap-3 text-center">
            <TeamCrest name={away?.name ?? null} size={56} />
            <span className={`text-sm ${away?.winner ? 'font-semibold' : ''}`}>{away?.name ?? 'TBD'}</span>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-surface">
        <div className="flex items-center justify-between px-4 py-2.5 text-sm">
          <span className="flex items-center gap-1.5 text-text-muted">
            {countryFlag(match.league?.country ?? null)} {match.league?.name}
            {match.league?.country ? ` · ${match.league.country}` : ''}
          </span>
          {meta && <CacheBadge meta={meta} />}
        </div>
        <InfoRow label="Round" value={match.league?.round ?? null} />
        <InfoRow label="Kickoff" value={fullKickoff(match.kickoff)} />
        <InfoRow
          label="Venue"
          value={match.venue ? `${match.venue.name ?? ''}${match.venue.city ? `, ${match.venue.city}` : ''}` : null}
        />
        <InfoRow label="Referee" value={match.referee} />
      </div>
    </div>
  );
}
