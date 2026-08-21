import { sleep } from 'k6';
import { buildSummary, callGateway, randomTarget, resetUpstreamStats, TREND_STATS } from './lib/common.js';

/** Quick sanity run: confirms the stack is wired before spending five minutes on a burst. */
export const options = {
  summaryTrendStats: TREND_STATS,
  vus: 5,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'],
    http_req_duration: ['p(95)<500'],
    checks: ['rate>0.99'],
  },
};

export function setup() {
  resetUpstreamStats();
}

export default function () {
  callGateway(randomTarget());
  sleep(0.5);
}

export function handleSummary(data) {
  // Honours RUN_LABEL so a benchmark that runs this script twice (caching off, then on)
  // writes two separate summaries instead of the second overwriting the first.
  return buildSummary(__ENV.RUN_LABEL || 'smoke', data, {
    cacheEnabled: __ENV.EXPECT_CACHE !== 'false',
  });
}
