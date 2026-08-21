import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import { toMatch, toMatchList, toPlayer, FINISHED_STATUSES } from '../src/upstream/transform.js';

const rawFixture = {
  fixture: {
    id: 215662,
    date: '2024-08-19T14:00:00+00:00',
    timestamp: 1724076000,
    venue: { id: 556, name: 'Old Trafford', city: 'Manchester' },
    status: { long: 'Second Half', short: '2H', elapsed: 67 },
  },
  league: { id: 39, name: 'Premier League', country: 'England', season: 2024, round: 'Regular Season - 1' },
  teams: {
    home: { id: 33, name: 'Manchester United', winner: null },
    away: { id: 40, name: 'Liverpool', winner: null },
  },
  goals: { home: 2, away: 1 },
  score: { halftime: { home: 1, away: 0 }, fulltime: { home: null, away: null } },
};

describe('fixture transform', () => {
  test('flattens an upstream fixture into the gateway contract', () => {
    const match = toMatch(rawFixture);

    assert.equal(match.matchId, 215662);
    assert.equal(match.league.name, 'Premier League');
    assert.equal(match.teams.home.name, 'Manchester United');
    assert.deepEqual(match.score.current, { home: 2, away: 1 });
    assert.equal(match.status.elapsed, 67);
  });

  test('classifies live and finished states from the status code', () => {
    assert.equal(toMatch(rawFixture).status.live, true);
    assert.equal(toMatch(rawFixture).status.finished, false);

    const finished = structuredClone(rawFixture);
    finished.fixture.status = { long: 'Match Finished', short: 'FT', elapsed: 90 };
    assert.equal(toMatch(finished).status.finished, true);
    assert.equal(toMatch(finished).status.live, false);
    assert.ok(FINISHED_STATUSES.has('FT'));
  });

  test('survives missing optional sections instead of throwing', () => {
    const sparse = { fixture: { id: 1, status: {} } };
    const match = toMatch(sparse);

    assert.equal(match.matchId, 1);
    assert.equal(match.league, null);
    assert.deepEqual(match.score.current, { home: null, away: null });
    assert.equal(match.teams.home, null);
  });

  test('returns null for a payload that is not a fixture', () => {
    assert.equal(toMatch(null), null);
    assert.equal(toMatch({}), null);
  });

  test('maps a list response and drops unusable entries', () => {
    const list = toMatchList({ response: [rawFixture, {}, null] });
    assert.equal(list.length, 1);
    assert.equal(list[0].matchId, 215662);
  });

  test('treats a missing response array as an empty list', () => {
    assert.deepEqual(toMatchList({}), []);
    assert.deepEqual(toMatchList({ response: 'nonsense' }), []);
  });
});

describe('player transform', () => {
  test('flattens player statistics and coerces the rating to a number', () => {
    const player = toPlayer({
      player: { id: 276, name: 'Neymar', age: 32, nationality: 'Brazil' },
      statistics: [
        {
          team: { id: 85, name: 'Paris Saint Germain' },
          league: { id: 61, name: 'Ligue 1', season: 2024 },
          games: { appearences: 10, minutes: 800, position: 'Attacker', rating: '7.85' },
          goals: { total: 5, assists: 3 },
          cards: { yellow: 2, red: 0 },
        },
      ],
    });

    assert.equal(player.playerId, 276);
    assert.equal(player.statistics[0].appearances, 10);
    assert.equal(player.statistics[0].rating, 7.85);
    assert.equal(player.statistics[0].goals, 5);
    assert.equal(player.statistics[0].assists, 3);
  });

  test('defaults counters to zero when the provider omits them', () => {
    const player = toPlayer({ player: { id: 1 }, statistics: [{ games: {} }] });

    assert.equal(player.statistics[0].goals, 0);
    assert.equal(player.statistics[0].rating, null);
  });
});
