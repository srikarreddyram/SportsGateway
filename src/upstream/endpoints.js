import { config } from '../config.js';
import { BadRequestError } from '../errors.js';
import { toMatch, toMatchList, toPlayer } from './transform.js';

const ID_PATTERN = /^\d{1,12}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const today = () => new Date().toISOString().slice(0, 10);

function validateId(value, field) {
  if (!ID_PATTERN.test(value ?? '')) {
    throw new BadRequestError(`${field} must be a numeric id`, { field, received: value });
  }
  return value;
}

const SEASON_PATTERN = /^\d{4}$/;

/**
 * Unlike matchId/date, the season comes from a query string, not a route param, so it
 * never passed through `validate` — it went straight into the upstream request and the
 * cache key unchecked. Resolved and validated once here so both `upstream()` and
 * `cacheId()` agree on the exact same value instead of each re-deriving it.
 */
function resolveSeason(req) {
  const raw = req?.query?.season;
  if (raw === undefined) return config.upstream.defaultSeason;
  if (!SEASON_PATTERN.test(String(raw))) {
    throw new BadRequestError('season must be a 4-digit year', { field: 'season', received: raw });
  }
  return raw;
}

function validateDate(value) {
  if (!DATE_PATTERN.test(value ?? '')) {
    throw new BadRequestError('date must be formatted as YYYY-MM-DD', { field: 'date', received: value });
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestError('date is not a valid calendar date', { field: 'date', received: value });
  }
  return value;
}

/**
 * One descriptor per public route. The proxy route factory reads these, so adding an
 * endpoint means adding an entry here rather than writing another near-identical handler.
 *
 * `ttlFor` is what makes TTLs volatility-aware: a finished match is immutable and can be
 * cached for hours, while a match in play must expire in seconds.
 */
export const endpoints = [
  {
    name: 'scores',
    path: '/api/scores/:matchId',
    param: 'matchId',
    validate: (value) => validateId(value, 'matchId'),
    upstream: (matchId) => ({ path: '/fixtures', query: { id: matchId } }),
    transform: (body) => {
      const match = toMatch(body?.response?.[0]);
      return match ? { match } : null;
    },
    ttlFor: (payload) => (payload?.match?.status?.finished ? config.cache.ttl.finished : config.cache.ttl.scores),
  },
  {
    name: 'fixtures',
    path: '/api/fixtures/:date',
    param: 'date',
    validate: validateDate,
    upstream: (date) => ({ path: '/fixtures', query: { date } }),
    transform: (body, date) => {
      const matches = toMatchList(body);
      return matches.length > 0 ? { date, count: matches.length, matches } : null;
    },
    ttlFor: (payload, date) => {
      if (date < today()) return config.cache.ttl.finished;
      if (payload?.matches?.some((match) => match.status.live)) return config.cache.ttl.scores;
      return config.cache.ttl.fixtures;
    },
  },
  {
    name: 'players',
    path: '/api/players/:playerId',
    param: 'playerId',
    validate: (value) => validateId(value, 'playerId'),
    upstream: (playerId, req) => ({
      path: '/players',
      query: { id: playerId, season: resolveSeason(req) },
    }),
    // Season is part of the response, so it must be part of the cache key.
    cacheId: (playerId, req) => `${playerId}:${resolveSeason(req)}`,
    transform: (body) => {
      const player = toPlayer(body?.response?.[0]);
      return player ? { player } : null;
    },
    ttlFor: () => config.cache.ttl.players,
  },
];

export const endpointByName = Object.fromEntries(endpoints.map((endpoint) => [endpoint.name, endpoint]));
