import { sleep } from 'k6';
import {
  buildSummary,
  callGateway,
  randomTarget,
  resetUpstreamStats,
  setUpstreamMode,
  TREND_STATS,
} from './lib/common.js';

/**
 * Upstream-failure scenario.
 *
 * Steady traffic, then the provider is forced to fail mid-test and recovered later. The
 * point is what the client sees during the outage: the circuit breaker should trip and
 * requests should be answered from cache (X-Cache: FALLBACK, X-Degraded: true) quickly,
 * instead of hanging on a dead upstream until they time out.
 */
const OUTAGE_START_S = Number(__ENV.OUTAGE_START_S || 60);
const OUTAGE_LENGTH_S = Number(__ENV.OUTAGE_LENGTH_S || 60);

export const options = {
  summaryTrendStats: TREND_STATS,
  scenarios: {
    steady: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 50),
      duration: `${OUTAGE_START_S + OUTAGE_LENGTH_S + 60}s`,
    },
  },
  thresholds: {
    // Degraded, not down: most requests must still be answered during the outage.
    http_req_duration: ['p(95)<1000'],
    'checks{route:scores}': ['rate>0.90'],
  },
};

export function setup() {
  resetUpstreamStats();
  setUpstreamMode({ mode: 'healthy', errorRate: 0 });

  // Warm the cache so there is a last-known-good value to fall back on. Without this the
  // test would only prove the gateway fails fast, not that it degrades gracefully.
  for (let i = 0; i < 40; i += 1) callGateway(randomTarget());

  return { start: Date.now() };
}

export default function (data) {
  const elapsedS = (Date.now() - data.start) / 1000;

  // Only one virtual user drives the provider's state. Every VU evaluates this same
  // clock, so without the __VU guard all of them would fire inside the one-second
  // window — dozens of redundant control calls and a wall of duplicate log lines.
  if (__VU === 1) {
    if (elapsedS > OUTAGE_START_S && elapsedS < OUTAGE_START_S + 1) {
      setUpstreamMode({ mode: 'error' });
      console.log('injected upstream outage');
    }

    if (elapsedS > OUTAGE_START_S + OUTAGE_LENGTH_S && elapsedS < OUTAGE_START_S + OUTAGE_LENGTH_S + 1) {
      setUpstreamMode({ mode: 'healthy' });
      console.log('restored upstream');
    }
  }

  callGateway(randomTarget());
  sleep(0.2);
}

export function teardown() {
  setUpstreamMode({ mode: 'healthy', errorRate: 0 });
}

export function handleSummary(data) {
  return buildSummary('failure', data, {
    outageStartSeconds: OUTAGE_START_S,
    outageLengthSeconds: OUTAGE_LENGTH_S,
  });
}
