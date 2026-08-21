import { config } from '../config.js';
import { createLogger } from '../logger.js';
import { metrics } from '../metrics.js';
import { RateLimitError } from '../errors.js';
import { inboundBucketKey } from '../cache/keys.js';
import { createTokenBucket } from './tokenBucket.js';

const log = createLogger('ratelimit.inbound');

/** Prefer an explicit API key so clients behind one NAT are not lumped together. */
function clientIdentity(req) {
  const apiKey = req.get('x-api-key');
  if (apiKey) return `key:${apiKey.slice(0, 32)}`;
  return `ip:${req.ip}`;
}

/**
 * Per-client inbound limiter. Stops one consumer from monopolising gateway capacity.
 * Deliberately more permissive than the outbound limiter: upstream quota is the scarcer
 * resource, so it gets the stricter budget.
 */
export function createInboundRateLimiter(redis, options = config.rateLimit.inbound) {
  const consume = createTokenBucket(redis);

  return async function inboundRateLimit(req, res, next) {
    if (!options.enabled) return next();

    const identity = clientIdentity(req);

    try {
      const result = await consume(inboundBucketKey(identity), {
        capacity: options.capacity,
        refillPerSec: options.refillPerSec,
      });

      res.set('X-RateLimit-Limit', String(result.limit));
      res.set('X-RateLimit-Remaining', String(Math.max(result.remaining, 0)));
      metrics.rateLimitTokens.set({ direction: 'inbound' }, result.remaining);

      if (!result.allowed) {
        const retryAfterS = Math.max(1, Math.ceil(result.retryAfterMs / 1000));
        res.set('Retry-After', String(retryAfterS));
        metrics.rateLimitRejections.inc({ direction: 'inbound', route: req.gatewayRoute ?? 'unknown' });
        req.ctx?.set({ rateLimit: 'inbound_rejected' });
        return next(new RateLimitError('Client rate limit exceeded', { retryAfterS, scope: 'inbound' }));
      }

      return next();
    } catch (err) {
      // A limiter outage must not take the gateway down with it: log and fail open.
      log.error({ err, identity }, 'inbound rate limit check failed, allowing request');
      return next();
    }
  };
}
