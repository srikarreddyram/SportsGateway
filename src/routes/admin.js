import { Router } from 'express';
import { config, publicConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { GatewayError } from '../errors.js';
import { scanDelete } from '../redis.js';
import { allCachePattern, cacheKey, routePattern } from '../cache/keys.js';
import { endpointByName } from '../upstream/endpoints.js';

const log = createLogger('admin');

/** Optional shared-secret guard; set ADMIN_TOKEN to require it. */
function requireAdminToken(req, res, next) {
  if (!config.admin.token) return next();
  if (req.get('x-admin-token') === config.admin.token) return next();
  return next(
    new GatewayError('Admin token missing or invalid', { status: 401, code: 'unauthorized', expected: true }),
  );
}

/**
 * Operational endpoints for demos and manual testing: inspect live gateway state and
 * invalidate cache entries explicitly rather than waiting for a TTL.
 *
 * Routes are defined relative to this router's own root (`/status`, not `/admin/status`)
 * because the caller is expected to mount it at the `/admin` prefix — see app.js. The
 * token guard below is unconditional `router.use()` with no path of its own, so it
 * applies to whatever this router is mounted at; mounting at `/admin` is what keeps it
 * from guarding the entire application.
 */
export function createAdminRouter({ redis, cache, upstream }) {
  const router = Router();
  router.use(requireAdminToken);

  router.get('/status', (req, res) => {
    res.json({
      instance: config.instanceId,
      breaker: upstream.breaker.stats(),
      cacheEnabled: cache.enabled,
      config: publicConfig(),
    });
  });

  router.delete('/cache', async (req, res) => {
    const route = req.query.route;
    if (route && !endpointByName[route]) {
      throw new GatewayError(`Unknown route "${route}"`, { status: 400, code: 'bad_request', expected: true });
    }

    const pattern = route ? routePattern(route) : allCachePattern();
    const removed = await scanDelete(redis, pattern);
    log.warn({ pattern, removed }, 'cache invalidated via admin endpoint');

    res.json({ invalidated: removed, pattern });
  });

  router.delete('/cache/:route/:id', async (req, res) => {
    const { route, id } = req.params;
    if (!endpointByName[route]) {
      throw new GatewayError(`Unknown route "${route}"`, { status: 400, code: 'bad_request', expected: true });
    }

    const removed = await cache.delete(cacheKey(route, id));
    res.json({ invalidated: removed, key: cacheKey(route, id) });
  });

  return router;
}
