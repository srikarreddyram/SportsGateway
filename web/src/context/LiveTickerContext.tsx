import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import type { Match } from '../types';
import { todayISO } from '../lib/format';
import { LiveTickerContext } from './liveTicker';

const POLL_MS = 10000;

/**
 * Polls today's fixtures once and shares the result with anything that needs "what's
 * live right now" — the header's live count and the sidebar widget both read this
 * instead of each running their own poll against the same gateway route.
 */
export function LiveTickerProvider({ children }: { children: ReactNode }) {
  const [liveMatches, setLiveMatches] = useState<Match[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const { data } = await api.fixtures(todayISO());
        if (!cancelled) setLiveMatches(data.matches.filter((m) => m.status.live));
      } catch {
        // The ticker is a convenience widget, not the primary data path — a transient
        // failure here should not surface an error to the user, just skip this tick.
      } finally {
        if (!cancelled) {
          setLoading(false);
          timer = setTimeout(poll, POLL_MS);
        }
      }
    };

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  return <LiveTickerContext.Provider value={{ liveMatches, loading }}>{children}</LiveTickerContext.Provider>;
}
