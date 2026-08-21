import { createContext, useContext } from 'react';
import type { Match } from '../types';

export interface LiveTickerValue {
  liveMatches: Match[];
  loading: boolean;
}

// Kept out of LiveTickerContext.tsx deliberately: React Fast Refresh only preserves
// component state when a module exports components and nothing else, so the context
// object and its hook live here instead of alongside the provider component.
export const LiveTickerContext = createContext<LiveTickerValue>({ liveMatches: [], loading: true });

export function useLiveTicker() {
  return useContext(LiveTickerContext);
}
