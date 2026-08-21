import http from 'node:http';

/**
 * Stand-in for the third-party sports API (API-Sports / api-football v3 response shapes).
 *
 * It exists for three reasons the real provider cannot serve:
 *   1. Free-tier quotas are far too small for a meaningful load test.
 *   2. `GET /__stats` counts exactly how many calls reached the provider, which is the
 *      number the caching before/after comparison is built on.
 *   3. `POST /__control` injects latency and failures on demand, so circuit-breaker
 *      behaviour can be demonstrated mid-test instead of waiting for a real outage.
 *
 * Responses are deterministic functions of the requested id, so repeated runs compare.
 */
const PORT = Number.parseInt(process.env.PORT ?? '8081', 10);
const BASE_LATENCY_MS = Number.parseInt(process.env.MOCK_BASE_LATENCY_MS ?? '80', 10);
const JITTER_MS = Number.parseInt(process.env.MOCK_JITTER_MS ?? '40', 10);

const control = {
  mode: 'healthy', // healthy | slow | error | down
  latencyMs: BASE_LATENCY_MS,
  jitterMs: JITTER_MS,
  errorRate: 0, // 0..1, applied in every mode
};

const stats = {
  startedAt: new Date().toISOString(),
  total: 0,
  byEndpoint: Object.create(null),
  errorsServed: 0,
  lastRequestAt: null,
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Deterministic pseudo-random generator so a given id always yields the same match. */
function seeded(seed) {
  let state = seed % 2147483647;
  if (state <= 0) state += 2147483646;
  return () => {
    state = (state * 16807) % 2147483647;
    return (state - 1) / 2147483646;
  };
}

const TEAMS = [
  [33, 'Manchester United'],
  [40, 'Liverpool'],
  [50, 'Manchester City'],
  [42, 'Arsenal'],
  [49, 'Chelsea'],
  [47, 'Tottenham'],
  [529, 'Barcelona'],
  [541, 'Real Madrid'],
  [157, 'Bayern Munich'],
  [85, 'Paris Saint Germain'],
  [489, 'AC Milan'],
  [496, 'Juventus'],
];

const LEAGUES = [
  [39, 'Premier League', 'England'],
  [140, 'La Liga', 'Spain'],
  [135, 'Serie A', 'Italy'],
];

function buildFixture(id, { forceLive = false } = {}) {
  const rand = seeded(Number(id) || 1);
  const homeIdx = Math.floor(rand() * TEAMS.length);
  let awayIdx = Math.floor(rand() * TEAMS.length);
  if (awayIdx === homeIdx) awayIdx = (awayIdx + 1) % TEAMS.length;

  const [leagueId, leagueName, country] = LEAGUES[Math.floor(rand() * LEAGUES.length)];
  const isLive = forceLive || rand() < 0.4;

  // Live matches advance with wall-clock time, which is what makes a stale cache visible.
  const elapsed = isLive ? (Math.floor(Date.now() / 60000) % 90) + 1 : 90;
  const homeGoals = isLive ? Math.floor(elapsed / 30) : Math.floor(rand() * 4);
  const awayGoals = isLive ? Math.floor(elapsed / 45) : Math.floor(rand() * 3);

  return {
    fixture: {
      id: Number(id),
      referee: 'M. Oliver',
      timezone: 'UTC',
      date: new Date(Date.now() - elapsed * 60000).toISOString(),
      timestamp: Math.floor(Date.now() / 1000) - elapsed * 60,
      venue: { id: 556, name: 'Old Trafford', city: 'Manchester' },
      status: isLive
        ? { long: 'Second Half', short: '2H', elapsed }
        : { long: 'Match Finished', short: 'FT', elapsed: 90 },
    },
    league: {
      id: leagueId,
      name: leagueName,
      country,
      logo: null,
      flag: null,
      season: 2024,
      round: 'Regular Season - 12',
    },
    teams: {
      home: { id: TEAMS[homeIdx][0], name: TEAMS[homeIdx][1], logo: null, winner: homeGoals > awayGoals },
      away: { id: TEAMS[awayIdx][0], name: TEAMS[awayIdx][1], logo: null, winner: awayGoals > homeGoals },
    },
    goals: { home: homeGoals, away: awayGoals },
    score: {
      halftime: { home: Math.min(homeGoals, 1), away: Math.min(awayGoals, 1) },
      fulltime: isLive ? { home: null, away: null } : { home: homeGoals, away: awayGoals },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
}

function buildPlayer(id, season) {
  const rand = seeded(Number(id) || 1);
  const [teamId, teamName] = TEAMS[Math.floor(rand() * TEAMS.length)];
  const [leagueId, leagueName] = LEAGUES[Math.floor(rand() * LEAGUES.length)];

  return {
    player: {
      id: Number(id),
      name: `Player ${id}`,
      firstname: 'Test',
      lastname: `Player${id}`,
      age: 20 + Math.floor(rand() * 15),
      nationality: 'Brazil',
      height: '180 cm',
      weight: '75 kg',
      photo: null,
    },
    statistics: [
      {
        team: { id: teamId, name: teamName, logo: null },
        league: { id: leagueId, name: leagueName, season: Number(season) || 2024 },
        games: {
          appearences: Math.floor(rand() * 30),
          minutes: Math.floor(rand() * 2500),
          position: 'Attacker',
          rating: (6 + rand() * 3).toFixed(2),
        },
        goals: { total: Math.floor(rand() * 20), assists: Math.floor(rand() * 12) },
        cards: { yellow: Math.floor(rand() * 6), red: Math.floor(rand() * 2) },
      },
    ],
  };
}

const envelope = (endpoint, parameters, response) => ({
  get: endpoint,
  parameters,
  errors: [],
  results: response.length,
  paging: { current: 1, total: 1 },
  response,
});

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) });
  res.end(payload);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

