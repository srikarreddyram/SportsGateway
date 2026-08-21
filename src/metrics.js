import client from 'prom-client';
import { config } from './config.js';

export const registry = new client.Registry();

if (config.metrics.collectDefault) {
  client.collectDefaultMetrics({ register: registry, prefix: 'sportsgateway_' });
}

const counter = (opts) => new client.Counter({ registers: [registry], ...opts });
const gauge = (opts) => new client.Gauge({ registers: [registry], ...opts });
const histogram = (opts) => new client.Histogram({ registers: [registry], ...opts });

export const metrics = {
  httpRequests: counter({
    name: 'gateway_http_requests_total',
    help: 'HTTP requests served by the gateway',
    labelNames: ['method', 'route', 'status', 'cache_status'],
  }),

  httpDuration: histogram({
    name: 'gateway_http_request_duration_seconds',
    help: 'End-to-end gateway request latency',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  }),

  cacheEvents: counter({
    name: 'gateway_cache_events_total',
    help: 'Cache lookups by outcome (HIT, STALE, MISS, FALLBACK, BYPASS, COALESCED)',
    labelNames: ['route', 'status'],
  }),

  cacheRevalidations: counter({
    name: 'gateway_cache_revalidations_total',
    help: 'Background stale-while-revalidate refreshes by outcome',
    labelNames: ['route', 'outcome'],
  }),

  upstreamRequests: counter({
    name: 'gateway_upstream_requests_total',
    help: 'Calls actually forwarded to the third-party sports API',
    labelNames: ['route', 'outcome'],
  }),

  upstreamDuration: histogram({
    name: 'gateway_upstream_request_duration_seconds',
    help: 'Latency of calls to the third-party sports API',
    labelNames: ['route', 'outcome'],
    buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  }),

  breakerState: gauge({
    name: 'gateway_circuit_breaker_state',
    help: 'Circuit breaker state (0 = closed, 1 = half-open, 2 = open)',
    labelNames: ['breaker'],
  }),

  breakerTransitions: counter({
    name: 'gateway_circuit_breaker_transitions_total',
    help: 'Circuit breaker state transitions',
    labelNames: ['breaker', 'to'],
  }),

  rateLimitRejections: counter({
    name: 'gateway_rate_limit_rejections_total',
    help: 'Requests rejected by a rate limiter',
    labelNames: ['direction', 'route'],
  }),

  rateLimitTokens: gauge({
    name: 'gateway_rate_limit_tokens_remaining',
    help: 'Tokens left in the most recently checked bucket',
    labelNames: ['direction'],
  }),

  analyticsEvents: counter({
    name: 'gateway_analytics_events_total',
    help: 'Analytics events by outcome (enqueued, dropped, failed, sampled_out)',
    labelNames: ['outcome'],
  }),

  analyticsWritten: counter({
    name: 'gateway_analytics_documents_written_total',
    help: 'Analytics documents persisted to MongoDB by the worker',
  }),
};

export const BREAKER_STATE_VALUE = { closed: 0, halfOpen: 1, open: 2 };
