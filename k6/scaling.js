import { buildSummary, callGateway, randomTarget, resetUpstreamStats, TREND_STATS } from './lib/common.js';

/**
 * Throughput measurement for the horizontal-scaling comparison.
 *
 * Uses a closed model (fixed VUs, no think time) so the result is the system's actual
 * throughput ceiling rather than a rate the script imposed. Run once per replica count:
 *
 *   docker compose up -d --scale gateway=1 && k6 run k6/scaling.js   # RUN_LABEL=scaling-1x
 *   docker compose up -d --scale gateway=2 && k6 run k6/scaling.js   # RUN_LABEL=scaling-2x
 *   docker compose up -d --scale gateway=3 && k6 run k6/scaling.js   # RUN_LABEL=scaling-3x
 */
export const options = {
  summaryTrendStats: TREND_STATS,
  scenarios: {
    saturate: {
      executor: 'constant-vus',
      vus: Number(__ENV.VUS || 100),
      duration: __ENV.DURATION || '2m',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.05'],
  },
  discardResponseBodies: false,
};

export function setup() {
  resetUpstreamStats();
}

export default function () {
  callGateway(randomTarget());
}

export function handleSummary(data) {
  return buildSummary(__ENV.RUN_LABEL || 'scaling', data, {
    gatewayReplicas: __ENV.GATEWAY_REPLICAS || 'unknown',
    vus: Number(__ENV.VUS || 100),
  });
}
