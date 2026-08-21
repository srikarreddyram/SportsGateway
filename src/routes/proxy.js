import { Router } from 'express';
import { createLogger } from '../logger.js';
import { metrics } from '../metrics.js';
import { CacheStatus, Freshness } from '../cache/index.js';
import { cacheKey } from '../cache/keys.js';
import { endpoints as defaultEndpoints } from '../upstream/endpoints.js';
import { CircuitOpenError, NotFoundError, RateLimitError, UpstreamError } from '../errors.js';
import { config } from '../config.js';

const log = createLogger('proxy');

/** Only infrastructure failures may be answered with stale data; a 404 is a real answer. */
const canServeFallback = (err) =>
  err instanceof UpstreamError ||
  err instanceof CircuitOpenError ||
  (err instanceof RateLimitError && err.scope === 'outbound');

/** Everything a background refresh needs from the request, without holding the request. */
const detachContext = (req) => ({ query: { ...req.query } });

export function createProxyRouter({ cache, upstream, endpoints = defaultEndpoints }) {
  const router = Router();

  for (const endpoint of endpoints) {
    router.get(endpoint.path, createProxyHandler(endpoint, { cache, upstream }));
  }

  return router;
}

function createProxyHandler(endpoint, { cache, upstream }) {
  /** Call upstream, shape the payload, store it. Shared by the request path and SWR. */
  async function fetchAndStore(value, reqCtx, key) {
    const { path, query } = endpoint.upstream(value, reqCtx);
    const body = await upstream.request({ route: endpoint.name, path, query });
    const payload = endpoint.transform(body, value);

    if (!payload) {
      // Negative caching: without it, a client looping on a bad id would hit upstream
      // on every request and burn the quota that real traffic needs.
      if (cache.enabled) await cache.write(key, { data: null, ttlS: 0, notFound: true });
      return { notFound: true };
    }

    const ttlS = endpoint.ttlFor(payload, value);
    if (cache.enabled) await cache.write(key, { data: payload, ttlS });
    return { data: payload, ttlS, notFound: false };
  }

  /**
   * Stale-while-revalidate: the client already has its (stale) answer, so this refresh
   * runs after the response. The lock means only one instance refreshes a given key.
   */
  function scheduleRevalidate(value, reqCtx, key) {
    setImmediate(async () => {
      let token = null;
      try {
        token = await cache.acquireLock(key);
        if (!token) return;
        await fetchAndStore(value, reqCtx, key);
        metrics.cacheRevalidations.inc({ route: endpoint.name, outcome: 'success' });
      } catch (err) {
        // A failed background refresh is survivable: the stale value stays served until
        // it either refreshes or ages out, so this never propagates to a client.
        metrics.cacheRevalidations.inc({ route: endpoint.name, outcome: 'failure' });
        log.warn({ err, key, route: endpoint.name }, 'background revalidation failed');
      } finally {
        if (token) await cache.releaseLock(key, token).catch(() => {});
      }
    });
  }

  return async function proxyHandler(req, res) {
    const value = endpoint.validate(req.params[endpoint.param]);
    const reqCtx = detachContext(req);
    const id = endpoint.cacheId ? endpoint.cacheId(value, reqCtx) : value;
    const key = cacheKey(endpoint.name, id);

    req.gatewayRoute = endpoint.name;
    req.ctx.set({ route: endpoint.name });

    const send = (payload, cacheStatus, { ageMs = 0, ttlS, degraded = false } = {}) => {
      req.ctx.set({ cacheStatus, degraded });
      res.set('X-Cache', cacheStatus);
      res.set('X-Instance', config.instanceId);
      if (ttlS !== undefined) res.set('X-Cache-TTL', String(ttlS));
      if (ageMs) res.set('Age', String(Math.floor(ageMs / 1000)));
      if (degraded) res.set('X-Degraded', 'true');

      if (payload === undefined) return; // headers only; caller throws a typed error next
      return res.json({
        meta: {
          cache: cacheStatus,
          ageMs: Math.round(ageMs),
          instance: config.instanceId,
          requestId: req.ctx.requestId,
          ...(degraded ? { degraded: true, note: 'served from last-known-good cache' } : {}),
        },
        data: payload,
      });
    };

    // Baseline mode for the load-test comparison: every request goes to upstream.
    if (!cache.enabled) {
      const fresh = await fetchAndStore(value, reqCtx, key);
      if (fresh.notFound) {
        send(undefined, CacheStatus.BYPASS);
        throw new NotFoundError(`No ${endpoint.name} data for "${value}"`);
      }
      return send(fresh.data, CacheStatus.BYPASS, { ttlS: fresh.ttlS });
    }

    const entry = await cache.read(key);

    if (entry?.freshness === Freshness.FRESH) {
      if (entry.notFound) {
        send(undefined, CacheStatus.HIT);
        throw new NotFoundError(`No ${endpoint.name} data for "${value}"`);
      }
      return send(entry.data, CacheStatus.HIT, { ageMs: entry.ageMs, ttlS: entry.ttlS });
    }

    if (entry?.freshness === Freshness.STALE) {
      scheduleRevalidate(value, reqCtx, key);
      if (entry.notFound) {
        send(undefined, CacheStatus.STALE);
        throw new NotFoundError(`No ${endpoint.name} data for "${value}"`);
      }
      return send(entry.data, CacheStatus.STALE, { ageMs: entry.ageMs, ttlS: entry.ttlS });
    }

    // Miss (or fully expired). Exactly one request per key should reach upstream.
    let lockToken = null;
    try {
      lockToken = await cache.acquireLock(key);

      if (!lockToken) {
        const filled = await cache.waitForFill(key);
        if (filled) {
          if (filled.notFound) {
            send(undefined, CacheStatus.COALESCED);
            throw new NotFoundError(`No ${endpoint.name} data for "${value}"`);
          }
          return send(filled.data, CacheStatus.COALESCED, { ageMs: filled.ageMs, ttlS: filled.ttlS });
        }
        // The winner is slow or died holding the lock; go to upstream rather than 504.
      }

      const fresh = await fetchAndStore(value, reqCtx, key);
      if (fresh.notFound) {
        send(undefined, CacheStatus.MISS);
        throw new NotFoundError(`No ${endpoint.name} data for "${value}"`);
      }
      return send(fresh.data, CacheStatus.MISS, { ttlS: fresh.ttlS });
    } catch (err) {
      // Graceful degradation: an expired-but-present entry beats an error page.
      if (entry && !entry.notFound && canServeFallback(err)) {
        log.warn(
          { err, key, route: endpoint.name, ageMs: entry.ageMs },
          'upstream unavailable, serving last-known-good cache',
        );
        return send(entry.data, CacheStatus.FALLBACK, { ageMs: entry.ageMs, ttlS: entry.ttlS, degraded: true });
      }
      throw err;
    } finally {
      if (lockToken) await cache.releaseLock(key, lockToken).catch(() => {});
    }
  };
}
