import { sleep } from 'k6';
import {
  buildSummary,
  callGateway,
  randomTarget,
  readUpstreamStats,
  resetUpstreamStats,
  TREND_STATS,
} from './lib/common.js';

/**
 * The primary scenario: a live-match burst.
 *
 * Ramps to 100 concurrent users, holds for five minutes, then ramps down — with traffic
 * concentrated on a small set of in-play matches, which is how real sports traffic
 * behaves. Run it twice (CACHE_ENABLED=false, then true) to produce the before/after
 * numbers; `scripts/benchmark.sh` does exactly that.
 */
export const options = {
  summaryTrendStats: TREND_STATS,
  scenarios: {
    live_match_burst: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '1m', target: 100 },
        { duration: '5m', target: 100 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
    http_req_duration: ['p(95)<500'],
    // The PRD's cache hit rate target. Deliberately absent from the no-cache baseline
    // run, where it is expected to fail — see scripts/benchmark.sh.
    ...(__ENV.EXPECT_CACHE === 'false' ? {} : { cache_hit_rate: ['rate>0.70'] }),
  },
};

export function setup() {
  resetUpstreamStats();
  return { startedAt: new Date().toISOString() };
}

export default function () {
  callGateway(randomTarget());
  sleep(Math.random() * 0.4 + 0.1);
}

export function teardown() {
  const stats = readUpstreamStats();
  if (stats) {
    console.log(`upstream calls during test: ${stats.total}`);
  }
}

export function handleSummary(data) {
  return buildSummary(__ENV.RUN_LABEL || 'burst', data, {
    cacheEnabled: __ENV.EXPECT_CACHE !== 'false',
    gatewayReplicas: __ENV.GATEWAY_REPLICAS || 'unknown',
  });
}
