/**
 * Distributed token bucket.
 *
 * The bucket holds `capacity` tokens and refills at `refillPerSec`. A request consumes
 * a token; an empty bucket rejects. Because the bucket can sit full, it absorbs short
 * bursts (which sports traffic is made of) while still capping the sustained rate — the
 * property a fixed-window counter lacks.
 *
 * State lives in Redis and the read-modify-write runs inside a Lua script, so it stays a
 * single atomic operation shared correctly across every gateway instance. Per-instance
 * in-memory counters would let N instances each allow the full limit.
 */
const TOKEN_BUCKET_LUA = `
local key       = KEYS[1]
local capacity  = tonumber(ARGV[1])
local refill    = tonumber(ARGV[2])
local now       = tonumber(ARGV[3])
local requested = tonumber(ARGV[4])
local ttl       = tonumber(ARGV[5])

local bucket = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(bucket[1])
local ts     = tonumber(bucket[2])

if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end

local elapsed = math.max(0, now - ts) / 1000
tokens = math.min(capacity, tokens + elapsed * refill)

local allowed = 0
local retry_after_ms = 0

if tokens >= requested then
  allowed = 1
  tokens = tokens - requested
elseif refill > 0 then
  retry_after_ms = math.ceil(((requested - tokens) / refill) * 1000)
else
  retry_after_ms = ttl * 1000
end

redis.call('HSET', key, 'tokens', tokens, 'ts', now)
redis.call('EXPIRE', key, ttl)

-- tokens is returned as a string: Redis truncates Lua numbers to integers in replies.
return { allowed, tostring(tokens), retry_after_ms }
`;

export function createTokenBucket(redis, { commandName = 'sgTokenBucket' } = {}) {
  if (typeof redis[commandName] !== 'function') {
    redis.defineCommand(commandName, { numberOfKeys: 1, lua: TOKEN_BUCKET_LUA });
  }

  /**
   * @returns {Promise<{allowed: boolean, remaining: number, retryAfterMs: number, limit: number}>}
   */
  return async function consume(key, { capacity, refillPerSec, tokens = 1 }) {
    // Keep the key alive long enough for a drained bucket to refill completely.
    const ttlS = Math.max(60, Math.ceil(capacity / Math.max(refillPerSec, 0.01)) + 60);

    const [allowed, remaining, retryAfterMs] = await redis[commandName](
      key,
      capacity,
      refillPerSec,
      Date.now(),
      tokens,
      ttlS,
    );

    return {
      allowed: allowed === 1,
      remaining: Math.floor(Number.parseFloat(remaining)),
      retryAfterMs,
      limit: capacity,
    };
  };
}
