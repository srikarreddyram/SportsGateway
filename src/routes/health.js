import { Router } from 'express';
import { registry } from '../metrics.js';
import { config } from '../config.js';
import { pingRedis } from '../redis.js';

/**
 * Liveness vs readiness are separate on purpose: Nginx should keep routing to an
 * instance that is up (`/health`), while an orchestrator uses `/ready` to decide whether
 * the instance can actually serve traffic (it cannot without Redis).
 */
export function createHealthRouter({ redis, upstream }) {
  const router = Router();
  const startedAt = Date.now();

  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      instance: config.instanceId,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    });
  });

  router.get('/ready', async (req, res) => {
    const redisOk = await pingRedis(redis);
    const breakerState = upstream.breaker.state;

    res.status(redisOk ? 200 : 503).json({
      status: redisOk ? 'ready' : 'degraded',
      instance: config.instanceId,
      checks: {
        redis: redisOk ? 'ok' : 'unreachable',
        // A tripped breaker is degraded operation, not unreadiness: the instance still
        // serves cached data, so pulling it from the load balancer would make things worse.
        circuitBreaker: breakerState,
      },
    });
  });

  router.get('/metrics', async (req, res, next) => {
    if (!config.metrics.enabled) return res.status(404).end();
    try {
      res.set('Content-Type', registry.contentType);
      res.end(await registry.metrics());
    } catch (err) {
      next(err);
    }
  });

  return router;
}
