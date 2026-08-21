import test, { describe, before, after } from 'node:test';
import assert from 'node:assert/strict';

import { createHarness, startMockUpstream, sleep } from './helpers.js';

/**
 * End-to-end tests: the real Express app, a real Redis, and the real mock upstream.
 * The mock's request counter is the source of truth for "did this actually reach the
 * provider", which is the property every caching claim in this project rests on.
 */
let mock;

before(async () => {
  mock = await startMockUpstream();
});

after(async () => {
  await mock.stop();
});

/** A complete config baseline so one scenario's overrides cannot leak into the next. */
const baseline = (patch = {}) => ({
  cache: {
    enabled: true,
    fallbackTtlS: 600,
    swrWindowS: 30,
    swrEnabled: true,
    negativeTtlS: 30,
    lockTtlMs: 3000,
    fillWaitMs: 1000,
    fillPollMs: 20,
    ttl: { scores: 30, fixtures: 30, players: 30, finished: 60 },
    ...patch.cache,
  },
  rateLimit: {
    inbound: { enabled: true, capacity: 10000, refillPerSec: 10000, ...patch.rateLimit?.inbound },
    outbound: { enabled: true, capacity: 10000, refillPerSec: 10000, ...patch.rateLimit?.outbound },
  },
  breaker: {
    enabled: true,
    timeoutMs: 3000,
    errorThresholdPercentage: 50,
    resetTimeoutMs: 500,
    volumeThreshold: 2,
    rollingCountTimeoutMs: 10000,
    ...patch.breaker,
  },
  upstream: { timeoutMs: 2000, ...patch.upstream },
});

// The mock generates deterministic fixtures from the id, so these two ids reliably
// produce an in-play and a completed match.
const LIVE_MATCH = '215664';
const FINISHED_MATCH = '215662';

describe('proxy and cache-aside', () => {
  let h;

  before(async () => {
    h = await createHarness({ upstreamUrl: mock.url, overrides: baseline() });
    await mock.resetStats();
  });
  after(async () => h.close());

  test('a cold request reaches upstream and is reported as a MISS', async () => {
    const before = (await mock.stats()).total;
    const res = await h.get(`/api/scores/${FINISHED_MATCH}`);

    assert.equal(res.status, 200);
    assert.equal(res.headers['x-cache'], 'MISS');
    assert.equal(res.body.data.match.matchId, Number(FINISHED_MATCH));
    assert.equal((await mock.stats()).total, before + 1);
  });

  test('the next request is served from Redis without touching upstream', async () => {
    const before = (await mock.stats()).total;
    const res = await h.get(`/api/scores/${FINISHED_MATCH}`);

    assert.equal(res.headers['x-cache'], 'HIT');
    assert.equal(res.body.meta.cache, 'HIT');
    assert.equal((await mock.stats()).total, before, 'a cache hit must not call upstream');
  });

  test('all three proxy routes work end to end', async () => {
    const scores = await h.get(`/api/scores/${FINISHED_MATCH}`);
    const fixtures = await h.get('/api/fixtures/2024-08-19');
    const players = await h.get('/api/players/276?season=2024');

    assert.equal(scores.status, 200);
    assert.equal(fixtures.status, 200);
    assert.ok(fixtures.body.data.count > 0);
    assert.equal(players.status, 200);
    assert.equal(players.body.data.player.playerId, 276);
  });

  test('TTL follows data volatility: a finished match caches far longer than a live one', async () => {
    const finished = await h.get(`/api/scores/${FINISHED_MATCH}`);
    const live = await h.get(`/api/scores/${LIVE_MATCH}`);

    assert.equal(finished.body.data.match.status.finished, true);
    assert.equal(live.body.data.match.status.live, true);
    assert.ok(
      Number(finished.headers['x-cache-ttl']) > Number(live.headers['x-cache-ttl']),
      `finished TTL ${finished.headers['x-cache-ttl']} should exceed live TTL ${live.headers['x-cache-ttl']}`,
    );
  });

  test('the season is part of the players cache key', async () => {
    const before = (await mock.stats()).total;
    await h.get('/api/players/276?season=2023');

    assert.equal((await mock.stats()).total, before + 1, 'a different season must not reuse the cached entry');
  });

  test('every response identifies the instance that served it', async () => {
    const res = await h.get(`/api/scores/${FINISHED_MATCH}`);
    assert.ok(res.headers['x-instance']);
    assert.ok(res.headers['x-request-id']);
  });
});

