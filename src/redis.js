import Redis from 'ioredis';
import { config } from './config.js';
import { createLogger } from './logger.js';

const log = createLogger('redis');

/**
 * @param {object} [options]
 * @param {string} [options.role] label used in logs
 * @param {boolean} [options.forQueue] BullMQ requires blocking commands to retry
 *   forever, which means `maxRetriesPerRequest` must be null on its connection.
 */
export function createRedis({ role = 'gateway', forQueue = false } = {}) {
  const redis = new Redis(config.redis.url, {
    lazyConnect: false,
    enableReadyCheck: true,
    maxRetriesPerRequest: forQueue ? null : 3,
    retryStrategy: (attempt) => Math.min(attempt * 200, 2000),
  });

  redis.on('error', (err) => log.error({ err, role }, 'redis connection error'));
  redis.on('ready', () => log.info({ role }, 'redis ready'));
  redis.on('end', () => log.warn({ role }, 'redis connection closed'));

  return redis;
}

export async function pingRedis(redis) {
  try {
    const reply = await redis.ping();
    return reply === 'PONG';
  } catch {
    return false;
  }
}

/**
 * Delete keys matching a pattern without blocking Redis the way KEYS would.
 * Returns the number of keys removed.
 */
export async function scanDelete(redis, pattern, { batch = 200 } = {}) {
  let cursor = '0';
  let removed = 0;

  do {
    const [next, keys] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', batch);
    cursor = next;
    if (keys.length > 0) {
      removed += await redis.unlink(...keys);
    }
  } while (cursor !== '0');

  return removed;
}
