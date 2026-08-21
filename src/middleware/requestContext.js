import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { metrics } from '../metrics.js';
import { buildRequestEvent } from '../analytics/events.js';
import { endpointByName } from '../upstream/endpoints.js';

const log = createLogger('http');

/**
 * Single place where a request is observed: it carries per-request state, then on
 * response emits the structured log line, the Prometheus metrics, and the analytics
 * event. Handlers only have to declare what happened via `req.ctx.set(...)`.
 */
export function createRequestContext({ analytics, getBreakerState = () => 'unknown' }) {
  return function requestContext(req, res, next) {
    const requestId = req.get('x-request-id') || randomUUID();
    const startedAt = process.hrtime.bigint();

    const state = {
      route: null,
      cacheStatus: null,
      rateLimit: 'ok',
      degraded: false,
      errorCode: null,
      errorMessage: null,
    };

    req.ctx = {
      requestId,
      state,
      set(patch) {
        Object.assign(state, patch);
      },
    };

    res.set('X-Request-Id', requestId);
    res.set('X-Instance', config.instanceId);

    res.on('finish', () => {
      const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      const route = state.route ?? matchedRoute(req);
      const status = String(res.statusCode);
      const cacheStatus = state.cacheStatus ?? 'NONE';
      const breakerState = getBreakerState();
      // Only a MISS or a cache bypass actually reached the provider.
      const upstreamCalled = ['MISS', 'BYPASS'].includes(cacheStatus);

      metrics.httpRequests.inc({ method: req.method, route, status, cache_status: cacheStatus });
      metrics.httpDuration.observe({ method: req.method, route, status }, latencyMs / 1000);
      if (state.cacheStatus) metrics.cacheEvents.inc({ route, status: state.cacheStatus });

      const entry = {
        requestId,
        method: req.method,
        path: req.originalUrl,
        route,
        status: res.statusCode,
        latencyMs: Math.round(latencyMs * 1000) / 1000,
        cacheStatus,
        cacheHit: ['HIT', 'STALE', 'COALESCED'].includes(cacheStatus),
        upstreamCalled,
        rateLimit: state.rateLimit,
        breakerState,
        degraded: state.degraded,
        ip: req.ip,
        ...(state.errorCode ? { errorCode: state.errorCode, errorMessage: state.errorMessage } : {}),
      };

      if (res.statusCode >= 500) log.error(entry, 'request failed');
      else if (res.statusCode >= 400) log.warn(entry, 'request rejected');
      else log.info(entry, 'request completed');

      analytics.publish(
        buildRequestEvent({
          requestId,
          instance: config.instanceId,
          method: req.method,
          path: req.originalUrl,
          route,
          statusCode: res.statusCode,
          latencyMs,
          cacheStatus,
          upstreamCalled,
          rateLimit: state.rateLimit,
          breakerState,
          clientIp: req.ip,
          userAgent: req.get('user-agent'),
          degraded: state.degraded,
          errorCode: state.errorCode,
          errorMessage: state.errorMessage,
        }),
      );
    });

    next();
  };
}

/**
 * Route label for requests that never reached a proxy handler — a 429 from the rate
 * limiter, or an unknown path. Derived from the URL but validated against the known
 * endpoints, so an arbitrary path cannot inflate metric label cardinality.
 */
function matchedRoute(req) {
  const [prefix, name] = req.path.split('/').filter(Boolean);
  if (prefix === 'api' && endpointByName[name]) return name;
  return req.route?.path || 'unmatched';
}