describe('input validation and negative caching', () => {
  let h;

  before(async () => {
    h = await createHarness({ upstreamUrl: mock.url, overrides: baseline() });
  });
  after(async () => h.close());

  test('rejects a non-numeric match id before spending an upstream call', async () => {
    const before = (await mock.stats()).total;
    const res = await h.get('/api/scores/not-an-id');

    assert.equal(res.status, 400);
    assert.equal(res.body.error.code, 'bad_request');
    assert.equal((await mock.stats()).total, before);
  });

  test('rejects a malformed date', async () => {
    const res = await h.get('/api/fixtures/19-08-2024');
    assert.equal(res.status, 400);
  });

  test('an unknown match is a typed 404, not an empty 200', async () => {
    // Above the mock's 900,000,000 "no such match" sentinel. That threshold sits far
    // above realistic ids specifically so it never collides with the /fixtures?date=
    // matchIds, which are date-shaped numbers (YYYYMMDD plus a small index).
    const res = await h.get('/api/scores/900000001');

    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'not_found');
  });

  test('404s are cached so a bad id cannot drain the upstream quota', async () => {
    await h.get('/api/scores/900000002');
    const before = (await mock.stats()).total;
    const res = await h.get('/api/scores/900000002');

    assert.equal(res.status, 404);
    assert.equal(res.headers['x-cache'], 'HIT');
    assert.equal((await mock.stats()).total, before);
  });

  test('unmatched paths get a typed error too', async () => {
    const res = await h.get('/api/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.body.error.code, 'route_not_found');
  });
});

describe('stale-while-revalidate', () => {
  let h;

  before(async () => {
    h = await createHarness({
      upstreamUrl: mock.url,
      overrides: baseline({ cache: { ttl: { scores: 1, fixtures: 1, players: 1, finished: 1 }, swrWindowS: 30 } }),
    });
    await mock.control({ mode: 'healthy' });
  });
  after(async () => h.close());

  test('serves the stale value immediately and refreshes it in the background', async () => {
    const id = '400001';
    assert.equal((await h.get(`/api/scores/${id}`)).headers['x-cache'], 'MISS');

    await sleep(1100); // past the 1s freshness window, inside the stale window

    const callsBeforeStale = (await mock.stats()).total;
    const stale = await h.get(`/api/scores/${id}`);

    assert.equal(stale.status, 200);
    assert.equal(stale.headers['x-cache'], 'STALE');
    assert.ok(stale.body.data.match, 'a stale response still carries data');
    assert.equal(
      (await mock.stats()).total,
      callsBeforeStale,
      'the client must not wait on an upstream call for a stale hit',
    );

    // The refresh happens after the response, so the next request is fresh again.
    await sleep(300);
    assert.equal((await mock.stats()).total, callsBeforeStale + 1, 'background revalidation should have run');
    assert.equal((await h.get(`/api/scores/${id}`)).headers['x-cache'], 'HIT');
  });
});

describe('cache stampede protection', () => {
  let h;

  before(async () => {
    h = await createHarness({ upstreamUrl: mock.url, overrides: baseline() });
  });
  after(async () => h.close());

  test('concurrent misses on one key produce a single upstream call', async () => {
    const before = (await mock.stats()).total;

    const responses = await Promise.all(Array.from({ length: 25 }, () => h.get('/api/scores/500123')));
    const after = (await mock.stats()).total;

    assert.ok(responses.every((r) => r.status === 200));
    assert.equal(after - before, 1, `expected 1 upstream call for 25 concurrent misses, got ${after - before}`);

    const statuses = responses.map((r) => r.headers['x-cache']);
    assert.equal(statuses.filter((s) => s === 'MISS').length, 1);
    assert.ok(statuses.includes('COALESCED'), 'waiting requests should report COALESCED');
  });
});

describe('inbound rate limiting', () => {
  let h;

  before(async () => {
    h = await createHarness({
      upstreamUrl: mock.url,
      overrides: baseline({ rateLimit: { inbound: { enabled: true, capacity: 5, refillPerSec: 0.001 } } }),
    });
  });
  after(async () => h.close());

  test('rejects a client over its budget with 429 and Retry-After', async () => {
    const responses = [];
    for (let i = 0; i < 8; i += 1) responses.push(await h.get(`/api/scores/${FINISHED_MATCH}`));

    const allowed = responses.filter((r) => r.status === 200);
    const rejected = responses.filter((r) => r.status === 429);

    assert.equal(allowed.length, 5);
    assert.equal(rejected.length, 3);
    assert.equal(rejected[0].body.error.code, 'rate_limited_inbound');
    assert.ok(Number(rejected[0].headers['retry-after']) >= 1);
    assert.equal(rejected[0].headers['x-ratelimit-limit'], '5');
  });

  test('a separate API key gets its own bucket', async () => {
    const res = await h.get(`/api/scores/${FINISHED_MATCH}`, { headers: { 'x-api-key': 'another-client' } });
    assert.equal(res.status, 200);
  });

  test('health and metrics are never rate limited', async () => {
    assert.equal((await h.get('/health')).status, 200);
    assert.equal((await h.get('/metrics')).status, 200);
  });
});

describe('outbound quota protection', () => {
  let h;

  before(async () => {
    h = await createHarness({
      upstreamUrl: mock.url,
      overrides: baseline({ rateLimit: { outbound: { enabled: true, capacity: 1, refillPerSec: 0.001 } } }),
    });
  });
  after(async () => h.close());

  test('stops calling upstream once the shared quota is spent', async () => {
    const first = await h.get('/api/scores/600001');
    assert.equal(first.status, 200);

    const before = (await mock.stats()).total;
    const second = await h.get('/api/scores/600002');

    assert.equal(second.status, 429);
    assert.equal(second.body.error.code, 'rate_limited_outbound');
    assert.ok(Number(second.headers['retry-after']) >= 1);
    assert.equal((await mock.stats()).total, before, 'no upstream call may escape once quota is exhausted');
  });

  test('cached data is still served while the quota is exhausted', async () => {
    const res = await h.get('/api/scores/600001');

    assert.equal(res.status, 200);
    assert.equal(res.headers['x-cache'], 'HIT');
  });
});

