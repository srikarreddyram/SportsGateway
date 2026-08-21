import { config } from '../config.js';

// Read at call time rather than module load, so the prefix stays configurable
// (tests isolate themselves by namespace, and one Redis can host several environments).
const prefix = () => config.redis.keyPrefix;

/** Cached upstream payloads: sg:cache:scores:215662 */
export const cacheKey = (route, id) => `${prefix()}:cache:${route}:${id}`;

/** Stampede lock guarding a single cache key. */
export const lockKey = (key) => `${key}:lock`;

/** Every cache entry for one route, for admin invalidation. */
export const routePattern = (route) => `${prefix()}:cache:${route}:*`;

export const allCachePattern = () => `${prefix()}:cache:*`;

/** Per-client inbound rate-limit bucket. */
export const inboundBucketKey = (identity) => `${prefix()}:rl:inbound:${identity}`;

/** Single global bucket shared by every gateway instance, protecting upstream quota. */
export const outboundBucketKey = () => `${prefix()}:rl:outbound:global`;
