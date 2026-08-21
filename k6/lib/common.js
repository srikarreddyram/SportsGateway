import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

// k6's default summary omits p99, which the results table reports. Every scenario
// spreads this into its own options so the percentile is actually computed.
export const TREND_STATS = ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'];

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';
export const MOCK_URL = __ENV.MOCK_URL || 'http://localhost:8081';
export const RESULTS_DIR = __ENV.RESULTS_DIR || 'results';

// Client-observed cache behaviour, taken from the gateway's X-Cache header.
export const cacheHitRate = new Rate('cache_hit_rate');
export const cacheHits = new Counter('cache_hits');
export const cacheMisses = new Counter('cache_misses');
export const staleServed = new Counter('cache_stale_served');
export const fallbackServed = new Counter('cache_fallback_served');
export const degradedResponses = new Counter('degraded_responses');
export const rateLimitedResponses = new Counter('rate_limited_responses');
export const serverErrors = new Counter('server_errors');
export const routeLatency = new Trend('route_latency_ms', true);

/**
 * Traffic model: a handful of live matches take most of the load, mirroring the burst
 * profile the PRD describes. A uniform key spread would flatter the cache far less
 * honestly — and far less realistically.
 */
export const HOT_MATCHES = ['215664', '215666', '215668', '215670', '215672', '215674', '215676', '215678'];
export const COLD_MATCHES = Array.from({ length: 120 }, (_, i) => String(300000 + i));
export const PLAYER_IDS = Array.from({ length: 60 }, (_, i) => String(276 + i));

const pick = (list) => list[Math.floor(Math.random() * list.length)];

const isoDate = (offsetDays) => {
  const date = new Date(Date.now() + offsetDays * 86400000);
  return date.toISOString().slice(0, 10);
};

export function randomTarget() {
  const roll = Math.random();

  // 70% live scores (hot set), 15% fixtures, 15% players.
  if (roll < 0.62) return { route: 'scores', path: `/api/scores/${pick(HOT_MATCHES)}` };
  if (roll < 0.7) return { route: 'scores', path: `/api/scores/${pick(COLD_MATCHES)}` };
  if (roll < 0.85) return { route: 'fixtures', path: `/api/fixtures/${isoDate(Math.random() < 0.7 ? 0 : -1)}` };
  return { route: 'players', path: `/api/players/${pick(PLAYER_IDS)}?season=2024` };
}

export function callGateway(target, params = {}) {
  const res = http.get(`${BASE_URL}${target.path}`, {
    tags: { route: target.route },
    ...params,
  });

  record(res, target.route);
  return res;
}

export function record(res, route) {
  const cache = res.headers['X-Cache'] || 'NONE';
  const servedFromCache = cache === 'HIT' || cache === 'STALE' || cache === 'COALESCED';

  cacheHitRate.add(servedFromCache, { route });
  routeLatency.add(res.timings.duration, { route, cache });

  if (servedFromCache) cacheHits.add(1, { route });
  if (cache === 'MISS' || cache === 'BYPASS') cacheMisses.add(1, { route });
  if (cache === 'STALE') staleServed.add(1, { route });
  if (cache === 'FALLBACK') fallbackServed.add(1, { route });
  if (res.headers['X-Degraded']) degradedResponses.add(1, { route });
  if (res.status === 429) rateLimitedResponses.add(1, { route });
  if (res.status >= 500) serverErrors.add(1, { route });

  check(
    res,
    {
      'status is not 5xx': (r) => r.status < 500,
      'body has data or typed error': (r) => r.body && r.body.length > 0,
    },
    { route },
  );
}

/** Upstream call counter — the number the caching claims are measured against. */
export function readUpstreamStats() {
  const res = http.get(`${MOCK_URL}/__stats`);
  return res.status === 200 ? res.json() : null;
}

export function resetUpstreamStats() {
  http.del(`${MOCK_URL}/__stats`);
}

export function setUpstreamMode(patch) {
  http.post(`${MOCK_URL}/__control`, JSON.stringify(patch), {
    headers: { 'Content-Type': 'application/json' },
  });
}

const metricValue = (data, name, field) => {
  const metric = data.metrics[name];
  if (!metric) return null;
  return metric.values[field] ?? null;
};

/** Compact, human-readable summary plus a machine-readable file for the report. */
export function buildSummary(testName, data, extra = {}) {
  const summary = {
    test: testName,
    generatedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    requests: metricValue(data, 'http_reqs', 'count'),
    requestsPerSecond: metricValue(data, 'http_reqs', 'rate'),
    failedRate: metricValue(data, 'http_req_failed', 'rate'),
    latencyMs: {
      avg: metricValue(data, 'http_req_duration', 'avg'),
      p50: metricValue(data, 'http_req_duration', 'med'),
      p95: metricValue(data, 'http_req_duration', 'p(95)'),
      p99: metricValue(data, 'http_req_duration', 'p(99)'),
      max: metricValue(data, 'http_req_duration', 'max'),
    },
    cache: {
      hitRate: metricValue(data, 'cache_hit_rate', 'rate'),
      hits: metricValue(data, 'cache_hits', 'count'),
      misses: metricValue(data, 'cache_misses', 'count'),
      staleServed: metricValue(data, 'cache_stale_served', 'count'),
      fallbackServed: metricValue(data, 'cache_fallback_served', 'count'),
    },
    degradedResponses: metricValue(data, 'degraded_responses', 'count'),
    rateLimitedResponses: metricValue(data, 'rate_limited_responses', 'count'),
    serverErrors: metricValue(data, 'server_errors', 'count'),
    ...extra,
  };

  const pct = (value) => (value === null ? 'n/a' : `${(value * 100).toFixed(2)}%`);
  const ms = (value) => (value === null ? 'n/a' : `${value.toFixed(1)}ms`);

  const text = [
    '',
    `  ${testName}`,
    `  ${'='.repeat(testName.length)}`,
    `  requests           ${summary.requests} (${summary.requestsPerSecond?.toFixed(1)}/s)`,
    `  failed             ${pct(summary.failedRate)}`,
    `  latency p50/p95    ${ms(summary.latencyMs.p50)} / ${ms(summary.latencyMs.p95)}`,
    `  cache hit rate     ${pct(summary.cache.hitRate)}`,
    `  hits / misses      ${summary.cache.hits ?? 0} / ${summary.cache.misses ?? 0}`,
    `  stale / fallback   ${summary.cache.staleServed ?? 0} / ${summary.cache.fallbackServed ?? 0}`,
    `  429s / 5xx         ${summary.rateLimitedResponses ?? 0} / ${summary.serverErrors ?? 0}`,
    '',
  ].join('\n');

  return {
    stdout: text,
    [`${RESULTS_DIR}/${testName}-summary.json`]: JSON.stringify(summary, null, 2),
  };
}