describe('circuit breaker and graceful degradation', () => {
  let h;

  before(async () => {
    h = await createHarness({
      upstreamUrl: mock.url,
      overrides: baseline({
        cache: { ttl: { scores: 1, fixtures: 1, players: 1, finished: 1 }, swrEnabled: false, swrWindowS: 0 },
        breaker: { volumeThreshold: 2, errorThresholdPercentage: 50, resetTimeoutMs: 500 },
      }),
    });
  });

  after(async () => {
    await mock.control({ mode: 'healthy', errorRate: 0 });
    await h.close();
  });

  test('serves the last-known-good value when upstream starts failing', async () => {
    const id = '700001';
    assert.equal((await h.get(`/api/scores/${id}`)).status, 200);

    await mock.control({ mode: 'error' });
    await sleep(1100); // let the cached entry age out of its freshness window

    const res = await h.get(`/api/scores/${id}`);

    assert.equal(res.status, 200, 'a degraded upstream must not become a client-visible failure');
    assert.equal(res.headers['x-cache'], 'FALLBACK');
    assert.equal(res.headers['x-degraded'], 'true');
    assert.equal(res.body.meta.degraded, true);
    assert.ok(res.body.data.match, 'fallback still carries the last-known-good payload');
  });

  test('trips open and then fails fast instead of piling up on a dead upstream', async () => {
    for (let i = 0; i < 5; i += 1) await h.get(`/api/scores/70010${i}`);

    const status = await h.get('/admin/status');
    assert.equal(status.body.breaker.state, 'open');

    const started = Date.now();
    const res = await h.get('/api/scores/700200');
    const elapsed = Date.now() - started;

    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'circuit_open');
    assert.ok(elapsed < 200, `an open circuit should reject immediately, took ${elapsed}ms`);
  });

  test('closes again once upstream recovers', async () => {
    await mock.control({ mode: 'healthy' });
    await sleep(700); // past resetTimeout, so the next call is the half-open probe

    const res = await h.get('/api/scores/700300');
    assert.equal(res.status, 200);

    const status = await h.get('/admin/status');
    assert.equal(status.body.breaker.state, 'closed');
  });
});

describe('cache disabled (load-test baseline mode)', () => {
  let h;

  before(async () => {
    h = await createHarness({ upstreamUrl: mock.url, overrides: baseline({ cache: { enabled: false } }) });
  });
  after(async () => h.close());

  test('every request goes to upstream and reports BYPASS', async () => {
    const before = (await mock.stats()).total;

    const first = await h.get('/api/scores/800001');
    const second = await h.get('/api/scores/800001');

    assert.equal(first.headers['x-cache'], 'BYPASS');
    assert.equal(second.headers['x-cache'], 'BYPASS');
    assert.equal((await mock.stats()).total - before, 2);
  });
});

describe('observability endpoints', () => {
  let h;

  before(async () => {
    h = await createHarness({ upstreamUrl: mock.url, overrides: baseline() });
  });
  after(async () => h.close());

  test('health reports liveness and readiness checks its dependencies', async () => {
    const health = await h.get('/health');
    const ready = await h.get('/ready');

    assert.equal(health.status, 200);
    assert.equal(ready.status, 200);
    assert.equal(ready.body.checks.redis, 'ok');
  });

  test('exposes Prometheus metrics for the panels the dashboard needs', async () => {
    await h.get(`/api/scores/${FINISHED_MATCH}`);
    const res = await h.get('/metrics');

    for (const metric of [
      'gateway_http_requests_total',
      'gateway_http_request_duration_seconds',
      'gateway_cache_events_total',
      'gateway_upstream_requests_total',
      'gateway_circuit_breaker_state',
    ]) {
      assert.ok(res.body.includes(metric), `missing metric ${metric}`);
    }
  });

  test('publishes an analytics event per request with the fields the dashboards query', async () => {
    h.published.length = 0;
    await h.get(`/api/scores/${FINISHED_MATCH}`);
    await sleep(50);

    const event = h.published.at(-1);
    assert.equal(event.route, 'scores');
    assert.equal(event.statusCode, 200);
    assert.equal(typeof event.latencyMs, 'number');
    assert.ok(['HIT', 'MISS'].includes(event.cacheStatus));
    assert.equal(typeof event.cacheHit, 'boolean');
  });

  test('admin cache invalidation removes entries for a route', async () => {
    await h.get('/api/scores/900123'.replace('900123', '850001'));
    const res = await h.get('/admin/cache?route=scores', { method: 'DELETE' });

    assert.equal(res.status, 200);
    assert.ok(res.body.invalidated >= 1);
    assert.equal((await h.get('/api/scores/850001')).headers['x-cache'], 'MISS');
  });
});
