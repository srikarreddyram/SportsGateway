import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { lockKey } from './keys.js';

const log = createLogger('cache');

export const CacheStatus = {
  HIT: 'HIT',
  STALE: 'STALE',
  MISS: 'MISS',
  FALLBACK: 'FALLBACK',
  BYPASS: 'BYPASS',
  COALESCED: 'COALESCED',
};

export const Freshness = {
  FRESH: 'fresh',
  STALE: 'stale',
  EXPIRED: 'expired',
};

// Compare-and-delete: only the holder of a lock may release it, so a slow request
// whose lock already expired cannot delete the lock a different request now owns.
const RELEASE_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/**
 * Cache-aside store with three freshness zones per entry:
 *
 *   now < freshUntil                      -> FRESH   serve as a hit
 *   freshUntil <= now < freshUntil + swr  -> STALE   serve immediately, refresh in background
 *   now >= freshUntil + swr               -> EXPIRED must refetch, but still usable as a
 *                                                    last-known-good fallback if upstream is down
 *
 * The Redis TTL is the (long) fallback TTL rather than the freshness TTL, which is what
 * lets a tripped circuit breaker answer with stale data instead of an error.
 */
export class CacheStore {
  #redis;
  #cfg;

  constructor(redis, cacheConfig = config.cache) {
    this.#redis = redis;
    this.#cfg = cacheConfig;
    this.#redis.defineCommand('sgReleaseLock', { numberOfKeys: 1, lua: RELEASE_LOCK_LUA });
  }

  get enabled() {
    return this.#cfg.enabled;
  }

  /**
   * @returns {Promise<null | {data: unknown, notFound: boolean, freshness: string,
   *   storedAt: number, ageMs: number, ttlS: number}>}
   */
  async read(key, now = Date.now()) {
    const raw = await this.#redis.get(key);
    if (!raw) return null;

    let envelope;
    try {
      envelope = JSON.parse(raw);
    } catch (err) {
      log.warn({ err, key }, 'discarding unparseable cache envelope');
      await this.#redis.unlink(key);
      return null;
    }

    const staleUntil = envelope.freshUntil + (this.#cfg.swrEnabled ? this.#cfg.swrWindowS * 1000 : 0);
    let freshness = Freshness.EXPIRED;
    if (now < envelope.freshUntil) freshness = Freshness.FRESH;
    else if (now < staleUntil) freshness = Freshness.STALE;

    return {
      data: envelope.data,
      notFound: envelope.status === 'not_found',
      freshness,
      storedAt: envelope.storedAt,
      ageMs: now - envelope.storedAt,
      ttlS: envelope.ttlS,
    };
  }

  async write(key, { data, ttlS, notFound = false }, now = Date.now()) {
    const effectiveTtlS = notFound ? this.#cfg.negativeTtlS : ttlS;
    const envelope = {
      status: notFound ? 'not_found' : 'ok',
      data,
      storedAt: now,
      ttlS: effectiveTtlS,
      freshUntil: now + effectiveTtlS * 1000,
    };

    // The entry must physically outlive its freshness + stale window, otherwise the
    // fallback path would have nothing to serve.
    const redisTtlS = Math.max(this.#cfg.fallbackTtlS, effectiveTtlS + this.#cfg.swrWindowS + 1);

    await this.#redis.set(key, JSON.stringify(envelope), 'EX', redisTtlS);
    return envelope;
  }

  /** @returns {Promise<string|null>} the lock token if acquired, else null. */
  async acquireLock(key, ttlMs = this.#cfg.lockTtlMs) {
    const token = randomUUID();
    const result = await this.#redis.set(lockKey(key), token, 'PX', ttlMs, 'NX');
    return result === 'OK' ? token : null;
  }

  async releaseLock(key, token) {
    if (!token) return false;
    try {
      const deleted = await this.#redis.sgReleaseLock(lockKey(key), token);
      return deleted === 1;
    } catch (err) {
      log.warn({ err, key }, 'failed to release cache lock');
      return false;
    }
  }

  /**
   * Wait for whichever request won the lock to fill the cache. This is the stampede
   * protection: N concurrent misses produce one upstream call, not N.
   */
  async waitForFill(key, { waitMs = this.#cfg.fillWaitMs, pollMs = this.#cfg.fillPollMs } = {}) {
    const deadline = Date.now() + waitMs;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      const entry = await this.read(key);
      if (entry && entry.freshness === Freshness.FRESH) return entry;
    }

    return null;
  }

  async delete(key) {
    return this.#redis.unlink(key);
  }
}
