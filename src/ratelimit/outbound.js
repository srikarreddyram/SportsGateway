import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { metrics } from '../metrics.js';
import { RateLimitError } from '../errors.js';
import { outboundBucketKey } from '../cache/keys.js';
import { createTokenBucket } from './tokenBucket.js';

const log = createLogger('ratelimit.outbound');

/**
 * Global limiter sized to the upstream provider's quota. One bucket in Redis is shared
 * by every gateway instance, so three instances still make at most `capacity` upstream
 * calls — the thing per-process limiters get wrong.
 *
 * Checked only when a call is actually about to leave the gateway, so cache hits never
 * consume quota. Kept outside the circuit breaker: refusing to spend quota is a local
 * policy decision, not evidence that upstream is unhealthy, so it must not trip the breaker.
 */
export function createOutboundLimiter(redis, options = config.rateLimit.outbound) {
  const consume = createTokenBucket(redis);

  return async function reserveUpstreamSlot({ route = 'unknown' } = {}) {
    if (!options.enabled) return { allowed: true, remaining: Number.POSITIVE_INFINITY };

    let result;
    try {
      result = await consume(outboundBucketKey(), {
        capacity: options.capacity,
        refillPerSec: options.refillPerSec,
      });
    } catch (err) {
      // Failing open here would risk blowing the upstream quota, but failing closed
      // would take the gateway down whenever Redis blips. Cached data still serves on
      // the fallback path, so we fail open and make the gap loud.
      log.error({ err, route }, 'outbound quota check failed, allowing upstream call');
      return { allowed: true, remaining: Number.NaN };
    }

    metrics.rateLimitTokens.set({ direction: 'outbound' }, result.remaining);

    if (!result.allowed) {
      metrics.rateLimitRejections.inc({ direction: 'outbound', route });
      const retryAfterS = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
      throw new RateLimitError('Upstream quota exhausted for this window', {
        retryAfterS,
        scope: 'outbound',
      });
    }

    return result;
  };
}
