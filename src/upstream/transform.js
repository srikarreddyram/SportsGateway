/**
 * Shape third-party payloads into the gateway's own contract.
 *
 * Consumers depend on these shapes, not on the provider's. That keeps a provider change
 * (or a switch from API-Sports to SportsRadar) an internal detail, and it strips fields
 * nobody uses out of every cached entry.
 *
 * All functions are pure so they can be unit-tested without Redis or a network.
 */

/** Statuses meaning the result can no longer change, so it can be cached for hours. */
export const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD', 'AWD', 'WO']);
export const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'LIVE', 'INT']);

const num = (value) => (typeof value === 'number' ? value : null);

function team(raw) {
  if (!raw) return null;
  return { id: raw.id ?? null, name: raw.name ?? null, logo: raw.logo ?? null, winner: raw.winner ?? null };
}

function goals(raw) {
  return { home: num(raw?.home), away: num(raw?.away) };
}

/** One upstream fixture object -> one flat, predictable match summary. */
export function toMatch(raw) {
  if (!raw?.fixture) return null;
  const status = raw.fixture.status ?? {};

  return {
    matchId: raw.fixture.id ?? null,
    kickoff: raw.fixture.date ?? null,
    timestamp: num(raw.fixture.timestamp),
    status: {
      short: status.short ?? null,
      description: status.long ?? null,
      elapsed: num(status.elapsed),
      live: LIVE_STATUSES.has(status.short),
      finished: FINISHED_STATUSES.has(status.short),
    },
    venue: raw.fixture.venue ? { name: raw.fixture.venue.name ?? null, city: raw.fixture.venue.city ?? null } : null,
    referee: raw.fixture.referee ?? null,
    league: raw.league
      ? {
          id: raw.league.id ?? null,
          name: raw.league.name ?? null,
          country: raw.league.country ?? null,
          season: raw.league.season ?? null,
          round: raw.league.round ?? null,
        }
      : null,
    teams: { home: team(raw.teams?.home), away: team(raw.teams?.away) },
    score: {
      current: goals(raw.goals),
      halftime: goals(raw.score?.halftime),
      fulltime: goals(raw.score?.fulltime),
      extratime: goals(raw.score?.extratime),
      penalty: goals(raw.score?.penalty),
    },
  };
}

export function toMatchList(body) {
  const items = Array.isArray(body?.response) ? body.response : [];
  return items.map(toMatch).filter(Boolean);
}

export function toPlayer(raw) {
  if (!raw?.player) return null;
  const p = raw.player;

  return {
    playerId: p.id ?? null,
    name: p.name ?? null,
    firstname: p.firstname ?? null,
    lastname: p.lastname ?? null,
    age: num(p.age),
    nationality: p.nationality ?? null,
    height: p.height ?? null,
    weight: p.weight ?? null,
    photo: p.photo ?? null,
    statistics: (Array.isArray(raw.statistics) ? raw.statistics : []).map((s) => ({
      team: team(s.team),
      league: s.league
        ? { id: s.league.id ?? null, name: s.league.name ?? null, season: s.league.season ?? null }
        : null,
      position: s.games?.position ?? null,
      appearances: num(s.games?.appearences) ?? num(s.games?.appearances),
      minutes: num(s.games?.minutes),
      rating: s.games?.rating != null ? Number.parseFloat(s.games.rating) : null,
      goals: num(s.goals?.total) ?? 0,
      assists: num(s.goals?.assists) ?? 0,
      yellowCards: num(s.cards?.yellow) ?? 0,
      redCards: num(s.cards?.red) ?? 0,
    })),
  };
}
