import { createApp } from './app.js';
import { CacheStore } from './cache/index.js';
import { createRedis } from './redis.js';
import { createOutboundLimiter } from './ratelimit/outbound.js';
import { createUpstreamClient } from './upstream/client.js';
import { AnalyticsQueue } from './analytics/queue.js';
import { createLogger } from './logger.js';

const log = createLogger('container');

/**
 * Builds the fully wired gateway and returns it with a shutdown hook.
 *
 * Two Redis connections on purpose: BullMQ needs blocking commands that retry forever,
 * which is the wrong setting for the request path, where a stuck command should fail
 * fast so the request can fall back to serving stale data.
 */
export function buildGateway() {
  const redis = createRedis({ role: 'gateway' });
  const queueConnection = createRedis({ role: 'analytics-queue', forQueue: true });

  const cache = new CacheStore(redis);
  const reserveUpstreamSlot = createOutboundLimiter(redis);
  const upstream = createUpstreamClient({ reserveUpstreamSlot });
  const analytics = new AnalyticsQueue({ connection: queueConnection });

  const app = createApp({ redis, cache, upstream, analytics });

  async function shutdown() {
    const results = await Promise.allSettled([
      analytics.close(),
      Promise.resolve(upstream.breaker.shutdown()),
      redis.quit(),
      queueConnection.quit(),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') log.warn({ err: result.reason }, 'error during shutdown');
    }
  }

  return { app, redis, queueConnection, cache, upstream, analytics, shutdown };
}
