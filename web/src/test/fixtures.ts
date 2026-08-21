import type { Match, Player } from '../types';

export function makeMatch(overrides: Partial<Match> = {}): Match {
  return {
    matchId: 1001,
    kickoff: '2026-08-20T18:00:00.000Z',
    timestamp: 1787169600,
    status: { short: 'FT', description: 'Match Finished', elapsed: 90, live: false, finished: true },
    venue: { name: 'Old Trafford', city: 'Manchester' },
    referee: 'M. Oliver',
    league: { id: 39, name: 'Premier League', country: 'England', season: 2024, round: 'Regular Season - 12' },
    teams: {
      home: { id: 33, name: 'Manchester United', logo: null, winner: true },
      away: { id: 40, name: 'Liverpool', logo: null, winner: false },
    },
    score: {
      current: { home: 2, away: 1 },
      halftime: { home: 1, away: 0 },
      fulltime: { home: 2, away: 1 },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
    ...overrides,
  };
}

export function makeLiveMatch(overrides: Partial<Match> = {}): Match {
  return makeMatch({
    matchId: 2002,
    status: { short: '2H', description: 'Second Half', elapsed: 67, live: true, finished: false },
    ...overrides,
  });
}

export function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    playerId: 276,
    name: 'Player 276',
    firstname: 'Test',
    lastname: 'Player276',
    age: 28,
    nationality: 'Brazil',
    height: '180 cm',
    weight: '75 kg',
    photo: null,
    statistics: [
      {
        team: { id: 33, name: 'Manchester United', logo: null, winner: null },
        league: { id: 39, name: 'Premier League', season: 2024 },
        position: 'Attacker',
        appearances: 17,
        minutes: 1090,
        rating: 7.3,
        goals: 19,
        assists: 4,
        yellowCards: 2,
        redCards: 0,
      },
    ],
    ...overrides,
  };
}