async function applyControl(res) {
  if (control.mode === 'down') {
    res.destroy(); // no response at all: exercises the client's timeout path
    return true;
  }

  const latency = control.mode === 'slow' ? control.latencyMs * 10 : control.latencyMs;
  await sleep(latency + Math.random() * control.jitterMs);

  if (control.mode === 'error' || Math.random() < control.errorRate) {
    stats.errorsServed += 1;
    sendJson(res, 503, { message: 'Upstream provider is unavailable (injected failure)' });
    return true;
  }

  return false;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
  const path = url.pathname;

  // --- Control plane: never counted, never delayed, never failed -------------------
  if (path === '/__stats' && req.method === 'GET') {
    return sendJson(res, 200, { ...stats, mode: control.mode, control });
  }

  if (path === '/__stats' && (req.method === 'DELETE' || req.method === 'POST')) {
    stats.total = 0;
    stats.errorsServed = 0;
    stats.byEndpoint = Object.create(null);
    stats.startedAt = new Date().toISOString();
    return sendJson(res, 200, { reset: true, at: stats.startedAt });
  }

  if (path === '/__control') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      if (body.mode) control.mode = body.mode;
      if (body.latencyMs !== undefined) control.latencyMs = Number(body.latencyMs);
      if (body.jitterMs !== undefined) control.jitterMs = Number(body.jitterMs);
      if (body.errorRate !== undefined) control.errorRate = Number(body.errorRate);
    }
    return sendJson(res, 200, control);
  }

  if (path === '/health') {
    return sendJson(res, 200, { status: 'ok', mode: control.mode });
  }

  // --- Data plane ------------------------------------------------------------------
  stats.total += 1;
  stats.byEndpoint[path] = (stats.byEndpoint[path] ?? 0) + 1;
  stats.lastRequestAt = new Date().toISOString();

  if (await applyControl(res)) return;

  if (path === '/fixtures') {
    const id = url.searchParams.get('id');
    const date = url.searchParams.get('date');

    if (id) {
      // Ids above 900,000,000 model "no such match": a 200 with an empty response array,
      // which is exactly how API-Sports reports an unknown id. The threshold has to clear
      // date-shaped ids (the /fixtures?date= branch below mints matchIds as YYYYMMDD plus
      // a small index, up to ~100,000,000) or every match a date listing surfaces would
      // 404 the moment a client looked it up by id.
      const response = Number(id) >= 900_000_000 ? [] : [buildFixture(id)];
      return sendJson(res, 200, envelope('fixtures', { id }, response));
    }

    if (date) {
      const rand = seeded(Number(date.replaceAll('-', '')));
      const count = 4 + Math.floor(rand() * 6);
      const fixtures = Array.from({ length: count }, (_, index) =>
        buildFixture(Number(date.replaceAll('-', '')) + index, { forceLive: index % 3 === 0 }),
      );
      return sendJson(res, 200, envelope('fixtures', { date }, fixtures));
    }

    return sendJson(res, 200, {
      get: 'fixtures',
      parameters: {},
      errors: ['id or date is required'],
      results: 0,
      response: [],
    });
  }

  if (path === '/players') {
    const id = url.searchParams.get('id');
    const season = url.searchParams.get('season') ?? '2024';
    const response = !id || Number(id) >= 900_000_000 ? [] : [buildPlayer(id, season)];
    return sendJson(res, 200, envelope('players', { id, season }, response));
  }

  return sendJson(res, 404, { message: `Unknown upstream endpoint ${path}` });
});

server.listen(PORT, () => {
  // The bound port, not the requested one: PORT=0 asks the OS to pick a free port, and
  // the caller can only learn which one from here. The test harness parses this line.
  const { port } = server.address();
  console.log(JSON.stringify({ service: 'mock-upstream', port, baseLatencyMs: BASE_LATENCY_MS, msg: 'listening' }));
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
