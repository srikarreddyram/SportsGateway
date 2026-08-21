import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';
import type { CacheMeta, Player } from '../types';
import { CacheBadge } from '../components/CacheBadge';
import { TeamCrest } from '../components/TeamCrest';

function DetailSkeleton() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <div className="h-4 w-20 animate-pulse rounded bg-surface-raised" />
      <div className="h-24 animate-pulse rounded-2xl bg-surface" />
      <div className="h-32 animate-pulse rounded-xl bg-surface" />
    </div>
  );
}

export function PlayerDetail() {
  const { playerId } = useParams<{ playerId: string }>();
  const [player, setPlayer] = useState<Player | null>(null);
  const [meta, setMeta] = useState<CacheMeta | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!playerId) return;
    let cancelled = false;
    api
      .player(playerId)
      .then(({ data, meta: m }) => {
        if (cancelled) return;
        setPlayer(data.player);
        setMeta(m);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load player');
      });
    return () => {
      cancelled = true;
    };
  }, [playerId]);

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

  if (!player) return <DetailSkeleton />;

  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <Link to="/" className="text-sm text-text-muted hover:text-text">
        ← Fixtures
      </Link>

      <div className="flex items-center gap-4 rounded-2xl border border-border bg-surface p-6">
        <TeamCrest name={player.name} size={56} />
        <div>
          <h1 className="text-lg font-semibold">{player.name}</h1>
          <p className="text-sm text-text-muted">
            {player.nationality} · Age {player.age} · {player.height} · {player.weight}
          </p>
        </div>
        {meta && (
          <div className="ml-auto">
            <CacheBadge meta={meta} />
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="w-full min-w-[420px] text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-text-muted">
              <th className="px-4 py-2 font-medium">Team</th>
              <th className="px-4 py-2 font-medium">Apps</th>
              <th className="px-4 py-2 font-medium">Mins</th>
              <th className="px-4 py-2 font-medium">Goals</th>
              <th className="px-4 py-2 font-medium">Assists</th>
              <th className="px-4 py-2 font-medium">Rating</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {player.statistics.map((stat, i) => (
              <tr key={i}>
                <td className="whitespace-nowrap px-4 py-2">{stat.team?.name ?? '—'}</td>
                <td className="px-4 py-2 tabular-nums">{stat.appearances ?? '—'}</td>
                <td className="px-4 py-2 tabular-nums">{stat.minutes ?? '—'}</td>
                <td className="px-4 py-2 tabular-nums">{stat.goals}</td>
                <td className="px-4 py-2 tabular-nums">{stat.assists}</td>
                <td className="px-4 py-2 tabular-nums">{stat.rating?.toFixed(1) ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
