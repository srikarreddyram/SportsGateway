export interface Team {
  id: number | null;
  name: string | null;
  logo: string | null;
  winner: boolean | null;
}

export interface MatchStatus {
  short: string | null;
  description: string | null;
  elapsed: number | null;
  live: boolean;
  finished: boolean;
}

export interface League {
  id: number | null;
  name: string | null;
  country: string | null;
  season: number | null;
  round: string | null;
}

export interface Goals {
  home: number | null;
  away: number | null;
}

export interface Match {
  matchId: number | null;
  kickoff: string | null;
  timestamp: number | null;
  status: MatchStatus;
  venue: { name: string | null; city: string | null } | null;
  referee: string | null;
  league: League | null;
  teams: { home: Team | null; away: Team | null };
  score: {
    current: Goals;
    halftime: Goals;
    fulltime: Goals;
    extratime: Goals;
    penalty: Goals;
  };
}

export interface PlayerStat {
  team: Team | null;
  league: { id: number | null; name: string | null; season: number | null } | null;
  position: string | null;
  appearances: number | null;
  minutes: number | null;
  rating: number | null;
  goals: number;
  assists: number;
  yellowCards: number;
  redCards: number;
}

export interface Player {
  playerId: number | null;
  name: string | null;
  firstname: string | null;
  lastname: string | null;
  age: number | null;
  nationality: string | null;
  height: string | null;
  weight: string | null;
  photo: string | null;
  statistics: PlayerStat[];
}

/** Every gateway response is wrapped the same way — this is what the UI showcases. */
export interface CacheMeta {
  cache: 'HIT' | 'MISS' | 'STALE' | 'FALLBACK' | 'COALESCED' | 'BYPASS';
  ageMs: number;
  instance: string;
  requestId: string;
  degraded?: boolean;
  note?: string;
}

export interface Envelope<T> {
  meta: CacheMeta;
  data: T;
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown };
}
